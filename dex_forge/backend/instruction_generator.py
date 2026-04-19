from __future__ import annotations

import hashlib
import json
import re
from collections import OrderedDict
from typing import Any

import ollama
from deep_translator import GoogleTranslator

from .models import Scenario


def build_instruction_prompt(num_items: int) -> str:
    return f"""
You are an expert in human gestures and hand kinematics.
Generate {num_items} HIGHLY DIVERSE, unique, and concise instructions for an ISOLATED SINGLE human hand.

Examples of diverse instructions:
- Point with the right index finger and press downward once.
- Rotate the wrist 90 degrees outward while keeping all fingers straight.
- Make a circle with the thumb and index finger, then release.
- Squeeze the hand into a tight fist, hold for a second, then open it wide.
- Tap the pad of the thumb sequentially against the tips of all other fingers.

STRICT RULES:
1. EXTREME DIVERSITY (CRITICAL): Every single instruction MUST be fundamentally different. DO NOT repeat the same action (e.g., Do not generate multiple "Bend the [finger]" instructions). 
2. VARY YOUR VERBS: Force yourself to use different kinematics such as: spread, pinch, rotate, tap, swipe, flick, squeeze, curl, extend.
3. ISOLATED HAND ONLY: Completely self-contained. DO NOT interact with the face, arms, torso, or external objects.
4. ANATOMICAL ACCURACY: You can bend/curl/extend *fingers*, but you CANNOT "curl" a knuckle.
5. Output STRICTLY as a JSON array of strings. Do not add any conversational text.

Valid JSON format example:
["instruction 1", "instruction 2", "instruction 3"]
""".strip()


def parse_instruction_array(raw_text: str) -> list[str]:
    import ast
    import logging

    logger = logging.getLogger("dex_forge.instruction_generator")
    text = raw_text.strip()
    payload: Any = None
    # 1. Try JSON parse
    try:
        payload = json.loads(text)
    except Exception:
        # 2. Try to recover JSON array from text
        match = re.search(r"\[[\s\S]*\]", text)
        if match:
            try:
                payload = json.loads(match.group(0))
            except Exception:
                pass
        # 3. Try ast.literal_eval for stringified list
        if payload is None:
            try:
                payload = ast.literal_eval(text)
            except Exception:
                logger.error(
                    f"Ollama response is not valid JSON or Python literal: {raw_text}"
                )
                raise ValueError(
                    "ollama response is not valid JSON or Python literal"
                )

    # 4. If dict, try to extract array value or string value
    if isinstance(payload, dict):
        arr = None
        # 4-1. Try to find a list value
        for v in payload.values():
            if isinstance(v, list):
                arr = v
                break
        # 4-2. If not found, try to find a string value
        if arr is None:
            for v in payload.values():
                if isinstance(v, str):
                    arr = [v]
                    break
        # 4-3. Maybe nested dict with array inside
        if arr is None:
            for v in payload.values():
                if isinstance(v, dict):
                    for vv in v.values():
                        if isinstance(vv, list):
                            arr = vv
                            break
        # 4-4. Maybe nested dict with string inside
        if arr is None:
            for v in payload.values():
                if isinstance(v, dict):
                    for vv in v.values():
                        if isinstance(vv, str):
                            arr = [vv]
                            break
        if arr is not None:
            payload = arr
        else:
            logger.error(
                f"Ollama response JSON object does not contain an array or string value: {raw_text}"
            )
            raise ValueError(
                "ollama response JSON object does not contain an array or string value"
            )

    # 5. If not a list, but a single string, wrap as list
    if isinstance(payload, str):
        payload = [payload]

    if not isinstance(payload, list):
        logger.error(f"Ollama response is not a list: {raw_text}")
        raise ValueError("ollama response must be a JSON array of strings")

    # 6. Ensure all elements are strings (cast if possible)
    normalized: list[str] = []
    for i, item in enumerate(payload):
        if not isinstance(item, str):
            try:
                item = str(item)
            except Exception:
                logger.error(
                    f"Ollama response array element at index {i} is not a string: {item} (raw: {raw_text})"
                )
                raise ValueError(
                    f"ollama response array element at index {i} is not a string: {item}"
                )
        stripped = item.strip()
        if stripped:
            normalized.append(stripped)

    # Preserve order while dropping duplicates.
    return list(OrderedDict.fromkeys(normalized))


class OllamaInstructionGenerator:
    def __init__(
        self,
        *,
        model: str,
    ):
        self.model = model

    def generate_instructions(self, num_items: int) -> list[str]:
        if num_items <= 0:
            raise ValueError("num_items must be positive")

        response = ollama.chat(
            model=self.model,
            messages=[
                {
                    "role": "user",
                    "content": build_instruction_prompt(num_items),
                }
            ],
            format="json",
            options={
                "temperature": 0.9,  # 기본값보다 높여서 창의성 부여
                "presence_penalty": 1.5,  # 새로운 주제를 말하도록 유도
                "frequency_penalty": 1.5,  # 썼던 단어 반복 금지
            },
        )

        raw_text = self._extract_message_content(response)
        if not isinstance(raw_text, str):
            raise ValueError(
                "ollama response payload missing message.content string"
            )

        instructions = parse_instruction_array(raw_text)
        if len(instructions) < num_items:
            raise ValueError(
                f"ollama returned only {len(instructions)} instructions (requested {num_items})"
            )
        return instructions[:num_items]

    def generate_instruction(self) -> str:
        return self.generate_instructions(1)[0]

    def translate_instruction(self, text: str) -> str:
        if not text.strip():
            return ""
        return (
            GoogleTranslator(source="auto", target="ko")
            .translate(text)
            .strip()
        )

    def generate_scenario(self) -> Scenario:
        prompt_text = self.generate_instruction()
        prompt_hash = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
        return Scenario(
            category="generated",
            action=prompt_hash,
            variation="ollama",
            prompt_text=prompt_text,
        )

    @staticmethod
    def _extract_message_content(response: Any) -> str | None:
        if isinstance(response, dict):
            message = response.get("message")
        else:
            message = getattr(response, "message", None)

        if isinstance(message, dict):
            content = message.get("content")
        else:
            content = getattr(message, "content", None)

        return content if isinstance(content, str) else None
