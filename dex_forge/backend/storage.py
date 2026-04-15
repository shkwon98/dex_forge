from __future__ import annotations

import json
from pathlib import Path

from .models import ClipRecord, EventRecord, SessionRecord


class DatasetStorage:
    def __init__(self, dataset_root: Path):
        self.dataset_root = dataset_root
        self.sessions_root = self.dataset_root / "sessions"
        self.sessions_root.mkdir(parents=True, exist_ok=True)

    def write_scenario_version(self, version: str) -> None:
        path = self.dataset_root / "scenario_library_version.json"
        path.write_text(json.dumps({"version": version}, indent=2))

    def session_dir(self, session_id: str) -> Path:
        path = self.sessions_root / session_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def clip_dir(self, session_id: str, clip_id: str) -> Path:
        path = self.session_dir(session_id) / "clips" / clip_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def write_session_manifest(self, session: SessionRecord) -> Path:
        path = self.session_dir(session.session_id) / "session_manifest.json"
        path.write_text(json.dumps(session.model_dump(mode="json"), indent=2))
        return path

    def write_clip_manifest(self, clip: ClipRecord) -> Path:
        path = clip.clip_dir / "clip_manifest.json"
        path.write_text(json.dumps(clip.manifest_payload(), indent=2))
        return path

    def write_events(self, clip_dir: Path, events: list[EventRecord]) -> Path:
        path = clip_dir / "events.jsonl"
        lines = [json.dumps(event.model_dump(mode="json")) for event in events]
        path.write_text("\n".join(lines) + ("\n" if lines else ""))
        return path
