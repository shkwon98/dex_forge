from __future__ import annotations

import argparse
from dataclasses import dataclass
import math

from geometry_msgs.msg import Point, Pose, PoseArray, Quaternion
import rclpy
from rclpy.node import Node

from dex_forge.backend.service import LEFT_TOPIC, RIGHT_TOPIC


@dataclass(slots=True)
class DummyPublisherConfig:
    hand_mode: str = "both"
    publish_hz: float = 15.0


def build_dummy_pose_array(hand: str, tick: int) -> PoseArray:
    if hand not in {"left", "right"}:
        raise ValueError(f"unsupported hand: {hand}")

    message = PoseArray()
    message.header.frame_id = f"dex_forge_dummy_{hand}"
    mirror = 1.0 if hand == "left" else -1.0
    sway = math.sin(tick * 0.12) * 0.006

    for finger_index in range(5):
        for joint_index in range(5):
            pose = Pose()
            pose.position = Point(
                x=mirror * (0.02 + finger_index * 0.018 + joint_index * 0.009 + sway),
                y=0.025 + finger_index * 0.026 + joint_index * 0.014,
                z=0.01 * math.sin((tick * 0.18) + finger_index * 0.4 + joint_index * 0.22),
            )
            pose.orientation = Quaternion(x=0.0, y=0.0, z=0.0, w=1.0)
            message.poses.append(pose)

    return message


def topics_for_mode(config: DummyPublisherConfig) -> list[str]:
    if config.hand_mode == "left":
        return [LEFT_TOPIC]
    if config.hand_mode == "right":
        return [RIGHT_TOPIC]
    if config.hand_mode == "both":
        return [LEFT_TOPIC, RIGHT_TOPIC]
    raise ValueError(f"unsupported hand mode: {config.hand_mode}")


class DummyPosePublisherNode(Node):
    def __init__(self, config: DummyPublisherConfig):
        super().__init__("dex_forge_dummy_pose_publisher")
        self._config = config
        self._tick = 0
        self._topic_publishers = {
            topic: self.create_publisher(PoseArray, topic, 10)
            for topic in topics_for_mode(config)
        }
        period_sec = 1.0 / max(config.publish_hz, 1.0)
        self.create_timer(period_sec, self._publish_dummy_poses)
        self.get_logger().info(
            f"Publishing dummy hand poses on {', '.join(self._topic_publishers)} at {config.publish_hz:.1f} Hz"
        )

    def _publish_dummy_poses(self) -> None:
        self._tick += 1
        if LEFT_TOPIC in self._topic_publishers:
            self._topic_publishers[LEFT_TOPIC].publish(
                build_dummy_pose_array(hand="left", tick=self._tick)
            )
        if RIGHT_TOPIC in self._topic_publishers:
            self._topic_publishers[RIGHT_TOPIC].publish(
                build_dummy_pose_array(hand="right", tick=self._tick)
            )


def parse_args() -> DummyPublisherConfig:
    parser = argparse.ArgumentParser(description="Publish dummy DexForge hand PoseArray messages.")
    parser.add_argument(
        "--hand-mode",
        choices=["left", "right", "both"],
        default="both",
        help="Which hand topics to publish.",
    )
    parser.add_argument(
        "--publish-hz",
        type=float,
        default=15.0,
        help="Dummy pose publish rate.",
    )
    args = parser.parse_args()
    return DummyPublisherConfig(hand_mode=args.hand_mode, publish_hz=args.publish_hz)


def main() -> None:
    config = parse_args()
    rclpy.init()
    node = DummyPosePublisherNode(config)
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
