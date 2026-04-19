import hashlib

import ollama
import pytest

from dex_forge.backend.instruction_generator import (
    OllamaInstructionGenerator,
    parse_instruction_array,
)


def test_parse_instruction_array_accepts_strict_json_array():
    payload = '["A", "B", "C"]'
    parsed = parse_instruction_array(payload)
    assert parsed == ["A", "B", "C"]


def test_parse_instruction_array_recovers_array_from_wrapped_text_and_deduplicates():
    payload = 'result:\n["A", "B", "A", "  ", "C"]\nthanks'
    parsed = parse_instruction_array(payload)
    assert parsed == ["A", "B", "C"]


def test_parse_instruction_array_accepts_object_wrapped_list():
    payload = '{"instructions": ["A", "B"]}'
    parsed = parse_instruction_array(payload)
    assert parsed == ["A", "B"]


def test_ollama_generator_generate_scenario_uses_prompt_hash_for_action(
    monkeypatch,
):
    def fake_chat(model, messages, format):
        assert model == "test-model"
        assert format == "json"
        assert messages[0]["role"] == "user"
        return {
            "message": {
                "content": '["Point with the right index finger."]',
            }
        }

    monkeypatch.setattr(ollama, "chat", fake_chat)
    generator = OllamaInstructionGenerator(model="test-model")

    scenario = generator.generate_scenario()

    assert scenario.category == "generated"
    assert scenario.variation == "ollama"
    assert scenario.prompt_text == "Point with the right index finger."
    assert (
        scenario.action
        == hashlib.sha256(scenario.prompt_text.encode("utf-8")).hexdigest()
    )


def test_ollama_generator_calls_generate_api_and_returns_requested_count(
    monkeypatch,
):
    def fake_chat(model, messages, format):
        assert model == "test-model"
        assert format == "json"
        assert "Generate 2 HIGHLY DIVERSE, unique" in messages[0]["content"]
        return {
            "message": {
                "content": '["A", "B", "C"]',
            }
        }

    monkeypatch.setattr(ollama, "chat", fake_chat)
    generator = OllamaInstructionGenerator(model="test-model")

    result = generator.generate_instructions(2)
    assert result == ["A", "B"]


def test_ollama_generator_raises_if_not_enough_items(monkeypatch):
    def fake_chat(model, messages, format):
        return {
            "message": {
                "content": '["A"]',
            }
        }

    monkeypatch.setattr(ollama, "chat", fake_chat)
    generator = OllamaInstructionGenerator(model="test-model")

    with pytest.raises(ValueError, match="returned only 1 instructions"):
        generator.generate_instructions(2)


def test_ollama_generator_accepts_object_style_response(monkeypatch):
    class _Message:
        def __init__(self, content):
            self.content = content

    class _Response:
        def __init__(self, content):
            self.message = _Message(content)

    def fake_chat(model, messages, format):
        del model, messages, format
        return _Response('["A", "B"]')

    monkeypatch.setattr(ollama, "chat", fake_chat)
    generator = OllamaInstructionGenerator(model="test-model")

    result = generator.generate_instructions(2)
    assert result == ["A", "B"]
