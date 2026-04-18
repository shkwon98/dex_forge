from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def test_required_repo_scripts_exist_and_are_executable():
    for relative_path in (
        "scripts/setup.sh",
        "scripts/build.sh",
        "scripts/run_server.sh",
    ):
        script_path = REPO_ROOT / relative_path
        assert script_path.exists(), f"missing script: {relative_path}"
        assert script_path.stat().st_mode & 0o111, f"script is not executable: {relative_path}"


def test_readme_references_repo_scripts_for_setup_build_and_run():
    readme = (REPO_ROOT / "README.md").read_text()

    assert "./scripts/setup.sh" in readme
    assert "./scripts/build.sh" in readme
    assert "./scripts/run_server.sh" in readme
