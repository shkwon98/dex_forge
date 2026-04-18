from __future__ import annotations

from pathlib import Path

from ament_index_python.packages import get_package_share_directory
import rclpy
import uvicorn

from dex_forge.backend.api import create_app
from dex_forge.backend.ros_node import HandCollectorNode, RosSpinThread
from dex_forge.backend.scenario_library import ScenarioLibrary
from dex_forge.backend.service import CollectionService


def build_service() -> CollectionService:
    package_root = Path(get_package_share_directory("dex_forge"))
    scenario_library = ScenarioLibrary.from_path(
        package_root / "config" / "scenarios" / "default_scenarios.json"
    )
    dataset_root = Path.cwd() / "dataset"
    return CollectionService(
        dataset_root=dataset_root,
        scenarios=scenario_library.all(),
        scenario_version=scenario_library.version,
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
