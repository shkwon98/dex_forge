from datetime import UTC, datetime
import json

from geometry_msgs.msg import Point, Pose, PoseArray, Quaternion
import pytest
import rosbag2_py
from std_msgs.msg import String

from dex_forge.backend.models import ClipDecision, HandMode, RecorderState, Scenario
from dex_forge.backend.service import CollectionService, InvalidTransitionError


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


@pytest.fixture
def service(tmp_path):
    scenarios = [
        Scenario(
            id="pinch",
            category="pinch",
            action="precision",
            variation="thumb_index",
            prompt_text="Do a precision pinch.",
            difficulty="easy",
            allowed_hands="either",
            tags=["pinch"],
        )
    ]
    return CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=scenarios,
        scenario_version="test-v1",
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )


def test_start_requires_armed_clip(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)

    with pytest.raises(InvalidTransitionError):
        service.start_clip()


def test_stop_writes_clip_outputs_and_mcap_for_left_hand(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    prompt = service.next_prompt()
    service.arm_clip(prompt.id)

    start_time = datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC)
    stop_time = datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC)

    service.start_clip(start_time=start_time)
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
    clip = service.stop_clip(stop_time=stop_time)

    assert clip.status == RecorderState.REVIEW
    assert clip.frame_counts["/teleop/human/hand_left/pose"] == 2
    assert clip.recorded_topics == [
        "/collector/events",
        "/teleop/human/hand_left/pose",
    ]
    assert clip.clip_dir.joinpath("recording.mcap").exists()
    assert service.decide_clip(clip.clip_id, ClipDecision.ACCEPT).status == RecorderState.ACCEPTED

    topics = sorted(read_bag_topics(str(clip.clip_dir / "recording.mcap")))
    assert topics == ["/collector/events", "/teleop/human/hand_left/pose"]

    manifest = json.loads(clip.clip_dir.joinpath("clip_manifest.json").read_text())
    assert manifest["status"] == "accepted"
    assert manifest["active_hands"] == "left"
    assert manifest["label"]["action"] == "precision"


def test_stop_marks_clip_invalid_when_required_topic_has_no_frames(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    prompt = service.next_prompt()
    service.arm_clip(prompt.id)
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))

    clip = service.stop_clip(stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC))

    assert clip.status == RecorderState.INVALID
    assert clip.failure_reason == "missing_required_topic_frames"


def test_retry_preserves_original_clip_and_arms_replacement(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    prompt = service.next_prompt()
    service.arm_clip(prompt.id)
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    clip = service.stop_clip(stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC))

    replacement = service.decide_clip(clip.clip_id, ClipDecision.RETRY)

    assert clip.status == RecorderState.RETRIED
    assert replacement.clip_id != clip.clip_id
    assert replacement.label.action == clip.label.action
    assert service.current_state == RecorderState.ARMED


def test_add_note_is_written_to_event_log(service):
    service.create_session(operator_id="operator", active_hands=HandMode.RIGHT)
    prompt = service.next_prompt()
    service.arm_clip(prompt.id)
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))
    service.add_note("thumb was partially occluded")
    service.record_message(
        topic="/teleop/human/hand_right/pose",
        message=make_pose_array("right_hand"),
        timestamp_ns=1_000_000,
    )
    clip = service.stop_clip(stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC))
    service.decide_clip(clip.clip_id, ClipDecision.ACCEPT)

    events = [
        json.loads(line)
        for line in clip.clip_dir.joinpath("events.jsonl").read_text().splitlines()
    ]
    assert any(event["event_type"] == "note_added" for event in events)
