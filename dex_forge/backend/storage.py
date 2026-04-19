from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil

from .models import TaskLabel


class DatasetStorage:
    def __init__(self, dataset_root: Path):
        self.dataset_root = dataset_root
        self.tasks_root = self.dataset_root / "tasks"
        self.tasks_root.mkdir(parents=True, exist_ok=True)

    def task_id_for_prompt(self, prompt_text: str) -> str:
        return hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()

    def task_dir(self, task_id: str) -> Path:
        path = self.tasks_root / task_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def recording_dir(self, task_id: str) -> Path:
        task_dir = self.task_dir(task_id)
        existing_indices = sorted(
            int(path.name.split("_")[-1])
            for path in task_dir.iterdir()
            if path.is_dir()
            and path.name.startswith("recording_")
            and path.name.split("_")[-1].isdigit()
        )
        next_index = (existing_indices[-1] + 1) if existing_indices else 1
        return task_dir / f"recording_{next_index:06d}"

    def ensure_task_metadata(self, task_id: str, prompt_text: str, label: TaskLabel) -> Path:
        task_dir = self.task_dir(task_id)
        self._write_tasks_index(task_id, prompt_text)

        path = task_dir / "task.json"
        if path.exists():
            existing_payload = json.loads(path.read_text())
            if existing_payload.get("prompt_text") != prompt_text:
                raise ValueError("task metadata prompt text mismatch")
            if existing_payload.get("label") != label.model_dump():
                raise ValueError("task metadata label mismatch for identical prompt")

        recording_count = self.recording_count(task_id)
        payload = {
            "task_id": task_id,
            "prompt_text": prompt_text,
            "label": label.model_dump(),
            "recording_count": recording_count,
        }
        path.write_text(json.dumps(payload, indent=2))
        return path

    def recording_count(self, task_id: str) -> int:
        task_dir = self.task_dir(task_id)
        return len(
            [
                path
                for path in task_dir.iterdir()
                if path.is_dir() and path.name.startswith("recording_")
            ]
        )

    def remove_recording(self, recording_dir: Path) -> None:
        if recording_dir.exists():
            shutil.rmtree(recording_dir)

    def _write_tasks_index(self, task_id: str, prompt_text: str) -> None:
        path = self.tasks_root / "tasks.json"
        if path.exists():
            entries = json.loads(path.read_text())
        else:
            entries = []

        entries = [entry for entry in entries if entry.get("task_id") != task_id]
        entries.append({"task_id": task_id, "prompt_text": prompt_text})
        path.write_text(json.dumps(sorted(entries, key=lambda entry: entry["task_id"]), indent=2))
