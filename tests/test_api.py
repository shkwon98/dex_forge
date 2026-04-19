import os
from pathlib import Path
import subprocess
from unittest.mock import Mock

from fastapi.testclient import TestClient

from dex_forge.backend import api as api_module
from dex_forge.backend.api import create_app, pick_dataset_root, resolve_web_dist
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


def test_resolve_web_dist_prefers_newer_source_tree_over_stale_install(tmp_path):
    package_share = tmp_path / "share" / "dex_forge"
    installed_dist = package_share / "web" / "dist"
    installed_dist.mkdir(parents=True)
    installed_index = installed_dist / "index.html"
    installed_index.write_text("<html>installed</html>")

    project_root = tmp_path / "project"
    api_file = project_root / "dex_forge" / "backend" / "api.py"
    api_file.parent.mkdir(parents=True)
    api_file.write_text("# api")

    source_dist = project_root / "web" / "dist"
    source_dist.mkdir(parents=True)
    source_index = source_dist / "index.html"
    source_index.write_text("<html>source</html>")

    stale_time = installed_index.stat().st_mtime - 10
    source_time = source_index.stat().st_mtime + 10
    os.utime(installed_index, (stale_time, stale_time))
    os.utime(source_index, (source_time, source_time))

    resolved = resolve_web_dist(
        source_api_file=api_file,
        package_share_dir=package_share,
    )

    assert resolved == source_dist


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


def test_pick_dataset_root_prefers_zenity(monkeypatch):
    zenity_result = Mock(returncode=0, stdout="/tmp/dexforge\n")
    monkeypatch.setattr(api_module.shutil, "which", lambda name: "/usr/bin/zenity" if name == "zenity" else None)
    monkeypatch.setattr(api_module.subprocess, "run", lambda *args, **kwargs: zenity_result)

    selected = pick_dataset_root()

    assert selected == "/tmp/dexforge"


def test_pick_dataset_root_returns_empty_string_when_zenity_is_cancelled(monkeypatch):
    zenity_result = Mock(returncode=1, stdout="")
    monkeypatch.setattr(api_module.shutil, "which", lambda name: "/usr/bin/zenity" if name == "zenity" else None)
    monkeypatch.setattr(api_module.subprocess, "run", lambda *args, **kwargs: zenity_result)

    selected = pick_dataset_root()

    assert selected == ""


def test_pick_dataset_root_falls_back_to_tkinter_when_zenity_fails(monkeypatch):
    monkeypatch.setattr(api_module.shutil, "which", lambda name: "/usr/bin/zenity" if name == "zenity" else None)

    def raise_zenity_error(*args, **kwargs):
        raise subprocess.SubprocessError("zenity failed")

    monkeypatch.setattr(api_module.subprocess, "run", raise_zenity_error)
    tkinter_picker = Mock(return_value="/tmp/from-tk")
    monkeypatch.setattr(api_module, "_pick_dataset_root_with_tkinter", tkinter_picker)

    selected = pick_dataset_root()

    assert selected == "/tmp/from-tk"
    tkinter_picker.assert_called_once()
