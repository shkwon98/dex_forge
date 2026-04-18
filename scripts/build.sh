#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"

cd "${REPO_ROOT}/web"
npm run build

cd "${WORKSPACE_ROOT}"
set +u
source /opt/ros/jazzy/setup.bash
set -u
colcon build --packages-select dex_forge --base-paths src

echo "DexForge build complete."
