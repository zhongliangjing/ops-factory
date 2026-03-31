#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"

log_step() {
    echo
    echo "[$1] $2"
}

log_warn() {
    echo "[WARN] $1"
}

require_cmd() {
    local cmd="$1"
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "[ERROR] Missing required command: ${cmd}" >&2
        exit 1
    fi
}

run_npm_ci_if_present() {
    local dir="$1"
    if [[ -f "${dir}/package-lock.json" ]]; then
        (cd "${dir}" && npm ci)
    else
        (cd "${dir}" && npm install)
    fi
}

validate_docker_compose_if_available() {
    local dir="$1"
    local compose_file="${dir}/docker-compose.yml"

    if [[ ! -f "${compose_file}" ]]; then
        return 0
    fi

    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        (cd "${dir}" && docker compose -f docker-compose.yml config -q)
    else
        log_warn "Skipping docker compose validation for ${dir}; docker compose is not available"
    fi
}

require_cmd node
require_cmd npm
require_cmd java
require_cmd mvn

log_step "0/8" "Environment versions"
node --version
npm --version
java -version
mvn -version | sed -n '1,2p'

log_step "1/8" "Verifying web-app"
run_npm_ci_if_present "${ROOT_DIR}/web-app"
(cd "${ROOT_DIR}/web-app" && npm run test:basic)
(cd "${ROOT_DIR}/web-app" && npm run build)

log_step "2/8" "Verifying TypeScript SDK"
run_npm_ci_if_present "${ROOT_DIR}/typescript-sdk"
(cd "${ROOT_DIR}/typescript-sdk" && npm run test:basic)
(cd "${ROOT_DIR}/typescript-sdk" && npm run build)

log_step "3/8" "Verifying integration test package"
run_npm_ci_if_present "${ROOT_DIR}/test"
(cd "${ROOT_DIR}/test" && npm run test:basic)

log_step "4/8" "Verifying gateway"
(cd "${ROOT_DIR}/gateway" && mvn -pl gateway-common test)
(cd "${ROOT_DIR}/gateway" && mvn -DskipTests package)

log_step "5/8" "Verifying knowledge-service"
(cd "${ROOT_DIR}/knowledge-service" && mvn test)
(cd "${ROOT_DIR}/knowledge-service" && mvn -DskipTests package)

log_step "6/8" "Verifying prometheus-exporter"
(cd "${ROOT_DIR}/prometheus-exporter" && mvn test)
(cd "${ROOT_DIR}/prometheus-exporter" && mvn -DskipTests package)

log_step "7/8" "Checking docker-backed helper components"
validate_docker_compose_if_available "${ROOT_DIR}/langfuse"
validate_docker_compose_if_available "${ROOT_DIR}/onlyoffice"

log_step "8/8" "Basic repository verification completed"
echo "All required components passed basic verification."
