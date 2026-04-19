from pathlib import Path

from dex_forge.main import resolve_ollama_model


def test_resolve_ollama_model_uses_default_when_config_missing(tmp_path):
    assert resolve_ollama_model(tmp_path) == "qwen2.5:7b"


def test_resolve_ollama_model_uses_runtime_config_file(tmp_path):
    config_dir = tmp_path / "config" / "runtime"
    config_dir.mkdir(parents=True)
    config_dir.joinpath("ollama_model.txt").write_text("qwen3.5:4b\n")

    assert resolve_ollama_model(tmp_path) == "qwen3.5:4b"
