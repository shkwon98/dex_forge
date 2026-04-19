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
    ARMED = "armed"
    RECORDING = "recording"
    REVIEW = "review"
    ACCEPTED = "accepted"
    DISCARDED = "discarded"
    RETRIED = "retried"
    INVALID = "invalid"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class ClipDecision(str, Enum):
    ACCEPT = "accept"
    DISCARD = "discard"
    RETRY = "retry"


class Scenario(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    id: str
    category: str
    action: str
    variation: str
    prompt_text: str
    difficulty: str
    allowed_hands: str
    tags: list[str] = Field(default_factory=list)


class ClipLabel(BaseModel):
    category: str
    action: str
    variation: str


class SessionRecord(BaseModel):
    session_id: str
    active_hands: HandMode
    started_at: datetime
    ended_at: datetime | None = None
    notes: str = ""
    collection_setup: dict[str, Any] = Field(default_factory=dict)


class EventRecord(BaseModel):
    timestamp: datetime
    session_id: str
    clip_id: str | None
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class HandPosePoint(BaseModel):
    x: float
    y: float
    z: float
    frame_id: str = ""

    def __getitem__(self, key: str) -> float | str:
        return getattr(self, key)


class ClipRecord(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True, use_enum_values=False)

    clip_id: str
    task_id: str
    session_id: str
    label: ClipLabel
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
    clip_dir: Path


class SessionSnapshot(BaseModel):
    session_id: str | None
    active_hands: HandMode | None
    dataset_root: str | None = None
    accepted_clip_count: int = 0
    current_state: RecorderState
    current_prompt: Scenario | None
    hand_pose_preview: dict[str, list[HandPosePoint]] = Field(default_factory=dict)
    topic_health: dict[str, Any] = Field(default_factory=dict)
