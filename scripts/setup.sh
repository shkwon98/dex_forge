#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

install_ollama_if_missing() {
	if command -v ollama >/dev/null 2>&1; then
		echo "[dex_forge] Ollama is already installed."
		return 0
	fi

	if [[ "$(uname -s)" != "Linux" ]]; then
		echo "[dex_forge] Ollama 자동 설치는 현재 Linux만 지원합니다."
		echo "[dex_forge] 수동 설치: https://ollama.com/download"
		exit 1
	fi

	echo "[dex_forge] Ollama가 설치되어 있지 않아 자동 설치를 진행합니다..."
	local installer
	installer="$(mktemp)"
	trap 'rm -f "${installer}"' RETURN
	curl -fsSL https://ollama.com/install.sh -o "${installer}"

	if [[ "${EUID}" -eq 0 ]]; then
		bash "${installer}"
	elif command -v sudo >/dev/null 2>&1; then
		sudo bash "${installer}"
	else
		echo "[dex_forge] Ollama 설치에 root 권한이 필요하지만 sudo를 찾을 수 없습니다."
		echo "[dex_forge] root로 실행하거나 sudo를 설치한 뒤 다시 시도하세요."
		exit 1
	fi

	if ! command -v ollama >/dev/null 2>&1; then
		echo "[dex_forge] Ollama 설치 후에도 'ollama' 명령을 찾을 수 없습니다."
		echo "[dex_forge] 새 터미널을 열어 PATH를 갱신한 뒤 다시 실행하세요."
		exit 1
	fi

	echo "[dex_forge] Ollama installation complete."
}

cd "${REPO_ROOT}"

python3 -m pip install --user -r requirements-dev.txt
install_ollama_if_missing

cd "${REPO_ROOT}/web"
npm install

echo "DexForge setup complete."
