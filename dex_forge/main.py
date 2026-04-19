from __future__ import annotations

from pathlib import Path

import rclpy
import uvicorn
from ament_index_python.packages import get_package_share_directory

from dex_forge.backend.api import create_app
from dex_forge.backend.instruction_generator import OllamaInstructionGenerator
from dex_forge.backend.ros_node import HandCollectorNode, RosSpinThread
from dex_forge.backend.service import CollectionService


def resolve_project_root() -> Path:
    candidate = Path(__file__).resolve().parents[1]
    if candidate.joinpath("package.xml").exists():
        return candidate
    return Path(get_package_share_directory("dex_forge"))


def build_service() -> CollectionService:
    project_root = resolve_project_root()
    dataset_root = project_root / "dataset"
    dataset_root.mkdir(parents=True, exist_ok=True)
    generator = OllamaInstructionGenerator(
        model="qwen2.5:7b",
    )

    return CollectionService(
        dataset_root=dataset_root,
        prompt_generator=generator,
    )


def main() -> None:
    rclpy.init()
    service = build_service()
    node = HandCollectorNode(service)
    ros_thread = RosSpinThread(node)
    ros_thread.start()

    app = create_app(service)
    try:
        uvicorn.run(app, host="0.0.0.0", port=8010)
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        ros_thread.join(timeout=2.0)
