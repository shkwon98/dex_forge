from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
from typing import Any

import rosbag2_py
from rclpy.serialization import serialize_message


def ros_message_type(message: Any) -> str:
    module_parts = message.__class__.__module__.split(".")
    package_name = module_parts[0]
    return f"{package_name}/msg/{message.__class__.__name__}"


@dataclass
class BufferedMessage:
    topic: str
    message: Any
    timestamp_ns: int


class RosbagRecordingWriter:
    def write(self, bag_path: Path, buffered_messages: list[BufferedMessage]) -> None:
        if bag_path.exists():
            shutil.rmtree(bag_path)
        bag_path.parent.mkdir(parents=True, exist_ok=True)
        writer = rosbag2_py.SequentialWriter()
        writer.open(
            rosbag2_py.StorageOptions(uri=str(bag_path), storage_id="mcap"),
            rosbag2_py.ConverterOptions("", ""),
        )

        seen_topics: dict[str, str] = {}
        for index, item in enumerate(buffered_messages):
            if item.topic not in seen_topics:
                msg_type = ros_message_type(item.message)
                seen_topics[item.topic] = msg_type
                writer.create_topic(
                    rosbag2_py.TopicMetadata(
                        index,
                        item.topic,
                        msg_type,
                        "cdr",
                    )
                )
            writer.write(item.topic, serialize_message(item.message), item.timestamp_ns)
