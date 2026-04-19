from __future__ import annotations

from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from geometry_msgs.msg import PoseArray
from std_msgs.msg import String

from .models import CollectorSnapshot, EventRecord, HandMode, HandPosePoint, RecorderState, RecordingDecision, RecordingRecord, Scenario, TaskLabel
from .scenario_library import ScenarioLibrary
from .storage import DatasetStorage
from .writer import BufferedMessage, RosbagRecordingWriter


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
        *,
        min_duration_sec: float = 0.25,
        min_frames_per_topic: int = 5,
    ):
        self.storage = DatasetStorage(Path(dataset_root))
        self.scenario_library = ScenarioLibrary(scenarios=scenarios)
        self.writer = RosbagRecordingWriter()
        self.min_duration_sec = min_duration_sec
        self.min_frames_per_topic = min_frames_per_topic

        self.current_state = RecorderState.IDLE
        self.collection_active_hands: HandMode | None = None
        self.current_prompt: Scenario | None = None
        self.current_recording: RecordingRecord | None = None
        self.pending_recording_events: list[EventRecord] = []
        self.buffered_messages: list[BufferedMessage] = []
        self.recent_pairs: deque[tuple[str, str]] = deque(maxlen=8)
        self.topic_health: dict[str, Any] = {}
        self.hand_pose_preview: dict[str, list[HandPosePoint]] = {
            "left": [],
            "right": [],
        }
        self.collection_outcomes: list[str] = []

    def start_collection(
        self,
        active_hands: HandMode,
        dataset_root: Path | str | None = None,
    ) -> CollectorSnapshot:
        if dataset_root:
            self.storage = DatasetStorage(Path(dataset_root).expanduser().resolve())
        self.collection_active_hands = active_hands
        self.current_state = RecorderState.IDLE
        self.current_prompt = None
        self.current_recording = None
        self.buffered_messages = []
        self.pending_recording_events = []
        self.hand_pose_preview = {"left": [], "right": []}
        self.collection_outcomes = []
        return self.snapshot()

    def update_active_hands(self, active_hands: HandMode) -> CollectorSnapshot:
        self._require_collection()
        if self.current_state is RecorderState.RECORDING:
            raise InvalidTransitionError("active hands cannot change while recording")

        self.collection_active_hands = active_hands
        return self.snapshot()

    def next_prompt(self) -> Scenario:
        active_hands = self._require_collection()
        self.current_prompt = self.scenario_library.next_scenario(
            active_hands=active_hands,
            current_prompt_text=self.current_prompt.prompt_text if self.current_prompt else None,
            recent_pairs=list(self.recent_pairs),
        )
        return self.current_prompt

    def start_recording(self, start_time: datetime | None = None) -> RecordingRecord:
        if self.current_prompt is None:
            raise InvalidTransitionError("prompt must be selected before recording starts")

        self.current_recording = self._build_recording_record(self.current_prompt)
        self.current_state = RecorderState.RECORDING
        self.current_recording.start_time = start_time or datetime.now(tz=UTC)
        self.buffered_messages = []
        self.pending_recording_events = []
        self._append_event("record_pressed", {"recording_id": self.current_recording.recording_id})
        return self.current_recording

    def record_message(self, topic: str, message: Any, timestamp_ns: int) -> None:
        preview_key = self._hand_key_for_topic(topic)
        if preview_key and isinstance(message, PoseArray):
            self.hand_pose_preview[preview_key] = self._pose_array_preview(message)

        if self.current_state is not RecorderState.RECORDING or self.current_recording is None:
            return
        if topic in self._required_topics():
            self.buffered_messages.append(
                BufferedMessage(topic=topic, message=message, timestamp_ns=timestamp_ns)
            )
            self.current_recording.frame_counts[topic] = self.current_recording.frame_counts.get(topic, 0) + 1
        self.topic_health[topic] = {"last_timestamp_ns": timestamp_ns}

    def stop_recording(self, stop_time: datetime | None = None) -> RecordingRecord:
        if self.current_state is not RecorderState.RECORDING or self.current_recording is None:
            raise InvalidTransitionError("recording must be active before it can stop")

        recording = self.current_recording
        recording.end_time = stop_time or datetime.now(tz=UTC)
        recording.duration_sec = max(
            (recording.end_time - recording.start_time).total_seconds() if recording.start_time else 0.0,
            0.0,
        )
        self._append_event("record_stopped", {"recording_id": recording.recording_id})
        recording.bag_path = str(recording.recording_dir)

        failure_reason = self._sanity_check(recording)
        if failure_reason:
            recording.status = RecorderState.INVALID
            recording.failure_reason = failure_reason
            self._append_event("sanity_check_failed", {"reason": failure_reason})
        else:
            recording.status = RecorderState.REVIEW

        bag_messages = self._build_bag_messages()
        recording.recorded_topics = sorted({item.topic for item in bag_messages})
        recording.review_preview = self._build_review_preview()
        self.writer.write(Path(recording.bag_path), bag_messages)
        self.storage.ensure_task_metadata(recording.task_id, recording.prompt_text, recording.label)
        self.current_state = RecorderState.REVIEW
        return recording

    def decide_recording(self, recording_id: str, decision: RecordingDecision) -> RecordingRecord:
        if self.current_recording is None or self.current_recording.recording_id != recording_id:
            raise LookupError(f"unknown recording id {recording_id}")

        recording = self.current_recording
        if decision == RecordingDecision.DISCARD:
            recording.status = RecorderState.DISCARDED
            self.storage.remove_recording(recording.recording_dir)
            self.storage.ensure_task_metadata(recording.task_id, recording.prompt_text, recording.label)
            self.collection_outcomes.append(RecorderState.DISCARDED.value)
            self._reset_after_review()
            return recording

        if decision == RecordingDecision.RECORD_MORE:
            recording.status = RecorderState.ACCEPTED
            self._append_event("review_record_more", {"recording_id": recording.recording_id})
        else:
            recording.status = RecorderState.ACCEPTED
            self._append_event("review_accepted", {"recording_id": recording.recording_id})

        bag_messages = self._build_bag_messages()
        recording.recorded_topics = sorted({item.topic for item in bag_messages})
        self.writer.write(Path(recording.bag_path), bag_messages)
        self.storage.ensure_task_metadata(recording.task_id, recording.prompt_text, recording.label)
        self.recent_pairs.append((recording.label.category, recording.label.action))
        self.collection_outcomes.append(RecorderState.ACCEPTED.value)
        self._reset_after_review()
        return recording

    def add_note(self, note: str) -> None:
        if self.current_recording is None:
            return
        self.current_recording.operator_note = note
        self._append_event("note_added", {"note": note})

    def snapshot(self) -> CollectorSnapshot:
        return CollectorSnapshot(
            is_collecting=self.collection_active_hands is not None,
            active_hands=self.collection_active_hands,
            dataset_root=str(self.storage.dataset_root),
            accepted_recording_count=self.collection_outcomes.count(RecorderState.ACCEPTED.value),
            current_state=self.current_state,
            current_prompt=self.current_prompt,
            hand_pose_preview=self.hand_pose_preview,
            topic_health=self.topic_health,
        )

    def finish_collection(self) -> dict[str, Any]:
        self._require_collection()
        if self.current_state is RecorderState.RECORDING:
            raise InvalidTransitionError("collection cannot finish while recording")
        if self.current_state is RecorderState.REVIEW:
            raise InvalidTransitionError("collection cannot finish while a recording is awaiting review")

        summary = {
            "dataset_root": str(self.storage.dataset_root),
            "accepted_count": self.collection_outcomes.count(RecorderState.ACCEPTED.value),
            "discarded_count": self.collection_outcomes.count(RecorderState.DISCARDED.value),
            "invalid_count": self.collection_outcomes.count(RecorderState.INVALID.value),
            "total_recordings": len(self.collection_outcomes),
            "ended_at": datetime.now(tz=UTC).isoformat(),
        }

        self.collection_active_hands = None
        self.current_prompt = None
        self.current_recording = None
        self.current_state = RecorderState.IDLE
        self.pending_recording_events = []
        self.buffered_messages = []
        self.collection_outcomes = []

        return summary

    def _build_bag_messages(self) -> list[BufferedMessage]:
        event_messages = []
        for index, event in enumerate(self.pending_recording_events):
            event_messages.append(
                BufferedMessage(
                    topic=EVENT_TOPIC,
                    message=String(data=event.model_dump_json()),
                    timestamp_ns=index + 1,
                )
            )
        return [*event_messages, *self.buffered_messages]

    def _build_review_preview(self) -> dict[str, list[list[HandPosePoint]]]:
        preview: dict[str, list[list[HandPosePoint]]] = {"left": [], "right": []}
        for item in self.buffered_messages:
            hand_key = self._hand_key_for_topic(item.topic)
            if hand_key and isinstance(item.message, PoseArray):
                preview[hand_key].append(self._pose_array_preview(item.message))
        return preview

    def _required_topics(self) -> list[str]:
        active_hands = self._require_collection()
        if active_hands == HandMode.LEFT:
            return [LEFT_TOPIC]
        if active_hands == HandMode.RIGHT:
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

    def _sanity_check(self, recording: RecordingRecord) -> str | None:
        if recording.duration_sec < self.min_duration_sec:
            return "recording_too_short"
        for topic in self._required_topics():
            if recording.frame_counts.get(topic, 0) < self.min_frames_per_topic:
                return "missing_required_topic_frames"
        return None

    def _append_event(self, event_type: str, payload: dict[str, Any]) -> None:
        recording_id = self.current_recording.recording_id if self.current_recording else None
        self.pending_recording_events.append(
            EventRecord(
                timestamp=datetime.now(tz=UTC),
                recording_id=recording_id,
                event_type=event_type,
                payload=payload,
            )
        )

    def _build_recording_record(self, scenario: Scenario) -> RecordingRecord:
        active_hands = self._require_collection()
        recording_id = f"recording_{uuid4().hex[:8]}"
        label = TaskLabel(
            category=scenario.category,
            action=scenario.action,
            variation=scenario.variation,
        )
        task_id = self.storage.task_id_for_prompt(scenario.prompt_text)
        recording_dir = self.storage.recording_dir(task_id)
        self.storage.ensure_task_metadata(task_id, scenario.prompt_text, label)
        return RecordingRecord(
            recording_id=recording_id,
            task_id=task_id,
            label=label,
            prompt_text=scenario.prompt_text,
            active_hands=active_hands,
            status=RecorderState.RECORDING,
            recording_dir=recording_dir,
        )

    def _require_collection(self) -> HandMode:
        if self.collection_active_hands is None:
            raise InvalidTransitionError("collection has not been started")
        return self.collection_active_hands

    def _reset_after_review(self) -> None:
        self.current_recording = None
        self.current_state = RecorderState.IDLE
        self.pending_recording_events = []
        self.buffered_messages = []
