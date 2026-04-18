from geometry_msgs.msg import PoseArray

from dex_forge.backend.service import LEFT_TOPIC, RIGHT_TOPIC
from dex_forge.dummy_pose_publisher import (
    DummyPublisherConfig,
    build_dummy_pose_array,
    topics_for_mode,
)


def test_build_dummy_pose_array_returns_25_joint_preview_points():
    message = build_dummy_pose_array(hand="left", tick=3)

    assert isinstance(message, PoseArray)
    assert message.header.frame_id == "dex_forge_dummy_left"
    assert len(message.poses) == 25
    assert message.poses[0].position.x != message.poses[1].position.x


def test_build_dummy_pose_array_mirrors_left_and_right_hands():
    left_message = build_dummy_pose_array(hand="left", tick=5)
    right_message = build_dummy_pose_array(hand="right", tick=5)

    assert left_message.poses[0].position.x == -right_message.poses[0].position.x
    assert left_message.poses[0].position.y == right_message.poses[0].position.y


def test_topics_for_mode_matches_expected_ros_topics():
    assert topics_for_mode(DummyPublisherConfig(hand_mode="left")) == [LEFT_TOPIC]
    assert topics_for_mode(DummyPublisherConfig(hand_mode="right")) == [RIGHT_TOPIC]
    assert topics_for_mode(DummyPublisherConfig(hand_mode="both")) == [LEFT_TOPIC, RIGHT_TOPIC]
