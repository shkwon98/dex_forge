from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

from geometry_msgs.msg import PoseArray
from std_msgs.msg import String

from .models import ClipDecision, ClipLabel, ClipRecord, EventRecord, HandMode, HandPosePoint, RecorderState, Scenario, SessionRecord, SessionSnapshot
from .scenario_library import ScenarioLibrary
from .storage import DatasetStorage
from .writer import BufferedMessage, RosbagClipWriter


LEFT_TOPIC = "/teleop/human/hand_left/pose"
RIGHT_TOPIC = "/teleop/human/hand_right/pose"
EVENT_TOPIC = "/collector/events"


class InvalidTransitionError(RuntimeError):
    """Raised when an invalid state transition is requested."""


class CollectionService:
    def __init__(
        self,
        dataset_root: Path,
        scenarios: list[Scenario],
        scenario_version: str,
        *,
        min_duration_sec: float = 0.25,
        min_frames_per_topic: int = 5,
    ):
        self.storage = DatasetStorage(Path(dataset_root))
        self.storage.write_scenario_version(scenario_version)
        self.scenario_library = ScenarioLibrary(version=scenario_version, scenarios=scenarios)
        self.writer = RosbagClipWriter()
        self.min_duration_sec = min_duration_sec
        self.min_frames_per_topic = min_frames_per_topic

        self.current_state = RecorderState.IDLE
        self.session: SessionRecord | None = None
        self.current_prompt: Scenario | None = None
        self.armed_scenario: Scenario | None = None
        self.current_clip: ClipRecord | None = None
        self.pending_clip_events: list[EventRecord] = []
        self.buffered_messages: list[BufferedMessage] = []
        self.recent_pairs: deque[tuple[str, str]] = deque(maxlen=8)
        self.history: list[dict[str, Any]] = []
        self.topic_health: dict[str, Any] = {}
        self.hand_pose_preview: dict[str, list[HandPosePoint]] = {
            "left": [],
            "right": [],
        }
        self.session_notes: list[str] = []

    def create_session(
        self,
        operator_id: str,
        active_hands: HandMode,
        notes: str = "",
        collection_setup: dict[str, Any] | None = None,
    ) -> SessionRecord:
        session_id = datetime.now(tz=UTC).strftime("%Y%m%d_%H%M%S") + "_" + uuid4().hex[:6]
        self.session = SessionRecord(
            session_id=session_id,
            operator_id=operator_id,
            active_hands=active_hands,
            started_at=datetime.now(tz=UTC),
            scenario_library_version=self.scenario_library.version,
            notes=notes,
            collection_setup=collection_setup or {},
        )
        self.current_state = RecorderState.IDLE
        self.current_prompt = None
        self.armed_scenario = None
        self.current_clip = None
        self.buffered_messages = []
        self.pending_clip_events = []
        self.hand_pose_preview = {"left": [], "right": []}
        self.session_notes = []
        self.storage.write_session_manifest(self.session)
        return self.session

    def next_prompt(self) -> Scenario:
        session = self._require_session()
        self.current_prompt = self.scenario_library.next_scenario(
            active_hands=session.active_hands,
            recent_pairs=list(self.recent_pairs),
        )
        self._record_session_event(
            "prompt_loaded",
            {"scenario_id": self.current_prompt.id, "prompt_text": self.current_prompt.prompt_text},
        )
        return self.current_prompt

    def arm_clip(self, scenario_id: str) -> ClipRecord:
        scenario = next(
            (item for item in self.scenario_library.all() if item.id == scenario_id),
            None,
        )
        if scenario is None:
            raise LookupError(f"unknown scenario id {scenario_id}")
        self.armed_scenario = scenario
        self.current_state = RecorderState.ARMED
        clip = self._build_clip_record(scenario)
        self.current_clip = clip
        self._append_event("clip_armed", {"scenario_id": scenario.id})
        return clip

    def start_clip(self, start_time: datetime | None = None) -> ClipRecord:
        if self.current_state is not RecorderState.ARMED or self.current_clip is None:
            raise InvalidTransitionError("clip must be armed before recording starts")
        self.current_state = RecorderState.RECORDING
        self.current_clip.start_time = start_time or datetime.now(tz=UTC)
        self.buffered_messages = []
        self.pending_clip_events = []
        self._append_event("record_pressed", {"clip_id": self.current_clip.clip_id})
        return self.current_clip

    def record_message(self, topic: str, message: Any, timestamp_ns: int) -> None:
        preview_key = self._hand_key_for_topic(topic)
        if preview_key and isinstance(message, PoseArray):
            self.hand_pose_preview[preview_key] = self._pose_array_preview(message)

        if self.current_state is not RecorderState.RECORDING or self.current_clip is None:
            return
        if topic in self._required_topics():
            self.buffered_messages.append(
                BufferedMessage(topic=topic, message=message, timestamp_ns=timestamp_ns)
            )
            self.current_clip.frame_counts[topic] = self.current_clip.frame_counts.get(topic, 0) + 1
        self.topic_health[topic] = {"last_timestamp_ns": timestamp_ns}

    def stop_clip(self, stop_time: datetime | None = None) -> ClipRecord:
        if self.current_state is not RecorderState.RECORDING or self.current_clip is None:
            raise InvalidTransitionError("clip must be recording before it can stop")

        clip = self.current_clip
        clip.end_time = stop_time or datetime.now(tz=UTC)
        clip.duration_sec = max(
            (clip.end_time - clip.start_time).total_seconds() if clip.start_time else 0.0,
            0.0,
        )
        self._append_event("record_stopped", {"clip_id": clip.clip_id})
        bag_messages = self._build_bag_messages()
        clip.recorded_topics = sorted({item.topic for item in bag_messages})
        clip.bag_path = str(clip.clip_dir / "recording.mcap")

        failure_reason = self._sanity_check(clip)
        if failure_reason:
            clip.status = RecorderState.INVALID
            clip.failure_reason = failure_reason
            self._append_event("sanity_check_failed", {"reason": failure_reason})
            self.current_state = RecorderState.INVALID
        else:
            clip.status = RecorderState.REVIEW
            self.current_state = RecorderState.REVIEW

        self.writer.write(Path(clip.bag_path), bag_messages)
        self.storage.write_events(clip.clip_dir, self.pending_clip_events)
        self.storage.write_clip_manifest(clip)
        self._record_history(clip)
        return clip

    def decide_clip(self, clip_id: str, decision: ClipDecision) -> ClipRecord:
        if self.current_clip is None or self.current_clip.clip_id != clip_id:
            raise LookupError(f"unknown clip id {clip_id}")

        clip = self.current_clip
        if decision == ClipDecision.ACCEPT:
            clip.status = RecorderState.ACCEPTED
            self._append_event("review_accepted", {"clip_id": clip.clip_id})
            self.current_state = RecorderState.IDLE
        elif decision == ClipDecision.DISCARD:
            clip.status = RecorderState.DISCARDED
            self._append_event("review_discarded", {"clip_id": clip.clip_id})
            self.current_state = RecorderState.IDLE
        else:
            clip.status = RecorderState.RETRIED
            self._append_event("review_retry", {"clip_id": clip.clip_id})
            replacement = self._build_clip_record(self.armed_scenario or self._scenario_from_clip(clip))
            replacement.operator_note = clip.operator_note
            self.current_clip = replacement
            self.current_state = RecorderState.ARMED
            self.storage.write_clip_manifest(clip)
            self._record_history(clip)
            return replacement

        self.storage.write_events(clip.clip_dir, self.pending_clip_events)
        self.storage.write_clip_manifest(clip)
        self.recent_pairs.append((clip.label.category, clip.label.action))
        self._record_history(clip)
        return clip

    def add_note(self, note: str) -> None:
        if self.current_clip is not None:
            self.current_clip.operator_note = note
            self._append_event("note_added", {"note": note})
        else:
            self.session_notes.append(note)

    def snapshot(self) -> SessionSnapshot:
        session_id = self.session.session_id if self.session else None
        active_hands = self.session.active_hands if self.session else None
        clip_id = self.current_clip.clip_id if self.current_clip else None
        return SessionSnapshot(
            session_id=session_id,
            active_hands=active_hands,
            current_state=self.current_state,
            current_prompt=self.current_prompt,
            current_clip_id=clip_id,
            hand_pose_preview=self.hand_pose_preview,
            topic_health=self.topic_health,
            recent_history=self.history[-10:],
        )

    def _build_bag_messages(self) -> list[BufferedMessage]:
        event_messages = []
        for index, event in enumerate(self.pending_clip_events):
            event_messages.append(
                BufferedMessage(
                    topic=EVENT_TOPIC,
                    message=String(data=event.model_dump_json()),
                    timestamp_ns=index + 1,
                )
            )
        return [*event_messages, *self.buffered_messages]

    def _required_topics(self) -> list[str]:
        session = self._require_session()
        if session.active_hands == HandMode.LEFT:
            return [LEFT_TOPIC]
        if session.active_hands == HandMode.RIGHT:
            return [RIGHT_TOPIC]
        return [LEFT_TOPIC, RIGHT_TOPIC]

    @staticmethod
    def _hand_key_for_topic(topic: str) -> str | None:
        if topic == LEFT_TOPIC:
            return "left"
        if topic == RIGHT_TOPIC:
            return "right"
        return None

    @staticmethod
    def _pose_array_preview(message: PoseArray) -> list[HandPosePoint]:
        return [
            HandPosePoint(
                x=pose.position.x,
                y=pose.position.y,
                z=pose.position.z,
                frame_id=message.header.frame_id,
            )
            for pose in message.poses
        ]

    def _sanity_check(self, clip: ClipRecord) -> str | None:
        if clip.duration_sec < self.min_duration_sec:
            return "clip_too_short"
        for topic in self._required_topics():
            if clip.frame_counts.get(topic, 0) < self.min_frames_per_topic:
                return "missing_required_topic_frames"
        return None

    def _append_event(self, event_type: str, payload: dict[str, Any]) -> None:
        session = self._require_session()
        clip_id = self.current_clip.clip_id if self.current_clip else None
        self.pending_clip_events.append(
            EventRecord(
                timestamp=datetime.now(tz=UTC),
                session_id=session.session_id,
                clip_id=clip_id,
                event_type=event_type,
                payload=payload,
            )
        )

    def _record_session_event(self, event_type: str, payload: dict[str, Any]) -> None:
        session = self._require_session()
        self.history.append(
            {
                "timestamp": datetime.now(tz=UTC).isoformat(),
                "session_id": session.session_id,
                "event_type": event_type,
                "payload": payload,
            }
        )

    def _build_clip_record(self, scenario: Scenario) -> ClipRecord:
        session = self._require_session()
        clip_id = f"clip_{uuid4().hex[:8]}"
        return ClipRecord(
            clip_id=clip_id,
            session_id=session.session_id,
            label=ClipLabel(
                category=scenario.category,
                action=scenario.action,
                variation=scenario.variation,
            ),
            prompt_text=scenario.prompt_text,
            active_hands=session.active_hands,
            status=RecorderState.ARMED,
            clip_dir=self.storage.clip_dir(session.session_id, clip_id),
        )

    def _scenario_from_clip(self, clip: ClipRecord) -> Scenario:
        for scenario in self.scenario_library.all():
            if (
                scenario.category == clip.label.category
                and scenario.action == clip.label.action
                and scenario.variation == clip.label.variation
            ):
                return scenario
        raise LookupError("scenario for clip not found")

    def _record_history(self, clip: ClipRecord) -> None:
        entry = {
            "clip_id": clip.clip_id,
            "status": clip.status.value,
            "label": clip.label.model_dump(),
        }
        self.history = [item for item in self.history if item.get("clip_id") != clip.clip_id]
        self.history.append(entry)

    def _require_session(self) -> SessionRecord:
        if self.session is None:
            raise InvalidTransitionError("session has not been created")
        return self.session
