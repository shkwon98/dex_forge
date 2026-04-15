from dex_forge.backend.models import HandMode, Scenario
from dex_forge.backend.scenario_library import ScenarioLibrary


def build_scenarios():
    return [
        Scenario(
            id="left-wave",
            category="gesture",
            action="wave",
            variation="left",
            prompt_text="Wave with the left hand.",
            difficulty="easy",
            allowed_hands="left",
            tags=["gesture"],
        ),
        Scenario(
            id="right-wave",
            category="gesture",
            action="wave",
            variation="right",
            prompt_text="Wave with the right hand.",
            difficulty="easy",
            allowed_hands="right",
            tags=["gesture"],
        ),
        Scenario(
            id="pinch",
            category="pinch",
            action="precision",
            variation="thumb_index",
            prompt_text="Do a precision pinch.",
            difficulty="easy",
            allowed_hands="either",
            tags=["pinch"],
        ),
        Scenario(
            id="handoff",
            category="coordination",
            action="handoff",
            variation="object_transfer",
            prompt_text="Transfer an imaginary object.",
            difficulty="medium",
            allowed_hands="both",
            tags=["coordination"],
        ),
    ]


def test_scenario_library_filters_by_hand_mode_and_avoids_recent_pairs():
    library = ScenarioLibrary(version="test", scenarios=build_scenarios())

    next_left = library.next_scenario(
        active_hands=HandMode.LEFT,
        recent_pairs=[("gesture", "wave")],
    )
    assert next_left.id == "pinch"

    next_both = library.next_scenario(
        active_hands=HandMode.BOTH,
        recent_pairs=[("pinch", "precision")],
    )
    assert next_both.id == "left-wave"
