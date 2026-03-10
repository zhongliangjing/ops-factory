#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Langfuse service control (Docker Compose)
#
# Usage: ./ctl.sh <action>
#   action: startup | shutdown | status | restart
#
# Configuration source: config.yaml > default
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "${SCRIPT_DIR}")"

# --- Configuration ---
COMPOSE_FILE="${SERVICE_DIR}/docker-compose.yml"

yaml_val() {
    local key="$1" file="${SERVICE_DIR}/config.yaml"
    [ -f "${file}" ] || return 0
    awk -F': ' -v k="${key}" '$1==k {print $2}' "${file}" | head -n1 | sed 's/^["'"'"']//;s/["'"'"']$//'
}

yaml_nested_val() {
    local section="$1" key="$2" file="${SERVICE_DIR}/config.yaml"
    [ -f "${file}" ] || return 0
    awk -F': ' -v section="${section}" -v key="${key}" '
      $0 ~ "^" section ":" { in_section=1; next }
      in_section && $0 ~ "^[^[:space:]]" { in_section=0 }
      in_section && $1 ~ "^[[:space:]]+" key "$" { print $2; exit }
    ' "${file}" | sed 's/^["'"'"']//;s/["'"'"']$//'
}

# --- Logging ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# --- Load config from config.yaml into environment ---
load_config() {
    export LANGFUSE_PORT="$(yaml_val port)"
    export POSTGRES_DB="$(yaml_nested_val postgres db)"
    export POSTGRES_USER="$(yaml_nested_val postgres user)"
    export POSTGRES_PASSWORD="$(yaml_nested_val postgres password)"
    export POSTGRES_PORT="$(yaml_nested_val postgres port)"
    export NEXTAUTH_SECRET="$(yaml_val nextauthSecret)"
    export SALT="$(yaml_val salt)"
    export TELEMETRY_ENABLED="$(yaml_val telemetryEnabled)"
    export LANGFUSE_INIT_ORG_ID="$(yaml_nested_val init orgId)"
    export LANGFUSE_INIT_ORG_NAME="$(yaml_nested_val init orgName)"
    export LANGFUSE_INIT_PROJECT_ID="$(yaml_nested_val init projectId)"
    export LANGFUSE_INIT_PROJECT_NAME="$(yaml_nested_val init projectName)"
    export LANGFUSE_INIT_PROJECT_PUBLIC_KEY="$(yaml_nested_val init projectPublicKey)"
    export LANGFUSE_INIT_PROJECT_SECRET_KEY="$(yaml_nested_val init projectSecretKey)"
    export LANGFUSE_INIT_USER_EMAIL="$(yaml_nested_val init userEmail)"
    export LANGFUSE_INIT_USER_NAME="$(yaml_nested_val init userName)"
    export LANGFUSE_INIT_USER_PASSWORD="$(yaml_nested_val init userPassword)"

    # Apply defaults (docker-compose.yml also has defaults, but these ensure
    # the shell variables used in this script are always set)
    : "${LANGFUSE_PORT:=3100}"
    : "${POSTGRES_DB:=langfuse}"
    : "${POSTGRES_USER:=langfuse}"
    : "${POSTGRES_PASSWORD:=langfuse}"
    : "${POSTGRES_PORT:=5432}"
    : "${NEXTAUTH_SECRET:=opsfactory-langfuse-secret-key}"
    : "${SALT:=opsfactory-langfuse-salt}"
    : "${TELEMETRY_ENABLED:=false}"
    : "${LANGFUSE_INIT_ORG_ID:=opsfactory}"
    : "${LANGFUSE_INIT_ORG_NAME:=ops-factory}"
    : "${LANGFUSE_INIT_PROJECT_ID:=opsfactory-agents}"
    : "${LANGFUSE_INIT_PROJECT_NAME:=ops-factory-agents}"
    : "${LANGFUSE_INIT_PROJECT_PUBLIC_KEY:=pk-lf-opsfactory}"
    : "${LANGFUSE_INIT_PROJECT_SECRET_KEY:=sk-lf-opsfactory}"
    : "${LANGFUSE_INIT_USER_EMAIL:=admin@opsfactory.local}"
    : "${LANGFUSE_INIT_USER_NAME:=admin}"
    : "${LANGFUSE_INIT_USER_PASSWORD:=opsfactory}"
}

# --- Utilities ---
wait_http_ok() {
    local name="$1" url="$2" attempts="${3:-60}" delay="${4:-1}"
    for ((i=1; i<=attempts; i++)); do
        curl -fsS "${url}" >/dev/null 2>&1 && return 0
        sleep "${delay}"
    done
    log_error "${name} health check failed: ${url}"
    return 1
}

# --- Langfuse actions ---
do_startup() {
    load_config

    if docker ps --format '{{.Names}}' | grep -q '^langfuse$'; then
        log_info "Langfuse already running"
    else
        log_info "Starting Langfuse (port ${LANGFUSE_PORT})..."
        docker compose -f "${COMPOSE_FILE}" up -d
    fi

    log_info "Checking Langfuse readiness (timeout: 60s)..."
    if ! wait_http_ok "Langfuse" "http://127.0.0.1:${LANGFUSE_PORT}/api/public/health" 60 1; then
        log_error "Langfuse health check failed"
        return 1
    fi
    log_info "Langfuse ready at http://localhost:${LANGFUSE_PORT}"
}

do_shutdown() {
    if docker ps --format '{{.Names}}' | grep -q '^langfuse$'; then
        log_info "Stopping Langfuse..."
        docker compose -f "${COMPOSE_FILE}" down
    fi
}

do_status() {
    load_config
    local port="${LANGFUSE_PORT}"
    if docker ps --format '{{.Names}}' | grep -q '^langfuse$'; then
        if curl -fsS "http://127.0.0.1:${port}/api/public/health" >/dev/null 2>&1; then
            log_ok "Langfuse running (http://localhost:${port})"
        else
            log_warn "Langfuse container running but health check failed"
            return 1
        fi
    else
        log_fail "Langfuse is not running"
        return 1
    fi
}

do_restart() {
    do_shutdown
    do_startup
}

# --- Main ---
usage() {
    cat <<EOF
Usage: $(basename "$0") <action>

Actions:
  startup     Start Langfuse (Docker Compose)
  shutdown    Stop Langfuse
  status      Check Langfuse status
  restart     Restart Langfuse
EOF
    exit 1
}

ACTION="${1:-}"
[ -z "${ACTION}" ] && usage

case "${ACTION}" in
    startup)  do_startup ;;
    shutdown) do_shutdown ;;
    status)   do_status ;;
    restart)  do_restart ;;
    -h|--help|help) usage ;;
    *) log_error "Unknown action: ${ACTION}"; usage ;;
esac
