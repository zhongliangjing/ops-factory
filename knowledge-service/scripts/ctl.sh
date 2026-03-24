#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_DIR="$(dirname "${SCRIPT_DIR}")"

yaml_val() {
    local key="$1" file="${SERVICE_DIR}/config.yaml"
    [ -f "${file}" ] || return 0
    node -e "const y=require('yaml');const f=require('fs').readFileSync('${file}','utf-8');const c=y.parse(f);const keys='${key}'.split('.');let v=c;for(const k of keys){v=v?.[k]};if(v!=null)process.stdout.write(String(v))" 2>/dev/null || true
}

KNOWLEDGE_PORT="${KNOWLEDGE_PORT:-$(yaml_val server.port)}"
KNOWLEDGE_PORT="${KNOWLEDGE_PORT:-8092}"
MVN="${MVN:-mvn}"

if ! command -v "${MVN}" &>/dev/null; then
    for candidate in /tmp/apache-maven-3.9.6/bin/mvn /usr/local/bin/mvn; do
        if [ -x "${candidate}" ]; then
            MVN="${candidate}"
            break
        fi
    done
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

LOG_DIR="${SERVICE_DIR}/logs"

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
    local name="$1" url="$2" attempts="${3:-30}" delay="${4:-1}"
    for ((i=1; i<=attempts; i++)); do
        curl -fsS "${url}" >/dev/null 2>&1 && return 0
        sleep "${delay}"
    done
    log_error "${name} health check failed: ${url}"
    return 1
}

start_detached() {
    local log_file="$1"
    shift

    mkdir -p "${LOG_DIR}"
    if command -v setsid >/dev/null 2>&1; then
        nohup setsid "$@" </dev/null >>"${log_file}" 2>&1 &
    else
        nohup "$@" </dev/null >>"${log_file}" 2>&1 &
    fi
    echo $!
}

build_service() {
    local jar="${SERVICE_DIR}/target/knowledge-service.jar"
    if [ -f "${jar}" ]; then
        local newest_src
        newest_src="$(find "${SERVICE_DIR}/src" -type f \( -name '*.java' -o -name '*.yaml' -o -name '*.yml' \) -newer "${jar}" 2>/dev/null | head -1)"
        if [ -z "${newest_src}" ]; then
            log_info "JAR is up-to-date, skipping build"
            return 0
        fi
    fi

    log_info "Building knowledge-service..."
    cd "${SERVICE_DIR}"
    "${MVN}" package -DskipTests -q || {
        log_error "Maven build failed"
        return 1
    }
}

SERVICE_PID=""

do_startup() {
    local mode="${1:-foreground}"
    stop_port "${KNOWLEDGE_PORT}" "knowledge-service"

    build_service
    local jar="${SERVICE_DIR}/target/knowledge-service.jar"
    [ -f "${jar}" ] || { log_error "JAR not found: ${jar}"; return 1; }

    log_info "Starting knowledge-service at http://127.0.0.1:${KNOWLEDGE_PORT}"
    cd "${SERVICE_DIR}"

    if [ "${mode}" = "background" ]; then
        local log_file="${LOG_DIR}/knowledge-service.log"
        SERVICE_PID="$(start_detached "${log_file}" env CONFIG_PATH="${SERVICE_DIR}/config.yaml" java -Dserver.port="${KNOWLEDGE_PORT}" -jar "${jar}")"
        if ! kill -0 "${SERVICE_PID}" 2>/dev/null; then
            log_error "Failed to start knowledge-service"
            return 1
        fi
        wait_http_ok "knowledge-service" "http://127.0.0.1:${KNOWLEDGE_PORT}/actuator/health" 40 1
        log_info "knowledge-service started (PID: ${SERVICE_PID}, log: ${log_file})"
    else
        exec env CONFIG_PATH="${SERVICE_DIR}/config.yaml" java -Dserver.port="${KNOWLEDGE_PORT}" -jar "${jar}"
    fi
}

do_shutdown() {
    stop_port "${KNOWLEDGE_PORT}" "knowledge-service"
}

do_status() {
    if check_port "${KNOWLEDGE_PORT}"; then
        if curl -fsS "http://127.0.0.1:${KNOWLEDGE_PORT}/actuator/health" >/dev/null 2>&1; then
            log_ok "knowledge-service running (http://localhost:${KNOWLEDGE_PORT})"
        else
            log_warn "knowledge-service port open but health check failed"
            return 1
        fi
    else
        log_fail "knowledge-service not running on port ${KNOWLEDGE_PORT}"
        return 1
    fi
}

do_restart() {
    do_shutdown
    do_startup "${MODE}"
}

usage() {
    cat <<EOF_USAGE
Usage: $(basename "$0") <action> [--background]

Actions:
  startup     Start knowledge-service
  shutdown    Stop knowledge-service
  status      Check knowledge-service status
  restart     Restart knowledge-service
EOF_USAGE
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
