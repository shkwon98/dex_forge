from __future__ import annotations

import asyncio
from pathlib import Path

from ament_index_python.packages import PackageNotFoundError, get_package_share_directory
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

from .models import ClipDecision, HandMode
from .service import CollectionService


class CreateSessionRequest(BaseModel):
    operator_id: str = ""
    active_hands: HandMode
    notes: str = ""
    dataset_root: str = ""
    collection_setup: dict = {}


class UpdateActiveHandsRequest(BaseModel):
    active_hands: HandMode


class ArmClipRequest(BaseModel):
    scenario_id: str


class DecideClipRequest(BaseModel):
    decision: ClipDecision


class AddNoteRequest(BaseModel):
    note: str


def pick_dataset_root() -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            selected = filedialog.askdirectory(
                title="Select DexForge dataset root",
                mustexist=False,
            )
        finally:
            root.destroy()
    except Exception as error:
        raise RuntimeError("native directory picker unavailable") from error

    return selected


def resolve_web_dist(
    source_api_file: Path | None = None,
    package_share_dir: Path | None = None,
) -> Path:
    if package_share_dir is None:
        try:
            package_share_dir = Path(get_package_share_directory("dex_forge"))
        except PackageNotFoundError:
            package_share_dir = None

    if package_share_dir is not None:
        installed_dist = package_share_dir / "web" / "dist"
        if installed_dist.joinpath("index.html").exists():
            return installed_dist

    api_file = source_api_file or Path(__file__)
    source_dist = api_file.resolve().parents[2] / "web" / "dist"
    if source_dist.joinpath("index.html").exists():
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

    @app.post("/api/sessions")
    def create_session(request: CreateSessionRequest):
        return service.create_session(
            operator_id=request.operator_id,
            active_hands=request.active_hands,
            notes=request.notes,
            dataset_root=request.dataset_root or None,
            collection_setup=request.collection_setup,
        )

    @app.get("/api/sessions/current")
    def current_session():
        return service.snapshot()

    @app.post("/api/sessions/active-hands")
    def update_active_hands(request: UpdateActiveHandsRequest):
        return service.update_active_hands(request.active_hands)

    @app.post("/api/sessions/finish")
    def finish_session():
        return service.finish_session()

    @app.post("/api/prompts/next")
    def next_prompt():
        return service.next_prompt()

    @app.post("/api/clips/arm")
    def arm_clip(request: ArmClipRequest):
        return service.arm_clip(request.scenario_id)

    @app.post("/api/clips/start")
    def start_clip():
        return service.start_clip()

    @app.post("/api/clips/stop")
    def stop_clip():
        return service.stop_clip()

    @app.post("/api/clips/{clip_id}/decision")
    def decide_clip(clip_id: str, request: DecideClipRequest):
        return service.decide_clip(clip_id, request.decision)

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

    @app.get("/api/history")
    def history():
        return service.snapshot().recent_history

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
        index = web_dist / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="frontend not built")

    return app
