from dex_forge.backend.models import HandMode, Scenario
from dex_forge.backend.scenario_library import ScenarioLibrary


def build_scenarios():
    return [
        Scenario(
            category="gesture",
            action="wave",
            variation="soft",
            prompt_text="Wave softly.",
        ),
        Scenario(
            category="pinch",
            action="precision",
            variation="thumb_index",
            prompt_text="Do a precision pinch.",
        ),
        Scenario(
            category="grasp",
            action="power",
            variation="wide",
            prompt_text="Perform a wide power grasp.",
        ),
    ]


def test_scenario_library_rotates_prompts_and_avoids_recent_pairs():
    library = ScenarioLibrary(scenarios=build_scenarios())

    next_prompt = library.next_scenario(
        active_hands=HandMode.LEFT,
        recent_pairs=[("gesture", "wave")],
    )
    assert next_prompt.prompt_text == "Do a precision pinch."

    rotated = library.next_scenario(
        active_hands=HandMode.BOTH,
        current_prompt_text="Do a precision pinch.",
        recent_pairs=[("gesture", "wave")],
    )
    assert rotated.prompt_text == "Perform a wide power grasp."
