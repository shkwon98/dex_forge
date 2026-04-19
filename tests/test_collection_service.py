import hashlib
import json
from datetime import UTC, datetime

import pytest
import rosbag2_py
import yaml
from geometry_msgs.msg import Point, Pose, PoseArray, Quaternion
from rclpy.serialization import deserialize_message
from std_msgs.msg import String

from dex_forge.backend.models import (
    HandMode,
    RecorderState,
    RecordingDecision,
    Scenario,
)
from dex_forge.backend.service import CollectionService, InvalidTransitionError


class StubPromptGenerator:
    def __init__(self, prompts: list[str]):
        self.prompts = prompts
        self.index = 0

    def generate_scenario(self) -> Scenario:
        prompt = self.prompts[self.index % len(self.prompts)]
        self.index += 1
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        return Scenario(
            category="generated",
            action=prompt_hash,
            variation="ollama",
            prompt_text=prompt,
        )


def make_pose_array(frame_id: str = "hand_frame") -> PoseArray:
    msg = PoseArray()
    msg.header.frame_id = frame_id
    pose = Pose()
    pose.position = Point(x=1.0, y=2.0, z=3.0)
    pose.orientation = Quaternion(x=0.0, y=0.0, z=0.0, w=1.0)
    msg.poses.append(pose)
    return msg


def read_bag_topics(uri: str) -> list[str]:
    reader = rosbag2_py.SequentialReader()
    reader.open(
        rosbag2_py.StorageOptions(uri=uri, storage_id="mcap"),
        rosbag2_py.ConverterOptions("", ""),
    )
    return [topic.name for topic in reader.get_all_topics_and_types()]


def read_event_records(uri: str) -> list[dict[str, object]]:
    reader = rosbag2_py.SequentialReader()
    reader.open(
        rosbag2_py.StorageOptions(uri=uri, storage_id="mcap"),
        rosbag2_py.ConverterOptions("", ""),
    )

    events: list[dict[str, object]] = []
    while reader.has_next():
        topic, data, _ = reader.read_next()
        if topic == "/collector/events":
            events.append(json.loads(deserialize_message(data, String).data))
    return events


@pytest.fixture
def service(tmp_path):
    return CollectionService(
        dataset_root=tmp_path / "dataset",
        prompt_generator=StubPromptGenerator(["Do a precision pinch."]),
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )


def test_start_recording_requires_prompt(service):
    service.start_collection(active_hands=HandMode.LEFT)

    with pytest.raises(InvalidTransitionError):
        service.start_recording()


def test_start_recording_uses_current_prompt(service):
    service.start_collection(active_hands=HandMode.LEFT)
    prompt = service.next_prompt()

    recording = service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )

    assert recording.prompt_text == prompt.prompt_text
    assert recording.label.action == prompt.action
    assert service.current_state == RecorderState.RECORDING


def test_next_prompt_cycles_through_all_prompts_before_repeating(tmp_path):
    generator = StubPromptGenerator(["Prompt A", "Prompt B", "Prompt C"])
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        prompt_generator=generator,
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )
    service.start_collection(active_hands=HandMode.BOTH)

    seen = [service.next_prompt().prompt_text for _ in range(3)]
    repeated = service.next_prompt().prompt_text

    assert seen == ["Prompt A", "Prompt B", "Prompt C"]
    assert repeated == "Prompt A"


def test_stop_writes_recording_outputs_and_accept_persists_review_event(
    service,
):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()

    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=2_000_000,
    )
    recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )

    assert recording.status == RecorderState.REVIEW
    assert recording.review_preview["left"][0][0]["frame_id"] == "hand_frame"
    assert recording.recorded_topics == [
        "/collector/events",
        "/teleop/human/hand_left/pose",
    ]
    assert list(recording.recording_dir.glob("*.mcap"))

    accepted = service.decide_recording(
        recording.recording_id, RecordingDecision.ACCEPT
    )

    assert accepted.status == RecorderState.ACCEPTED
    topics = sorted(read_bag_topics(str(recording.recording_dir)))
    assert topics == ["/collector/events", "/teleop/human/hand_left/pose"]
    events = read_event_records(str(recording.recording_dir))
    assert any(event["event_type"] == "review_accepted" for event in events)


def test_same_prompt_accumulates_recordings_under_one_task_folder(service):
    service.start_collection(active_hands=HandMode.LEFT)
    prompt = service.next_prompt()

    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    first_recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )
    service.decide_recording(
        first_recording.recording_id, RecordingDecision.ACCEPT
    )

    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 1, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=2_000_000,
    )
    second_recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 1, 1, tzinfo=UTC)
    )

    assert first_recording.task_id == second_recording.task_id
    assert (
        first_recording.task_id
        == hashlib.sha256(prompt.prompt_text.encode("utf-8")).hexdigest()
    )
    assert (
        first_recording.recording_dir.parent
        == second_recording.recording_dir.parent
    )
    assert first_recording.recording_dir.parent.name == first_recording.task_id
    assert first_recording.recording_dir.name == "recording_000001"
    assert second_recording.recording_dir.name == "recording_000002"

    tasks_index = json.loads(
        service.storage.tasks_root.joinpath("tasks.json").read_text()
    )
    assert tasks_index == [
        {
            "task_id": first_recording.task_id,
            "prompt_text": prompt.prompt_text,
        }
    ]
    assert not first_recording.recording_dir.joinpath("events.jsonl").exists()
    assert not first_recording.recording_dir.joinpath(
        "recording_manifest.json"
    ).exists()
    assert first_recording.recording_dir.joinpath("metadata.yaml").exists()

    metadata = yaml.safe_load(
        first_recording.recording_dir.joinpath("metadata.yaml").read_text()
    )
    bag_info = metadata["rosbag2_bagfile_information"]
    assert bag_info["storage_identifier"] == "mcap"
    assert any(
        topic["topic_metadata"]["name"] == "/teleop/human/hand_left/pose"
        for topic in bag_info["topics_with_message_count"]
    )


def test_discard_removes_recording_directory(service):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )

    discarded = service.decide_recording(
        recording.recording_id, RecordingDecision.DISCARD
    )

    assert discarded.status == RecorderState.DISCARDED
    assert not recording.recording_dir.exists()


def test_save_and_record_more_keeps_prompt_and_allows_next_recording(service):
    service.start_collection(active_hands=HandMode.LEFT)
    prompt = service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    first_recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )

    saved = service.decide_recording(
        first_recording.recording_id, RecordingDecision.RECORD_MORE
    )

    assert saved.status == RecorderState.ACCEPTED
    assert service.current_prompt is not None
    assert service.current_prompt.prompt_text == prompt.prompt_text
    assert service.current_state == RecorderState.IDLE

    second_recording = service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 1, 0, tzinfo=UTC)
    )
    assert second_recording.task_id == first_recording.task_id
    assert second_recording.recording_dir.name == "recording_000002"


def test_stop_marks_recording_invalid_when_required_topic_has_no_frames(
    service,
):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )

    recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )

    assert recording.status == RecorderState.INVALID
    assert recording.failure_reason == "missing_required_topic_frames"
    events = read_event_records(str(recording.recording_dir))
    assert any(
        event["event_type"] == "sanity_check_failed" for event in events
    )


def test_can_change_hand_mode_outside_recording(service):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()

    snapshot = service.update_active_hands(HandMode.RIGHT)

    assert snapshot.active_hands == HandMode.RIGHT


def test_snapshot_includes_total_accepted_recording_count(service):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )
    service.decide_recording(recording.recording_id, RecordingDecision.ACCEPT)

    snapshot = service.snapshot()

    assert snapshot.accepted_recording_count == 1


def test_cannot_change_hand_mode_while_recording(service):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )

    with pytest.raises(InvalidTransitionError):
        service.update_active_hands(HandMode.RIGHT)


def test_add_note_is_written_to_recording_event_stream(service):
    service.start_collection(active_hands=HandMode.RIGHT)
    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.add_note("thumb was partially occluded")
    service.record_message(
        topic="/teleop/human/hand_right/pose",
        message=make_pose_array("right_hand"),
        timestamp_ns=1_000_000,
    )
    recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )
    service.decide_recording(recording.recording_id, RecordingDecision.ACCEPT)

    events = read_event_records(str(recording.recording_dir))
    assert any(event["event_type"] == "note_added" for event in events)


def test_recording_dir_uses_next_highest_suffix_when_gaps_exist(service):
    task_id = service.storage.task_id_for_prompt("Do a precision pinch.")
    task_dir = service.storage.task_dir(task_id)
    task_dir.joinpath("recording_000002").mkdir()

    recording_dir = service.storage.recording_dir(task_id)

    assert recording_dir.name == "recording_000003"


def test_same_prompt_with_conflicting_label_raises_error(tmp_path):
    scenarios = [
        Scenario(
            category="grasp",
            action="power",
            variation="a",
            prompt_text="Shared prompt",
        ),
        Scenario(
            category="pinch",
            action="precision",
            variation="b",
            prompt_text="Shared prompt",
        ),
    ]
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        prompt_generator=StubPromptGenerator(["Shared prompt"]),
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )
    service.start_collection(active_hands=HandMode.LEFT)

    service.current_prompt = scenarios[0]
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.current_recording = None

    service.current_prompt = scenarios[1]
    with pytest.raises(ValueError, match="task metadata label mismatch"):
        service.start_recording(
            start_time=datetime(2026, 4, 16, 12, 1, 0, tzinfo=UTC)
        )


def test_snapshot_includes_live_hand_pose_preview_outside_recording(service):
    service.start_collection(active_hands=HandMode.BOTH)
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array("left_preview"),
        timestamp_ns=1_000_000,
    )
    service.record_message(
        topic="/teleop/human/hand_right/pose",
        message=make_pose_array("right_preview"),
        timestamp_ns=2_000_000,
    )

    snapshot = service.snapshot()

    assert snapshot.hand_pose_preview["left"][0]["x"] == 1.0
    assert (
        snapshot.hand_pose_preview["right"][0]["frame_id"] == "right_preview"
    )


def test_start_collection_can_override_dataset_root(tmp_path):
    service = CollectionService(
        dataset_root=tmp_path / "dataset-a",
        prompt_generator=StubPromptGenerator(["Do a precision pinch."]),
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )

    snapshot = service.start_collection(
        active_hands=HandMode.LEFT,
        dataset_root=tmp_path / "dataset-b",
    )

    assert service.storage.dataset_root == tmp_path / "dataset-b"
    task_id = service.storage.task_id_for_prompt("Do a precision pinch.")
    recording_dir = service.storage.recording_dir(task_id)
    assert snapshot.is_collecting is True
    assert (
        recording_dir
        == tmp_path
        / "dataset-b"
        / "tasks"
        / hashlib.sha256("Do a precision pinch.".encode("utf-8")).hexdigest()
        / "recording_000001"
    )


def test_finish_collection_returns_summary_with_dataset_root(service):
    service.start_collection(active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_recording(
        start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    )
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    recording = service.stop_recording(
        stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)
    )
    service.decide_recording(recording.recording_id, RecordingDecision.ACCEPT)

    summary = service.finish_collection()

    assert summary["accepted_count"] == 1
    assert summary["dataset_root"] == str(service.storage.dataset_root)
    assert service.collection_active_hands is None
    assert service.current_prompt is None
    assert service.current_recording is None
    assert service.current_state == RecorderState.IDLE
