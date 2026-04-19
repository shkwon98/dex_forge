#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_DIR="${REPO_ROOT}/config/runtime"
CONFIG_FILE="${CONFIG_DIR}/ollama_model.txt"

select_ollama_model() {
	local selected_model=""

	echo "[dex_forge] Select the Ollama model to use for prompt generation:"
	echo "  1) qwen2.5:7b"
	echo "  2) qwen3:1.7b"
	echo "  3) qwen3:8b"
	printf "[dex_forge] Enter 1 or 2 or 3 [default: 1]: "

	local choice
	read -r choice

	case "${choice:-1}" in
		1)
			selected_model="qwen2.5:7b"
			;;
		2)
			selected_model="qwen3:1.7b"
			;;
		3)
			selected_model="qwen3:8b"
			;;
		*)
			echo "[dex_forge] Invalid selection: ${choice}"
			exit 1
			;;
	esac

	mkdir -p "${CONFIG_DIR}"
	printf '%s\n' "${selected_model}" > "${CONFIG_FILE}"
	echo "[dex_forge] Ollama model saved to ${CONFIG_FILE}: ${selected_model}"
}

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
	if ! ollama list >/dev/null 2>&1; then
		echo "[dex_forge] Ollama 데몬이 실행 중이 아닙니다. 백그라운드에서 시작합니다..."
		nohup ollama serve >/tmp/dex_forge_ollama.log 2>&1 &
		if ! wait_for_ollama; then
			echo "[dex_forge] Ollama 데몬 시작에 실패했습니다. /tmp/dex_forge_ollama.log 를 확인하세요."
			exit 1
		fi
	fi
}

ensure_selected_model_pulled() {
	local selected_model
	selected_model="$(tr -d '\r' < "${CONFIG_FILE}")"
	ensure_ollama_ready

	if ! ollama show "${selected_model}" >/dev/null 2>&1; then
		echo "[dex_forge] Ollama 모델 '${selected_model}' 이 없어 pull을 진행합니다..."
		ollama pull "${selected_model}"
	else
		echo "[dex_forge] Ollama model already available: ${selected_model}"
	fi
}

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
select_ollama_model
ensure_selected_model_pulled

cd "${REPO_ROOT}/web"
npm install

echo "DexForge setup complete."
