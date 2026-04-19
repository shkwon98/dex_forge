#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"
OLLAMA_MODEL="qwen2.5:7b"

wait_for_ollama() {
	local retries=30
	local i
	for ((i=1; i<=retries; i++)); do
		if ollama list >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	return 1
}

ensure_ollama_ready() {
	if ! command -v ollama >/dev/null 2>&1; then
		echo "[dex_forge] 'ollama' CLI를 찾을 수 없습니다."
		echo "[dex_forge] https://ollama.com/download 에서 설치 후 다시 실행하세요."
		exit 1
	fi

	if ! ollama list >/dev/null 2>&1; then
		echo "[dex_forge] Ollama 데몬이 실행 중이 아닙니다. 백그라운드에서 시작합니다..."
		nohup ollama serve >/tmp/dex_forge_ollama.log 2>&1 &
		if ! wait_for_ollama; then
			echo "[dex_forge] Ollama 데몬 시작에 실패했습니다. /tmp/dex_forge_ollama.log 를 확인하세요."
			exit 1
		fi
	fi

	if ! ollama show "${OLLAMA_MODEL}" >/dev/null 2>&1; then
		echo "[dex_forge] Ollama 모델 '${OLLAMA_MODEL}' 이 없어 pull을 진행합니다..."
		ollama pull "${OLLAMA_MODEL}"
	fi
}

ensure_ollama_ready

cd "${WORKSPACE_ROOT}"
set +u
source /opt/ros/jazzy/setup.bash
source install/setup.bash
set -u

exec ros2 run dex_forge dex_forge_server
