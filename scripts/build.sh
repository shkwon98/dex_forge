#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"
CONFIG_DIR="${REPO_ROOT}/config/runtime"
CONFIG_FILE="${CONFIG_DIR}/ollama_model.txt"
DEFAULT_MODEL="qwen2.5:7b"

ensure_model_config_file() {
  mkdir -p "${CONFIG_DIR}"
  if [[ ! -f "${CONFIG_FILE}" ]] || [[ -z "$(tr -d '[:space:]' < "${CONFIG_FILE}")" ]]; then
    printf '%s\n' "${DEFAULT_MODEL}" > "${CONFIG_FILE}"
    echo "[dex_forge] No Ollama model config found. Defaulting to ${DEFAULT_MODEL}."
  fi
}

ensure_model_config_file

cd "${REPO_ROOT}/web"
npm run build

cd "${WORKSPACE_ROOT}"
set +u
source /opt/ros/jazzy/setup.bash
set -u
colcon build --packages-select dex_forge --base-paths src

echo "DexForge build complete."
