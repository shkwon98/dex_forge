from pathlib import Path

from fastapi.testclient import TestClient

from dex_forge.backend.api import create_app, resolve_web_dist
from dex_forge.backend.models import HandMode, Scenario
from dex_forge.backend.service import CollectionService


def test_resolve_web_dist_prefers_package_share_when_available(tmp_path):
    package_share = tmp_path / "share" / "dex_forge"
    dist_dir = package_share / "web" / "dist"
    dist_dir.mkdir(parents=True)
    dist_dir.joinpath("index.html").write_text("<html>ok</html>")

    resolved = resolve_web_dist(
        source_api_file=tmp_path / "dummy" / "backend" / "api.py",
        package_share_dir=package_share,
    )

    assert resolved == dist_dir


def test_resolve_web_dist_falls_back_to_source_tree(tmp_path):
    project_root = tmp_path / "project"
    api_file = project_root / "dex_forge" / "backend" / "api.py"
    api_file.parent.mkdir(parents=True)
    api_file.write_text("# api")

    dist_dir = project_root / "web" / "dist"
    dist_dir.mkdir(parents=True)
    dist_dir.joinpath("index.html").write_text("<html>ok</html>")

    resolved = resolve_web_dist(
        source_api_file=api_file,
        package_share_dir=tmp_path / "missing-share",
    )

    assert resolved == dist_dir


def test_api_supports_session_creation_and_prompt_flow(tmp_path):
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=[
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
        ],
        scenario_version="test-v1",
    )
    web_dist = tmp_path / "web" / "dist"
    web_dist.mkdir(parents=True)
    web_dist.joinpath("index.html").write_text("<html>ui</html>")

    app = create_app(service, web_dist=web_dist)
    client = TestClient(app)

    create_response = client.post(
        "/api/sessions",
        json={
            "operator_id": "operator",
            "active_hands": HandMode.LEFT.value,
            "notes": "test run",
        },
    )
    assert create_response.status_code == 200
    assert create_response.json()["active_hands"] == "left"

    prompt_response = client.post("/api/prompts/next")
    assert prompt_response.status_code == 200
    assert prompt_response.json()["id"] == "pinch"

    ui_response = client.get("/")
    assert ui_response.status_code == 200
    assert "ui" in ui_response.text


def test_api_updates_active_hands_for_the_current_session(tmp_path):
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=[
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
        ],
        scenario_version="test-v1",
    )
    web_dist = tmp_path / "web" / "dist"
    web_dist.mkdir(parents=True)
    web_dist.joinpath("index.html").write_text("<html>ui</html>")

    app = create_app(service, web_dist=web_dist)
    client = TestClient(app)

    client.post(
        "/api/sessions",
        json={
            "active_hands": HandMode.LEFT.value,
            "notes": "test run",
        },
    )

    update_response = client.post(
        "/api/sessions/active-hands",
        json={"active_hands": HandMode.BOTH.value},
    )

    assert update_response.status_code == 200
    assert update_response.json()["active_hands"] == "both"


def test_api_accepts_dataset_root_and_finishes_session(tmp_path):
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=[
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
        ],
        scenario_version="test-v1",
    )
    web_dist = tmp_path / "web" / "dist"
    web_dist.mkdir(parents=True)
    web_dist.joinpath("index.html").write_text("<html>ui</html>")

    app = create_app(service, web_dist=web_dist)
    client = TestClient(app)

    create_response = client.post(
        "/api/sessions",
        json={
            "active_hands": HandMode.LEFT.value,
            "dataset_root": str(tmp_path / "custom-dataset"),
        },
    )
    assert create_response.status_code == 200

    finish_response = client.post("/api/sessions/finish")
    assert finish_response.status_code == 200
    assert finish_response.json()["dataset_root"] == str(tmp_path / "custom-dataset")


def test_api_can_open_native_dataset_root_picker(tmp_path):
    service = CollectionService(
        dataset_root=tmp_path / "dataset",
        scenarios=[
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
        ],
        scenario_version="test-v1",
    )
    web_dist = tmp_path / "web" / "dist"
    web_dist.mkdir(parents=True)
    web_dist.joinpath("index.html").write_text("<html>ui</html>")

    app = create_app(
        service,
        web_dist=web_dist,
        dataset_root_picker=lambda: str(tmp_path / "picked-dataset"),
    )
    client = TestClient(app)

    response = client.post("/api/system/pick-dataset-root")

    assert response.status_code == 200
    assert response.json()["dataset_root"] == str(tmp_path / "picked-dataset")
