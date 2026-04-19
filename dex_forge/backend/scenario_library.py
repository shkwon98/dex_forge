from __future__ import annotations

import json
from pathlib import Path

from .models import HandMode, Scenario


class ScenarioLibrary:
    def __init__(self, scenarios: list[Scenario]):
        self._scenarios = list(scenarios)

    @classmethod
    def from_path(cls, path: Path) -> "ScenarioLibrary":
        payload = json.loads(path.read_text())
        items = payload["scenarios"] if isinstance(payload, dict) else payload
        return cls(scenarios=[Scenario.model_validate(item) for item in items])

    def all(self) -> list[Scenario]:
        return list(self._scenarios)

    def supports(self, active_hands: HandMode, scenario: Scenario) -> bool:
        del active_hands, scenario
        return True

    def next_scenario(
        self,
        active_hands: HandMode,
        current_prompt_text: str | None = None,
        recent_pairs: list[tuple[str, str]] | None = None,
    ) -> Scenario:
        del active_hands
        if not self._scenarios:
            raise LookupError("no scenarios available")

        recent_pairs = recent_pairs or []
        ordered = sorted(
            self._scenarios,
            key=lambda scenario: (scenario.category, scenario.action) in recent_pairs,
        )
        if current_prompt_text and len(ordered) > 1:
            for index, scenario in enumerate(ordered):
                if scenario.prompt_text == current_prompt_text:
                    return ordered[(index + 1) % len(ordered)]
        return ordered[0]
