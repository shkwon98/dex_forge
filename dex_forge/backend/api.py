from __future__ import annotations

import asyncio
from pathlib import Path
import shutil
import subprocess

from ament_index_python.packages import PackageNotFoundError, get_package_share_directory
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

from .models import HandMode, RecordingDecision
from .service import CollectionService


class StartCollectionRequest(BaseModel):
    active_hands: HandMode
    dataset_root: str = ""


class UpdateActiveHandsRequest(BaseModel):
    active_hands: HandMode


class DecideRecordingRequest(BaseModel):
    decision: RecordingDecision


class AddNoteRequest(BaseModel):
    note: str


class TranslatePromptRequest(BaseModel):
    prompt_text: str


def _pick_dataset_root_with_tkinter() -> str:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        return filedialog.askdirectory(
            title="Select DexForge dataset root",
            mustexist=False,
        )
    finally:
        root.destroy()


def pick_dataset_root() -> str:
    try:
        zenity = shutil.which("zenity")
        if zenity:
            try:
                result = subprocess.run(
                    [
                        zenity,
                        "--file-selection",
                        "--directory",
                        "--title=Select DexForge dataset root",
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0:
                    return result.stdout.strip()
                if result.returncode == 1:
                    return ""
            except Exception:
                pass
        return _pick_dataset_root_with_tkinter()
    except Exception as error:
        raise RuntimeError("native directory picker unavailable") from error


def resolve_web_dist(
    source_api_file: Path | None = None,
    package_share_dir: Path | None = None,
) -> Path:
    def latest_mtime(dist_dir: Path) -> float:
        return max(
            (path.stat().st_mtime for path in dist_dir.rglob("*") if path.is_file()),
            default=0.0,
        )

    if package_share_dir is None:
        try:
            package_share_dir = Path(get_package_share_directory("dex_forge"))
        except PackageNotFoundError:
            package_share_dir = None

    installed_dist = None
    if package_share_dir is not None:
        installed_dist = package_share_dir / "web" / "dist"

    api_file = source_api_file or Path(__file__)
    source_dist = api_file.resolve().parents[2] / "web" / "dist"
    has_installed = installed_dist is not None and installed_dist.joinpath("index.html").exists()
    has_source = source_dist.joinpath("index.html").exists()

    if has_installed and has_source:
        if latest_mtime(source_dist) >= latest_mtime(installed_dist):
            return source_dist
        return installed_dist

    if has_installed:
        return installed_dist

    if has_source:
        return source_dist

    return source_dist


def create_app(
    service: CollectionService,
    web_dist: Path | None = None,
    dataset_root_picker=pick_dataset_root,
) -> FastAPI:
    app = FastAPI(title="DexForge")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    web_dist = web_dist or resolve_web_dist()
    assets_dir = web_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.post("/api/collection/start")
    def start_collection(request: StartCollectionRequest):
        return service.start_collection(
            active_hands=request.active_hands,
            dataset_root=request.dataset_root or None,
        )

    @app.get("/api/collection")
    def current_collection():
        return service.snapshot()

    @app.post("/api/collection/active-hands")
    def update_active_hands(request: UpdateActiveHandsRequest):
        return service.update_active_hands(request.active_hands)

    @app.post("/api/collection/finish")
    def finish_collection():
        return service.finish_collection()

    @app.post("/api/prompts/next")
    def next_prompt():
        return service.next_prompt()

    @app.post("/api/prompts/translate")
    def translate_prompt(request: TranslatePromptRequest):
        return {"translated_text": service.translate_prompt(request.prompt_text)}

    @app.post("/api/recordings/start")
    def start_recording():
        return service.start_recording()

    @app.post("/api/recordings/stop")
    def stop_recording():
        return service.stop_recording()

    @app.post("/api/recordings/{recording_id}/decision")
    def decide_recording(recording_id: str, request: DecideRecordingRequest):
        return service.decide_recording(recording_id, request.decision)

    @app.post("/api/events/note")
    def add_note(request: AddNoteRequest):
        service.add_note(request.note)
        return {"ok": True}

    @app.post("/api/system/pick-dataset-root")
    def choose_dataset_root():
        try:
            return {"dataset_root": dataset_root_picker()}
        except RuntimeError as error:
            raise HTTPException(status_code=503, detail=str(error)) from error

    @app.websocket("/ws/status")
    async def status(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                await websocket.send_json(service.snapshot().model_dump(mode="json"))
                await asyncio.sleep(1 / 30)
        except WebSocketDisconnect:
            return
        except Exception:
            return

    @app.get("/{path:path}")
    def serve_frontend(path: str):
        del path
        index = web_dist / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="frontend not built")

    return app
