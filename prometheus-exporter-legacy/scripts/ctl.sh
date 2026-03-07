#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Prometheus Exporter service control
#
# Usage: ./ctl.sh <action> [--background]
#   action: startup | shutdown | status | restart
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "${SCRIPT_DIR}")"

# --- Configuration (read from config.yaml) ---
yaml_val() {
    local key="$1" file="${SERVICE_DIR}/config.yaml"
    [ -f "${file}" ] || return 0
    node -e "const y=require('yaml');const f=require('fs').readFileSync('${file}','utf-8');const c=y.parse(f);const keys='${key}'.split('.');let v=c;for(const k of keys){v=v?.[k]};if(v!=null)process.stdout.write(String(v))" 2>/dev/null || true
}

EXPORTER_PORT="$(yaml_val port)"
EXPORTER_PORT="${EXPORTER_PORT:-9091}"

# --- Logging ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# --- Utilities ---
check_port() { lsof -ti:"$1" >/dev/null 2>&1; }

stop_port() {
    local port=$1 name=$2
    if lsof -ti:"${port}" >/dev/null 2>&1; then
        log_info "Stopping ${name} on port ${port}..."
        kill $(lsof -ti:"${port}") 2>/dev/null || true
        sleep 1
    fi
}

wait_http_ok() {
    local name="$1" url="$2" attempts="${3:-15}" delay="${4:-1}"
    for ((i=1; i<=attempts; i++)); do
        curl -fsS "${url}" >/dev/null 2>&1 && return 0
        sleep "${delay}"
    done
    log_error "${name} health check failed: ${url}"
    return 1
}

# --- Exporter actions ---
EXPORTER_PID=""

do_startup() {
    local mode="${1:-foreground}"
    stop_port "${EXPORTER_PORT}" "exporter"

    log_info "Starting Prometheus Exporter at http://127.0.0.1:${EXPORTER_PORT}/metrics"
    cd "${SERVICE_DIR}"

    if [ "${mode}" = "background" ]; then
        npx tsx src/index.ts &
        EXPORTER_PID=$!
        if ! kill -0 "${EXPORTER_PID}" 2>/dev/null; then
            log_error "Failed to start exporter"
            return 1
        fi
        if ! wait_http_ok "Exporter" "http://127.0.0.1:${EXPORTER_PORT}/health" 15 1; then
            return 1
        fi
        log_info "Exporter started (PID: ${EXPORTER_PID})"
    else
        npx tsx src/index.ts
    fi
}

do_shutdown() {
    stop_port "${EXPORTER_PORT}" "exporter"
}

do_status() {
    if check_port "${EXPORTER_PORT}"; then
        if curl -fsS "http://127.0.0.1:${EXPORTER_PORT}/health" >/dev/null 2>&1; then
            log_ok "Exporter running (http://localhost:${EXPORTER_PORT}/metrics)"
        else
            log_warn "Exporter port open but health check failed"
            return 1
        fi
    else
        log_fail "Exporter not running on port ${EXPORTER_PORT}"
        return 1
    fi
}

do_restart() {
    do_shutdown
    do_startup "${MODE}"
}

# --- Main ---
usage() {
    cat <<EOF
Usage: $(basename "$0") <action> [--background]

Actions:
  startup     Start Prometheus Exporter
  shutdown    Stop exporter
  status      Check exporter status
  restart     Restart exporter
EOF
    exit 1
}

ACTION="${1:-}"
[ -z "${ACTION}" ] && usage
shift

MODE="foreground"
for arg in "$@"; do
    case "${arg}" in
        --background) MODE="background" ;;
    esac
done

case "${ACTION}" in
    startup)  do_startup "${MODE}" ;;
    shutdown) do_shutdown ;;
    status)   do_status ;;
    restart)  do_restart ;;
    -h|--help|help) usage ;;
    *) log_error "Unknown action: ${ACTION}"; usage ;;
esac
