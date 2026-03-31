#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBAPP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${WEBAPP_DIR}"

echo "[1/3] Installing frontend dependencies"
npm ci

echo "[2/3] Running basic smoke tests"
npm run test:basic

echo "[3/3] Building frontend"
npm run build

echo "Basic verification completed successfully."
