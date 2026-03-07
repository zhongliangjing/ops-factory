#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Java Gateway service control (includes goosed agent management)
#
# Usage: ./ctl.sh <action> [--background]
#   action: startup | shutdown | status | restart
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "${SCRIPT_DIR}")"
ROOT_DIR="$(dirname "${SERVICE_DIR}")"

# --- Configuration (env vars with defaults matching application.yml) ---
GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"
GATEWAY_SECRET_KEY="${GATEWAY_SECRET_KEY:-test}"
GOOSED_BIN="${GOOSED_BIN:-goosed}"
PROJECT_ROOT="${PROJECT_ROOT:-${ROOT_DIR}}"

# Maven path (auto-detect or use env)
MVN="${MVN:-mvn}"
if ! command -v "${MVN}" &>/dev/null; then
    # Try common fallback locations
    for candidate in /tmp/apache-maven-3.9.6/bin/mvn /usr/local/bin/mvn; do
        if [ -x "${candidate}" ]; then
            MVN="${candidate}"
            break
        fi
    done
fi

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
    local name="$1" url="$2" headers="${3:-}" attempts="${4:-40}" delay="${5:-1}"
    for ((i=1; i<=attempts; i++)); do
        if [ -n "${headers}" ]; then
            curl -fsS "${url}" -H "${headers}" >/dev/null 2>&1 && return 0
        else
            curl -fsS "${url}" >/dev/null 2>&1 && return 0
        fi
        sleep "${delay}"
    done
    log_error "${name} health check failed: ${url}"
    return 1
}

gateway_url() {
    local sk="${GATEWAY_SECRET_KEY}"
    for host in "${GATEWAY_HOST}" "127.0.0.1"; do
        if curl -fsS "http://${host}:${GATEWAY_PORT}/status" -H "x-secret-key: ${sk}" >/dev/null 2>&1; then
            echo "http://${host}:${GATEWAY_PORT}"; return 0
        fi
    done
    for host in "${GATEWAY_HOST}" "127.0.0.1"; do
        local code
        code="$(curl -s -o /dev/null -w "%{http_code}" "http://${host}:${GATEWAY_PORT}/status" 2>/dev/null || true)"
        [ "${code}" = "401" ] && { echo "http://${host}:${GATEWAY_PORT}"; return 0; }
    done
    return 1
}

# --- Build ---
build_gateway() {
    local jar="${SERVICE_DIR}/gateway-service/target/gateway-service.jar"

    # Skip build if JAR exists and no source changes
    if [ -f "${jar}" ]; then
        local jar_time
        jar_time="$(stat -f "%m" "${jar}" 2>/dev/null || stat -c "%Y" "${jar}" 2>/dev/null)"
        local newest_src
        newest_src="$(find "${SERVICE_DIR}" -name "*.java" -newer "${jar}" 2>/dev/null | head -1)"
        if [ -z "${newest_src}" ]; then
            log_info "JAR is up-to-date, skipping build"
            return 0
        fi
    fi

    log_info "Building Java gateway..."
    cd "${SERVICE_DIR}"
    "${MVN}" package -DskipTests -q || {
        log_error "Maven build failed"
        return 1
    }
    log_info "Build complete"
}

# --- Agents (goosed) helpers ---
shutdown_agents() {
    if pgrep -f goosed >/dev/null 2>&1; then
        log_info "Stopping goosed processes..."
        pkill -f goosed 2>/dev/null || true
        sleep 1
    fi
}

check_agents_configured() {
    local agents_json
    agents_json="$(curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/agents" \
        -H "x-secret-key: ${GATEWAY_SECRET_KEY}" 2>/dev/null || true)"
    [ -z "${agents_json}" ] && { log_error "Failed to query agents"; return 1; }

    # Parse with lightweight approach (no node dependency)
    local count
    count="$(echo "${agents_json}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('agents',d) if isinstance(d,dict) else d))" 2>/dev/null || echo "0")"

    if [ "${count}" -eq 0 ]; then
        log_error "No agents configured in gateway"
        return 1
    fi

    log_info "Agents configured (${count} total, instances spawn on demand)"
}

status_agents() {
    local base_url
    base_url="$(gateway_url 2>/dev/null)" || true

    if [ -n "${base_url}" ]; then
        local agents_json
        agents_json="$(curl -fsS "${base_url}/agents" -H "x-secret-key: ${GATEWAY_SECRET_KEY}" 2>/dev/null || true)"
        if [ -n "${agents_json}" ]; then
            local count
            count="$(echo "${agents_json}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d.get('agents',d) if isinstance(d,dict) else d))" 2>/dev/null || echo "0")"
            if [ "${count}" -eq 0 ]; then
                log_fail "No agents configured in gateway"
                return 1
            else
                log_ok "Agents configured (${count} total)"
            fi
        else
            log_fail "Failed to query /agents"
            return 1
        fi
    else
        log_warn "Gateway unreachable - cannot check agents"
        return 1
    fi
}

# --- Gateway actions ---
GATEWAY_PID=""

do_startup() {
    local mode="${1:-foreground}"
    shutdown_agents
    stop_port "${GATEWAY_PORT}" "gateway"

    build_gateway

    local jar="${SERVICE_DIR}/gateway-service/target/gateway-service.jar"
    local lib_dir="${SERVICE_DIR}/gateway-service/target/lib"
    local log4j_config="${SERVICE_DIR}/gateway-service/target/resources/log4j2.xml"

    if [ ! -f "${jar}" ]; then
        log_error "JAR not found: ${jar}"
        return 1
    fi

    log_info "Starting gateway at http://${GATEWAY_HOST}:${GATEWAY_PORT}"

    # Build Java command
    local java_cmd="java"
    local java_opts=(
        "-Dloader.path=${lib_dir}"
        "-Dserver.port=${GATEWAY_PORT}"
        "-Dserver.address=${GATEWAY_HOST}"
        "-Dgateway.secret-key=${GATEWAY_SECRET_KEY}"
        "-Dgateway.goosed-bin=${GOOSED_BIN}"
        "-Dgateway.paths.project-root=${PROJECT_ROOT}"
    )

    # Use external log4j2.xml if available
    if [ -f "${log4j_config}" ]; then
        java_opts+=("-Dlogging.config=file:${log4j_config}")
    fi

    java_opts+=("-jar" "${jar}")

    if [ "${mode}" = "background" ]; then
        ${java_cmd} "${java_opts[@]}" &
        GATEWAY_PID=$!
        if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
            log_error "Failed to start gateway"
            return 1
        fi
        if ! wait_http_ok "Gateway" "http://127.0.0.1:${GATEWAY_PORT}/status" \
                "x-secret-key: ${GATEWAY_SECRET_KEY}" 40 1; then
            log_error "Gateway failed to become healthy. Check logs."
            kill "${GATEWAY_PID}" 2>/dev/null || true
            return 1
        fi
        log_info "Gateway started (PID: ${GATEWAY_PID})"
        check_agents_configured || true
    else
        ${java_cmd} "${java_opts[@]}"
    fi
}

do_shutdown() {
    shutdown_agents
    stop_port "${GATEWAY_PORT}" "gateway"
}

do_status() {
    local has_fail=0
    if check_port "${GATEWAY_PORT}"; then
        if gateway_url >/dev/null 2>&1; then
            log_ok "Gateway running (http://localhost:${GATEWAY_PORT})"
        else
            log_fail "Gateway port open but /status check failed"
            has_fail=1
        fi
    else
        log_fail "Gateway not running on port ${GATEWAY_PORT}"
        has_fail=1
    fi
    status_agents || has_fail=1
    return "${has_fail}"
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
  startup     Build and start Java gateway (goosed agents spawn on demand)
  shutdown    Stop gateway and all goosed processes
  status      Check gateway and agent status
  restart     Restart gateway
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
