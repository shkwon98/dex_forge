from __future__ import annotations

from threading import Thread

from geometry_msgs.msg import PoseArray
import rclpy
from rclpy.executors import ExternalShutdownException
from rclpy.node import Node

from .service import LEFT_TOPIC, RIGHT_TOPIC, CollectionService


class HandCollectorNode(Node):
    def __init__(self, service: CollectionService):
        super().__init__("dex_forge")
        self._service = service
        self.create_subscription(PoseArray, LEFT_TOPIC, self._on_left_pose, 10)
        self.create_subscription(PoseArray, RIGHT_TOPIC, self._on_right_pose, 10)

    def _on_left_pose(self, msg: PoseArray) -> None:
        self._service.record_message(
            topic=LEFT_TOPIC,
            message=msg,
            timestamp_ns=self.get_clock().now().nanoseconds,
        )

    def _on_right_pose(self, msg: PoseArray) -> None:
        self._service.record_message(
            topic=RIGHT_TOPIC,
            message=msg,
            timestamp_ns=self.get_clock().now().nanoseconds,
        )


class RosSpinThread(Thread):
    def __init__(self, node: Node):
        super().__init__(daemon=True)
        self._node = node

    def run(self) -> None:
        try:
            rclpy.spin(self._node)
        except (KeyboardInterrupt, ExternalShutdownException):
            pass
