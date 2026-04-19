from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .models import ClipLabel


class DatasetStorage:
    def __init__(self, dataset_root: Path):
        self.dataset_root = dataset_root
        self.tasks_root = self.dataset_root / "tasks"
        self.tasks_root.mkdir(parents=True, exist_ok=True)

    def task_id_for_prompt(self, prompt_text: str) -> str:
        digest = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
        return digest

    def task_dir(self, task_id: str) -> Path:
        path = self.tasks_root / task_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def recording_dir(self, task_id: str) -> Path:
        task_dir = self.task_dir(task_id)
        existing = sorted(
            path for path in task_dir.iterdir()
            if path.is_dir() and path.name.startswith("recording_")
        )
        next_index = len(existing) + 1
        return task_dir / f"recording_{next_index:06d}"

    def ensure_task_metadata(self, task_id: str, prompt_text: str, label: ClipLabel) -> Path:
        task_dir = self.task_dir(task_id)
        self._write_task_index(task_id, prompt_text)

        recording_count = len(
            [
                path
                for path in task_dir.iterdir()
                if path.is_dir() and path.name.startswith("recording_")
            ]
        )
        payload = {
            "task_id": task_id,
            "prompt_text": prompt_text,
            "label": label.model_dump(),
            "recording_count": recording_count,
        }
        path = task_dir / "task.json"
        path.write_text(json.dumps(payload, indent=2))
        return path

    def _write_task_index(self, task_id: str, prompt_text: str) -> None:
        path = self.tasks_root / "tasks.json"
        if path.exists():
            entries = json.loads(path.read_text())
        else:
            entries = []

        entries = [entry for entry in entries if entry.get("task_id") != task_id]
        entries.append(
            {
                "task_id": task_id,
                "prompt_text": prompt_text,
            }
        )
        path.write_text(json.dumps(sorted(entries, key=lambda entry: entry["task_id"]), indent=2))
