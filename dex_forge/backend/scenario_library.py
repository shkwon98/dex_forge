from __future__ import annotations

import json
from pathlib import Path

from .models import HandMode, Scenario


class ScenarioLibrary:
    def __init__(self, version: str, scenarios: list[Scenario]):
        self.version = version
        self._scenarios = list(scenarios)

    @classmethod
    def from_path(cls, path: Path) -> "ScenarioLibrary":
        payload = json.loads(path.read_text())
        return cls(
            version=payload["version"],
            scenarios=[Scenario.model_validate(item) for item in payload["scenarios"]],
        )

    def all(self) -> list[Scenario]:
        return list(self._scenarios)

    def supports(self, active_hands: HandMode, scenario: Scenario) -> bool:
        return self._matches(active_hands, scenario.allowed_hands)

    def next_scenario(
        self,
        active_hands: HandMode,
        current_scenario_id: str | None = None,
        recent_pairs: list[tuple[str, str]] | None = None,
    ) -> Scenario:
        eligible = [scenario for scenario in self._scenarios if self._matches(active_hands, scenario.allowed_hands)]
        if not eligible:
            raise LookupError(f"no scenarios available for hand mode {active_hands.value}")

        recent_pairs = recent_pairs or []
        ordered = sorted(
            eligible,
            key=lambda scenario: (scenario.category, scenario.action) in recent_pairs,
        )
        if current_scenario_id and len(ordered) > 1:
            for index, scenario in enumerate(ordered):
                if scenario.id == current_scenario_id:
                    return ordered[(index + 1) % len(ordered)]
        return ordered[0]

    @staticmethod
    def _matches(active_hands: HandMode, allowed_hands: str) -> bool:
        if active_hands == HandMode.LEFT:
            return allowed_hands in {"left", "either"}
        if active_hands == HandMode.RIGHT:
            return allowed_hands in {"right", "either"}
        return allowed_hands in {"left", "right", "both", "either"}
