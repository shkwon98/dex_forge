from pathlib import Path

from setuptools import find_packages, setup

package_name = "dex_forge"
project_root = Path(__file__).resolve().parent


def package_files(
    source_dir: Path, install_dir: str
) -> list[tuple[str, list[str]]]:
    if not source_dir.exists():
        return []

    packaged: list[tuple[str, list[str]]] = []
    for path in sorted(source_dir.rglob("*")):
        if path.is_file():
            relative_parent = path.parent.relative_to(source_dir)
            destination = Path(install_dir) / relative_parent
            packaged.append(
                (str(destination), [str(path.relative_to(project_root))])
            )
    return packaged


setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["tests"]),
    data_files=[
        (
            "share/ament_index/resource_index/packages",
            [f"resource/{package_name}"],
        ),
        (f"share/{package_name}", ["package.xml"]),
        *package_files(
            project_root / "web" / "dist",
            f"share/{package_name}/web/dist",
        ),
    ],
    install_requires=[
        "setuptools",
        "fastapi>=0.115,<1.0",
        "ollama>=0.4.7,<1.0",
        "pydantic>=2.10,<3.0",
        "uvicorn>=0.34,<1.0",
        "websockets>=12,<16",
    ],
    zip_safe=True,
    maintainer="shkwon98",
    maintainer_email="shkwon98@example.com",
    description="DexForge operator-driven hand motion data collection service and web UI.",
    license="Proprietary",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "dex_forge_server = dex_forge.main:main",
            "dex_forge_dummy_pose_publisher = dex_forge.dummy_pose_publisher:main",
        ],
    },
)
