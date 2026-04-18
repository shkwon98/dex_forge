#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"

cd "${WORKSPACE_ROOT}"
set +u
source /opt/ros/jazzy/setup.bash
source install/setup.bash
set -u

exec ros2 run dex_forge dex_forge_server
