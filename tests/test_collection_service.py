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


def test_start_uses_current_prompt_without_explicit_arm(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    prompt = service.next_prompt()

    clip = service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))

    assert clip.prompt_text == prompt.prompt_text
    assert clip.label.action == prompt.action
    assert service.current_state == RecorderState.RECORDING


def test_next_prompt_rotates_to_a_different_scenario_before_repeating(tmp_path):
    scenarios = [
        Scenario(
            id="prompt-a",
            category="grasp",
            action="power",
            variation="a",
            prompt_text="Prompt A",
            difficulty="easy",
            allowed_hands="either",
            tags=[],
        ),
        Scenario(
            id="prompt-b",
            category="pinch",
            action="precision",
            variation="b",
            prompt_text="Prompt B",
            difficulty="easy",
            allowed_hands="either",
            tags=[],
        ),
    ]
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=scenarios,
        scenario_version="test-v1",
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)

    first = service.next_prompt()
    second = service.next_prompt()

    assert second.id != first.id


def test_next_prompt_cycles_through_all_eligible_scenarios_before_repeating(tmp_path):
    scenarios = [
        Scenario(
            id="prompt-a",
            category="grasp",
            action="power",
            variation="a",
            prompt_text="Prompt A",
            difficulty="easy",
            allowed_hands="either",
            tags=[],
        ),
        Scenario(
            id="prompt-b",
            category="pinch",
            action="precision",
            variation="b",
            prompt_text="Prompt B",
            difficulty="easy",
            allowed_hands="either",
            tags=[],
        ),
        Scenario(
            id="prompt-c",
            category="gesture",
            action="spread",
            variation="c",
            prompt_text="Prompt C",
            difficulty="easy",
            allowed_hands="both",
            tags=[],
        ),
    ]
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=scenarios,
        scenario_version="test-v1",
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )
    service.create_session(operator_id="operator", active_hands=HandMode.BOTH)

    seen = [service.next_prompt().id for _ in range(3)]
    repeated = service.next_prompt().id

    assert seen == ["prompt-a", "prompt-b", "prompt-c"]
    assert repeated == "prompt-a"


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
    assert clip.review_preview["left"][0][0]["frame_id"] == "hand_frame"
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


def test_accept_clears_clip_state_and_allows_followup_recording(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    first_clip = service.stop_clip(stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC))

    service.decide_clip(first_clip.clip_id, ClipDecision.ACCEPT)

    assert service.current_clip is None
    assert service.current_state == RecorderState.IDLE

    service.next_prompt()
    second_clip = service.start_clip(start_time=datetime(2026, 4, 16, 12, 1, 0, tzinfo=UTC))

    assert second_clip.clip_id != first_clip.clip_id


def test_can_change_hand_mode_outside_recording(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    service.next_prompt()

    service.update_active_hands(HandMode.RIGHT)

    assert service.session is not None


def test_snapshot_includes_total_accepted_clip_count(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    clip = service.stop_clip(stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC))
    service.decide_clip(clip.clip_id, ClipDecision.ACCEPT)

    snapshot = service.snapshot()

    assert snapshot.accepted_clip_count == 1


def test_cannot_change_hand_mode_while_recording(service):
    service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))

    with pytest.raises(InvalidTransitionError):
        service.update_active_hands(HandMode.RIGHT)


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


def test_snapshot_includes_live_hand_pose_preview_outside_recording(service):
    service.create_session(operator_id="operator", active_hands=HandMode.BOTH)
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
    assert snapshot.hand_pose_preview["right"][0]["frame_id"] == "right_preview"


def test_create_session_can_override_dataset_root(tmp_path):
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
    service = CollectionService(
        dataset_root=tmp_path / "dataset-a",
        scenarios=scenarios,
        scenario_version="test-v1",
        min_duration_sec=0.05,
        min_frames_per_topic=1,
    )

    session = service.create_session(
        operator_id="operator",
        active_hands=HandMode.LEFT,
        dataset_root=tmp_path / "dataset-b",
    )

    assert service.storage.dataset_root == tmp_path / "dataset-b"
    assert (tmp_path / "dataset-b" / "sessions" / session.session_id / "session_manifest.json").exists()


def test_finish_session_returns_summary_with_dataset_root(service):
    session = service.create_session(operator_id="operator", active_hands=HandMode.LEFT)
    service.next_prompt()
    service.start_clip(start_time=datetime(2026, 4, 16, 12, 0, 0, tzinfo=UTC))
    service.record_message(
        topic="/teleop/human/hand_left/pose",
        message=make_pose_array(),
        timestamp_ns=1_000_000,
    )
    clip = service.stop_clip(stop_time=datetime(2026, 4, 16, 12, 0, 1, tzinfo=UTC))
    service.decide_clip(clip.clip_id, ClipDecision.ACCEPT)

    summary = service.finish_session()

    assert summary["session_id"] == session.session_id
    assert summary["accepted_count"] == 1
    assert summary["dataset_root"] == str(service.storage.dataset_root)
    assert service.session is None
    assert service.current_prompt is None
    assert service.current_clip is None
    assert service.current_state == RecorderState.IDLE
