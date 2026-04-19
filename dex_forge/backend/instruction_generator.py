from __future__ import annotations

import hashlib
import json
import re
from collections import OrderedDict
from typing import Any

import ollama

from .models import Scenario


def build_instruction_prompt(num_items: int) -> str:
    return f"""
You are an expert in human gestures and hand kinematics.
Generate {num_items} unique, distinct, and concise instructions for a SINGLE human hand.

Examples of good instructions:
- Point with the right index finger and press downward once.
- Make a circle with the thumb and index finger, then release.
- Curl the middle, ring, and pinky fingers into the palm while keeping the index and thumb straight.
- Rub the pad of the thumb against the side of the index finger.
- Spread all five fingers as far apart as possible, then relax.

Rules:
1. Only describe actions that are physically natural for a human hand.
2. You can utilize the palm, back of the hand, knuckles, and basic wrist twists.
3. Be concise, precise, and unambiguous.
4. Output STRICTLY as a JSON array of strings. Do not add any conversational text or markdown formatting outside the array.

Valid JSON format example:
[\"instruction 1\", \"instruction 2\", \"instruction 3\"]
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

    # 4. If dict, try to extract array value
    if isinstance(payload, dict):
        arr = None
        for v in payload.values():
            if isinstance(v, list):
                arr = v
                break
        if arr is None:
            # Maybe nested dict with array inside
            for v in payload.values():
                if isinstance(v, dict):
                    for vv in v.values():
                        if isinstance(vv, list):
                            arr = vv
                            break
        if arr is not None:
            payload = arr
        else:
            logger.error(
                f"Ollama response JSON object does not contain an array value: {raw_text}"
            )
            raise ValueError(
                "ollama response JSON object does not contain an array value"
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
