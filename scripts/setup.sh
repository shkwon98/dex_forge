#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

python3 -m pip install --user -r requirements-dev.txt

cd "${REPO_ROOT}/web"
npm install

echo "DexForge setup complete."
