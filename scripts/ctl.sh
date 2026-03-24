#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ops-factory unified service orchestrator
#
# Usage: ./ctl.sh <action> [component ...]
#
#   action:    startup | shutdown | status | restart
#   component: onlyoffice | langfuse | gateway | knowledge | exporter | webapp | all (default)
#              Multiple components can be specified.
#
# Examples:
#   ./ctl.sh startup                    # start all services
#   ./ctl.sh startup gateway webapp     # start gateway and webapp only
#   ./ctl.sh shutdown webapp            # stop webapp only
#   ./ctl.sh status                     # check all services
#   ./ctl.sh restart gateway            # restart gateway
#   ./ctl.sh shutdown gateway exporter  # stop gateway and exporter
#
# Service toggles (env vars):
#   ENABLE_ONLYOFFICE=false ./ctl.sh startup   # skip OnlyOffice
#   ENABLE_LANGFUSE=false   ./ctl.sh startup   # skip Langfuse
#   ENABLE_EXPORTER=false   ./ctl.sh startup   # skip Exporter
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"

# === Service toggles (optional services, set to false to skip) ===
ENABLE_ONLYOFFICE="${ENABLE_ONLYOFFICE:-true}"
ENABLE_LANGFUSE="${ENABLE_LANGFUSE:-true}"
ENABLE_EXPORTER="${ENABLE_EXPORTER:-true}"
# gateway and webapp are mandatory — no toggles

# === Sub-script paths ===
CTL_GATEWAY="${ROOT_DIR}/gateway/scripts/ctl.sh"
CTL_KNOWLEDGE="${ROOT_DIR}/knowledge-service/scripts/ctl.sh"
CTL_WEBAPP="${ROOT_DIR}/web-app/scripts/ctl.sh"
CTL_LANGFUSE="${ROOT_DIR}/langfuse/scripts/ctl.sh"
CTL_ONLYOFFICE="${ROOT_DIR}/onlyoffice/scripts/ctl.sh"
CTL_EXPORTER="${ROOT_DIR}/prometheus-exporter/scripts/ctl.sh"

# === Logging ===
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# === Helpers ===
run_if_enabled() {
    local toggle="$1" name="$2" script="$3"
    shift 3
    if [ "${toggle}" = "true" ]; then
        "${script}" "$@"
    else
        log_info "${name} disabled (toggle=false)"
    fi
}

# === Cleanup trap for background processes ===
GATEWAY_BG_PID=""
KNOWLEDGE_BG_PID=""
EXPORTER_BG_PID=""
WEBAPP_BG_PID=""

cleanup() {
    for pid_var in WEBAPP_BG_PID EXPORTER_BG_PID KNOWLEDGE_BG_PID GATEWAY_BG_PID; do
        local pid="${!pid_var}"
        if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
            kill "${pid}" 2>/dev/null || true
            wait "${pid}" 2>/dev/null || true
        fi
    done
}

# === Component validation ===
VALID_COMPONENTS="onlyoffice langfuse gateway knowledge exporter webapp"

validate_component() {
    local comp="$1"
    for valid in ${VALID_COMPONENTS}; do
        [[ "${comp}" == "${valid}" ]] && return 0
    done
    log_error "Unknown component: ${comp}"
    usage
}

# === Single-component action helpers ===
# Usage: startup_one <component> [--background]
startup_one() {
    local comp="$1"
    local bg_flag="${2:-}"
    case "${comp}" in
        onlyoffice) run_if_enabled "${ENABLE_ONLYOFFICE}" "OnlyOffice" "${CTL_ONLYOFFICE}" startup ${bg_flag} ;;
        langfuse)   run_if_enabled "${ENABLE_LANGFUSE}" "Langfuse" "${CTL_LANGFUSE}" startup ${bg_flag} ;;
        gateway)    "${CTL_GATEWAY}" startup ${bg_flag} ;;
        knowledge)  "${CTL_KNOWLEDGE}" startup ${bg_flag} ;;
        exporter)   run_if_enabled "${ENABLE_EXPORTER}" "Exporter" "${CTL_EXPORTER}" startup ${bg_flag} ;;
        webapp)     "${CTL_WEBAPP}" startup ${bg_flag} ;;
    esac
}

shutdown_one() {
    case "$1" in
        onlyoffice) "${CTL_ONLYOFFICE}" shutdown ;;
        langfuse)   "${CTL_LANGFUSE}" shutdown ;;
        gateway)    "${CTL_GATEWAY}" shutdown ;;
        knowledge)  "${CTL_KNOWLEDGE}" shutdown ;;
        exporter)   "${CTL_EXPORTER}" shutdown ;;
        webapp)     "${CTL_WEBAPP}" shutdown ;;
    esac
}

status_one() {
    case "$1" in
        onlyoffice)
            if [ "${ENABLE_ONLYOFFICE}" = "true" ]; then
                "${CTL_ONLYOFFICE}" status || return 1
            fi ;;
        langfuse)
            if [ "${ENABLE_LANGFUSE}" = "true" ]; then
                "${CTL_LANGFUSE}" status || return 1
            fi ;;
        gateway)  "${CTL_GATEWAY}" status  || return 1 ;;
        knowledge) "${CTL_KNOWLEDGE}" status || return 1 ;;
        exporter)
            if [ "${ENABLE_EXPORTER}" = "true" ]; then
                "${CTL_EXPORTER}" status || return 1
            fi ;;
        webapp)   "${CTL_WEBAPP}" status   || return 1 ;;
    esac
}

# === Orchestration ===
do_startup() {
    local components=("$@")

    if [[ ${#components[@]} -eq 0 || "${components[0]}" == "all" ]]; then
        # Shutdown everything first
        do_shutdown all

        log_info "Starting all services..."
        trap cleanup EXIT INT TERM

        # 1. OnlyOffice (optional)
        run_if_enabled "${ENABLE_ONLYOFFICE}" "OnlyOffice" "${CTL_ONLYOFFICE}" startup

        # 2. Langfuse (optional)
        run_if_enabled "${ENABLE_LANGFUSE}" "Langfuse" "${CTL_LANGFUSE}" startup

        # 3. Gateway (mandatory, background)
        "${CTL_GATEWAY}" startup --background

        # 4. Knowledge-service (mandatory, background)
        "${CTL_KNOWLEDGE}" startup --background

        # 5. Exporter (optional, background)
        run_if_enabled "${ENABLE_EXPORTER}" "Exporter" "${CTL_EXPORTER}" startup --background

        # 6. Webapp (mandatory, foreground — blocking)
        "${CTL_WEBAPP}" startup
    else
        for comp in "${components[@]}"; do
            validate_component "${comp}"
        done
        # Shutdown selected components first
        for comp in "${components[@]}"; do
            shutdown_one "${comp}"
        done
        log_info "Starting: ${components[*]}..."
        trap cleanup EXIT INT TERM
        local last_idx=$(( ${#components[@]} - 1 ))
        for i in "${!components[@]}"; do
            if [[ $i -lt $last_idx ]]; then
                startup_one "${components[$i]}" --background
            else
                # Last component runs in foreground (blocking)
                startup_one "${components[$i]}"
            fi
        done
    fi
}

do_shutdown() {
    local components=("$@")

    if [[ ${#components[@]} -eq 0 || "${components[0]}" == "all" ]]; then
        "${CTL_EXPORTER}" shutdown
        "${CTL_KNOWLEDGE}" shutdown
        "${CTL_WEBAPP}" shutdown
        "${CTL_GATEWAY}" shutdown
        "${CTL_LANGFUSE}" shutdown
        "${CTL_ONLYOFFICE}" shutdown
        log_info "All services stopped"
    else
        for comp in "${components[@]}"; do
            validate_component "${comp}"
        done
        for comp in "${components[@]}"; do
            shutdown_one "${comp}"
        done
        log_info "Stopped: ${components[*]}"
    fi
}

do_status() {
    local components=("$@")
    local has_fail=0

    echo "Service status:"
    echo "--------------"

    if [[ ${#components[@]} -eq 0 || "${components[0]}" == "all" ]]; then
        status_one onlyoffice || has_fail=1
        status_one langfuse   || has_fail=1
        status_one gateway    || has_fail=1
        status_one knowledge  || has_fail=1
        status_one exporter   || has_fail=1
        status_one webapp     || has_fail=1
        echo
        if [ "${has_fail}" -eq 0 ]; then
            log_ok "All services are up"
        else
            log_fail "One or more services are down"
        fi
    else
        for comp in "${components[@]}"; do
            validate_component "${comp}"
        done
        for comp in "${components[@]}"; do
            status_one "${comp}" || has_fail=1
        done
    fi

    return "${has_fail}"
}

do_restart() {
    local components=("$@")
    do_shutdown "${components[@]}"
    do_startup "${components[@]}"
}

# === Usage & Main ===
usage() {
    cat <<'EOF'
Usage: ctl.sh <action> [component ...]

Actions:
  startup     Start service(s)
  shutdown    Stop service(s)
  status      Check service status
  restart     Restart service(s)

Components (multiple allowed):
  all         All services (default)
  onlyoffice  OnlyOffice Document Server (Docker)     [optional]
  langfuse    Langfuse observability platform (Docker) [optional]
  gateway     Gateway + goosed agents                  [mandatory]
  knowledge   Knowledge ingestion / retrieval service  [mandatory]
  exporter    Prometheus metrics exporter              [optional]
  webapp      Web application (Vite dev server)        [mandatory]

Examples:
  ctl.sh startup                    Start all services
  ctl.sh startup gateway webapp     Start gateway and webapp only
  ctl.sh shutdown gateway exporter  Stop gateway and exporter
  ctl.sh status webapp              Check webapp status

Service toggles (env vars):
  ENABLE_ONLYOFFICE=true|false  (default: true)
  ENABLE_LANGFUSE=true|false    (default: true)
  ENABLE_EXPORTER=true|false    (default: true)
EOF
    exit 1
}

ACTION="${1:-}"
[ -z "${ACTION}" ] && usage
shift

# Remaining args are components (default: all)
if [[ $# -eq 0 ]]; then
    COMPONENTS=("all")
else
    COMPONENTS=("$@")
fi

case "${ACTION}" in
    startup)  do_startup  "${COMPONENTS[@]}" ;;
    shutdown) do_shutdown "${COMPONENTS[@]}" ;;
    status)   do_status   "${COMPONENTS[@]}" ;;
    restart)  do_restart  "${COMPONENTS[@]}" ;;
    -h|--help|help) usage ;;
    *) log_error "Unknown action: ${ACTION}"; usage ;;
esac
