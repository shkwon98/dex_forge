from __future__ import annotations

from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HandMode(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    BOTH = "both"


class RecorderState(str, Enum):
    IDLE = "idle"
    RECORDING = "recording"
    REVIEW = "review"
    ACCEPTED = "accepted"
    DISCARDED = "discarded"
    INVALID = "invalid"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class RecordingDecision(str, Enum):
    ACCEPT = "accept"
    DISCARD = "discard"
    RECORD_MORE = "record_more"


class Scenario(BaseModel):
    category: str
    action: str
    variation: str
    prompt_text: str


class TaskLabel(BaseModel):
    category: str
    action: str
    variation: str


class EventRecord(BaseModel):
    timestamp: datetime
    recording_id: str | None
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class HandPosePoint(BaseModel):
    x: float
    y: float
    z: float
    frame_id: str = ""

    def __getitem__(self, key: str) -> float | str:
        return getattr(self, key)


class RecordingRecord(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, use_enum_values=False)

    recording_id: str
    task_id: str
    label: TaskLabel
    prompt_text: str
    active_hands: HandMode
    recorded_topics: list[str] = Field(default_factory=list)
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_sec: float = 0.0
    frame_counts: dict[str, int] = Field(default_factory=dict)
    bag_path: str = ""
    status: RecorderState
    failure_reason: str | None = None
    operator_note: str = ""
    review_preview: dict[str, list[list[HandPosePoint]]] = Field(default_factory=dict)
    recording_dir: Path


class CollectorSnapshot(BaseModel):
    is_collecting: bool
    active_hands: HandMode | None
    dataset_root: str | None = None
    accepted_recording_count: int = 0
    current_state: RecorderState
    current_prompt: Scenario | None
    hand_pose_preview: dict[str, list[HandPosePoint]] = Field(default_factory=dict)
    topic_health: dict[str, Any] = Field(default_factory=dict)
