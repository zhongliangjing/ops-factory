#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ops-factory unified service control
#
# Usage: ./ctl.sh <action> [component]
#
#   action:    startup | shutdown | status | restart
#   component: onlyoffice | langfuse | gateway | agents | webapp | all (default)
#
# Examples:
#   ./ctl.sh startup            # start all services
#   ./ctl.sh shutdown webapp    # stop webapp only
#   ./ctl.sh status             # check all services
#   ./ctl.sh restart gateway    # restart gateway (and agents)
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "${SCRIPT_DIR}")"
WEB_DIR="${ROOT_DIR}/web-app"
GATEWAY_DIR="${ROOT_DIR}/gateway"

# --- Configuration (overridable via env) ---
export GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
export GATEWAY_PORT="${GATEWAY_PORT:-3000}"
export GATEWAY_SECRET_KEY="${GATEWAY_SECRET_KEY:-test}"
export GOOSED_BIN="${GOOSED_BIN:-goosed}"
export PROJECT_ROOT="${ROOT_DIR}"
VITE_PORT="${VITE_PORT:-5173}"
ONLYOFFICE_PORT="${ONLYOFFICE_PORT:-8080}"
LANGFUSE_PORT="${LANGFUSE_PORT:-3100}"
LANGFUSE_DIR="${ROOT_DIR}/langfuse"

[ -n "${OFFICE_PREVIEW_ENABLED:-}" ] && export OFFICE_PREVIEW_ENABLED
[ -n "${ONLYOFFICE_URL:-}" ]         && export ONLYOFFICE_URL
[ -n "${ONLYOFFICE_FILE_BASE_URL:-}" ] && export ONLYOFFICE_FILE_BASE_URL

# Note: goosed instances use dynamic ports (lazy-started per-user by gateway).
# No fixed GOOSED_PORTS needed.

GATEWAY_PID=""
WEBAPP_PID=""

# ==============================================================================
# Colors & Logging
# ==============================================================================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

# ==============================================================================
# Utility
# ==============================================================================
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
    local name="$1" url="$2" headers="${3:-}" attempts="${4:-30}" delay="${5:-1}"
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

wait_webapp_visible() {
    local url="${1}"
    local timeout_sec="${2:-90}"
    local root_dir="${ROOT_DIR}"

    # Use Playwright to verify the first paint has meaningful content,
    # not just an open port.
    if (cd "${root_dir}/test" && TARGET_URL="${url}" TIMEOUT_MS="$((timeout_sec * 1000))" node --input-type=module <<'NODE'
import { chromium } from 'playwright'

const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:5173'
const timeout = Number(process.env.TIMEOUT_MS || '90000')

const expectedTexts = [
  "Hello, I'm Ops Agent", // logged-in home
  'Ops Factory',          // login page
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()

try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForFunction(
    (texts) => {
      const bodyText = document.body?.innerText || ''
      return texts.some((text) => bodyText.includes(text))
    },
    expectedTexts,
    { timeout }
  )
  await browser.close()
} catch (err) {
  await browser.close()
  throw err
}
NODE
    ); then
        return 0
    fi

    return 1
}

# Try to find a reachable gateway base URL
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

# Parse agent status JSON via node (single call, outputs: total running bad_text)
parse_agents_json() {
    node -e '
let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
  try {
    const p=JSON.parse(d), a=Array.isArray(p.agents)?p.agents:[];
    const r=a.filter(x=>x&&x.status==="running");
    const b=a.filter(x=>x&&x.status!=="running");
    console.log(a.length+" "+r.length+" "+b.map(x=>x.id+":"+x.status).join(","));
  } catch { process.exit(2); }
});'
}

# ==============================================================================
# OnlyOffice helpers
# ==============================================================================
wait_onlyoffice_ready() {
    local attempts="${1:-120}" delay="${2:-1}"
    for ((i=1; i<=attempts; i++)); do
        if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:${ONLYOFFICE_PORT}/healthcheck" >/dev/null 2>&1 \
          || curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:${ONLYOFFICE_PORT}/web-apps/apps/api/documents/api.js" >/dev/null 2>&1; then
            return 0
        fi
        (( i % 10 == 0 )) && log_info "Waiting for OnlyOffice readiness... (${i}/${attempts})"
        sleep "${delay}"
    done
    log_error "OnlyOffice readiness check failed"
    return 1
}

# All OnlyOffice config is passed via Docker env vars — no runtime patching needed
ONLYOFFICE_ENV_ARGS=(
    -e JWT_ENABLED=false
    -e PLUGINS_ENABLED=false
    -e ALLOW_PRIVATE_IP_ADDRESS=true
    -e ALLOW_META_IP_ADDRESS=true
)

recreate_onlyoffice_container() {
    docker ps -a --format '{{.Names}}' | grep -q '^onlyoffice$' && docker rm -f onlyoffice >/dev/null 2>&1 || true
    docker run -d --name onlyoffice -p "${ONLYOFFICE_PORT}:80" "${ONLYOFFICE_ENV_ARGS[@]}" onlyoffice/documentserver >/dev/null
    log_info "OnlyOffice container recreated"
}

# Verify the running container has the expected env vars; recreate if not
ensure_onlyoffice_env() {
    local actual
    actual="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' onlyoffice 2>/dev/null || true)"
    for expected in JWT_ENABLED=false PLUGINS_ENABLED=false ALLOW_PRIVATE_IP_ADDRESS=true ALLOW_META_IP_ADDRESS=true; do
        if ! echo "${actual}" | grep -q "^${expected}$"; then
            log_warn "OnlyOffice env mismatch (missing ${expected}), recreating..."
            recreate_onlyoffice_container
            return
        fi
    done
}

# ==============================================================================
# Component: OnlyOffice
# ==============================================================================
startup_onlyoffice() {
    if [ "${OFFICE_PREVIEW_ENABLED:-true}" != "true" ]; then
        log_info "OnlyOffice disabled (OFFICE_PREVIEW_ENABLED=false)"
        return 0
    fi

    # --- Ensure container is running ---
    if ! docker ps --format '{{.Names}}' | grep -q '^onlyoffice$'; then
        if docker ps -a --format '{{.Names}}' | grep -q '^onlyoffice$'; then
            log_info "Starting existing OnlyOffice container..."
            docker start onlyoffice
        else
            log_info "Creating OnlyOffice container..."
            docker run -d --name onlyoffice -p "${ONLYOFFICE_PORT}:80" "${ONLYOFFICE_ENV_ARGS[@]}" onlyoffice/documentserver
        fi
        log_info "OnlyOffice available at http://localhost:${ONLYOFFICE_PORT}"
    else
        log_info "OnlyOffice already running"
    fi

    ensure_onlyoffice_env

    # --- Wait for readiness (services start automatically via entrypoint) ---
    log_info "Checking OnlyOffice readiness (timeout: 120s)..."
    if ! wait_onlyoffice_ready 120 1; then
        log_warn "Not ready; recreating container..."
        recreate_onlyoffice_container
        log_info "Re-checking readiness (timeout: 120s)..."
        if ! wait_onlyoffice_ready 120 1; then
            log_error "OnlyOffice not ready. Set OFFICE_PREVIEW_ENABLED=false to bypass."
            return 1
        fi
    fi
    log_info "OnlyOffice readiness check passed"
}

shutdown_onlyoffice() {
    # Only stop if actually running (docker ps, not docker ps -a)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^onlyoffice$'; then
        log_info "Stopping OnlyOffice container..."
        docker stop onlyoffice 2>/dev/null || true
    fi
}

status_onlyoffice() {
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^onlyoffice$'; then
        if curl -fsS "http://127.0.0.1:${ONLYOFFICE_PORT}/healthcheck" >/dev/null 2>&1 \
           || curl -fsS "http://127.0.0.1:${ONLYOFFICE_PORT}/web-apps/apps/api/documents/api.js" >/dev/null 2>&1; then
            log_ok "OnlyOffice running (http://localhost:${ONLYOFFICE_PORT})"
        else
            log_warn "OnlyOffice container running but readiness check failed"
            return 1
        fi
    else
        log_fail "OnlyOffice container is not running"
        return 1
    fi
}

# ==============================================================================
# Component: Langfuse
# ==============================================================================
startup_langfuse() {
    if docker ps --format '{{.Names}}' | grep -q '^langfuse$'; then
        log_info "Langfuse already running"
    else
        log_info "Starting Langfuse (port ${LANGFUSE_PORT})..."
        docker compose -f "${LANGFUSE_DIR}/docker-compose.yml" up -d
    fi

    log_info "Checking Langfuse readiness (timeout: 60s)..."
    if ! wait_http_ok "Langfuse" "http://127.0.0.1:${LANGFUSE_PORT}/api/public/health" "" 60 1; then
        log_error "Langfuse health check failed"
        return 1
    fi
    log_info "Langfuse ready at http://localhost:${LANGFUSE_PORT}"
}

shutdown_langfuse() {
    if docker ps --format '{{.Names}}' | grep -q '^langfuse$'; then
        log_info "Stopping Langfuse..."
        docker compose -f "${LANGFUSE_DIR}/docker-compose.yml" down
    fi
}

status_langfuse() {
    if docker ps --format '{{.Names}}' | grep -q '^langfuse$'; then
        if curl -fsS "http://127.0.0.1:${LANGFUSE_PORT}/api/public/health" >/dev/null 2>&1; then
            log_ok "Langfuse running (http://localhost:${LANGFUSE_PORT})"
        else
            log_warn "Langfuse container running but health check failed"
            return 1
        fi
    else
        log_fail "Langfuse is not running"
        return 1
    fi
}

# ==============================================================================
# Component: Gateway
# ==============================================================================
startup_gateway() {
    local mode="${1:-foreground}" # foreground | background
    stop_port "${GATEWAY_PORT}" "gateway"

    log_info "Starting gateway at http://${GATEWAY_HOST}:${GATEWAY_PORT}"
    cd "${GATEWAY_DIR}"

    if [ "${mode}" = "background" ]; then
        npx tsx src/index.ts &
        GATEWAY_PID=$!
        if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
            log_error "Failed to start gateway"
            return 1
        fi
        if ! wait_http_ok "Gateway" "http://127.0.0.1:${GATEWAY_PORT}/status" \
                "x-secret-key: ${GATEWAY_SECRET_KEY}" 40 1; then
            return 1
        fi
        log_info "Gateway started (PID: ${GATEWAY_PID})"
    else
        # foreground — blocks until user Ctrl-C
        npx tsx src/index.ts
    fi
}

shutdown_gateway() {
    stop_port "${GATEWAY_PORT}" "gateway"
}

status_gateway() {
    if check_port "${GATEWAY_PORT}"; then
        if gateway_url >/dev/null 2>&1; then
            log_ok "Gateway running (http://localhost:${GATEWAY_PORT})"
        else
            log_fail "Gateway port open but /status check failed"
            return 1
        fi
    else
        log_fail "Gateway not running on port ${GATEWAY_PORT}"
        return 1
    fi
}

# ==============================================================================
# Component: Agents (goosed processes, managed by gateway)
# ==============================================================================
startup_agents() {
    log_info "Agents are lazy-started per-user by gateway — restarting gateway..."
    shutdown_agents
    shutdown_gateway
    startup_gateway "${1:-foreground}"
}

shutdown_agents() {
    # Kill all goosed processes (dynamic ports, managed by gateway)
    if pgrep -f goosed >/dev/null 2>&1; then
        log_info "Stopping goosed processes..."
        pkill -f goosed 2>/dev/null || true
        sleep 1
    fi
}

status_agents() {
    local base_url
    base_url="$(gateway_url 2>/dev/null)" || true

    if [ -n "${base_url}" ]; then
        local agents_json
        agents_json="$(curl -fsS "${base_url}/agents" -H "x-secret-key: ${GATEWAY_SECRET_KEY}" 2>/dev/null || true)"
        if [ -n "${agents_json}" ]; then
            local summary
            summary="$(echo "${agents_json}" | parse_agents_json 2>/dev/null)" || true
            if [ -n "${summary}" ]; then
                local total running bad
                read -r total running bad <<< "${summary}"
                if [ "${total}" -eq 0 ]; then
                    log_fail "No agents configured in gateway"
                    return 1
                else
                    # With lazy startup, agents spawn on demand — 0 running is normal
                    log_ok "Agents configured (${total} total, ${running} with active instances)"
                fi
            else
                log_fail "Failed to parse /agents response"
                return 1
            fi
        else
            local http_code
            http_code="$(curl -s -o /dev/null -w "%{http_code}" "${base_url}/agents" \
                -H "x-secret-key: ${GATEWAY_SECRET_KEY}" 2>/dev/null || true)"
            if [ "${http_code}" = "401" ] || [ "${http_code}" = "403" ]; then
                log_warn "Cannot read /agents (auth failed)"
            else
                log_fail "Failed to query /agents"
                return 1
            fi
        fi
    else
        log_warn "Gateway unreachable"
        return 1
    fi
}

# ==============================================================================
# Component: Webapp
# ==============================================================================
startup_webapp() {
    local mode="${1:-foreground}" # foreground | background
    stop_port "${VITE_PORT}" "webapp"
    log_info "Starting webapp at http://${GATEWAY_HOST}:${VITE_PORT}"
    cd "${WEB_DIR}"

    npm run dev -- --host "${GATEWAY_HOST}" &
    WEBAPP_PID=$!

    if ! kill -0 "${WEBAPP_PID}" 2>/dev/null; then
        log_error "Failed to start webapp"
        return 1
    fi

    if ! wait_http_ok "Webapp" "http://127.0.0.1:${VITE_PORT}" "" 120 1; then
        return 1
    fi

    log_info "Checking homepage visual readiness..."
    if ! wait_webapp_visible "http://127.0.0.1:${VITE_PORT}" 90; then
        log_error "Webapp visual readiness check failed"
        log_error "The page is reachable but key content did not render in time"
        return 1
    fi

    log_info "Webapp ready at http://localhost:${VITE_PORT}"

    if [ "${mode}" = "foreground" ]; then
        wait "${WEBAPP_PID}"
    fi
}

shutdown_webapp() {
    stop_port "${VITE_PORT}" "webapp"
}

status_webapp() {
    if check_port "${VITE_PORT}"; then
        if curl -fsS "http://127.0.0.1:${VITE_PORT}" >/dev/null 2>&1; then
            log_ok "Webapp running (http://localhost:${VITE_PORT})"
        else
            log_warn "Webapp port open but HTTP check failed"
            return 1
        fi
    else
        log_fail "Webapp not running on port ${VITE_PORT}"
        return 1
    fi
}

# ==============================================================================
# Orchestration
# ==============================================================================
cleanup() {
    if [[ -n "${GATEWAY_PID}" ]] && kill -0 "${GATEWAY_PID}" 2>/dev/null; then
        log_info "Stopping gateway (PID: ${GATEWAY_PID})..."
        kill "${GATEWAY_PID}" 2>/dev/null || true
        wait "${GATEWAY_PID}" 2>/dev/null || true
    fi
    if [[ -n "${WEBAPP_PID}" ]] && kill -0 "${WEBAPP_PID}" 2>/dev/null; then
        log_info "Stopping webapp (PID: ${WEBAPP_PID})..."
        kill "${WEBAPP_PID}" 2>/dev/null || true
        wait "${WEBAPP_PID}" 2>/dev/null || true
    fi
}

do_startup() {
    local component="${1:-all}"
    local skip_shutdown="${2:-false}"  # set by do_restart to avoid double shutdown

    case "${component}" in
        all)
            # Clean slate (skipped when called from do_restart which already did shutdown)
            if [ "${skip_shutdown}" != "true" ]; then
                shutdown_webapp
                shutdown_agents
                shutdown_gateway
                shutdown_langfuse
                shutdown_onlyoffice
            fi
            log_info "Starting all services..."
            # 1. OnlyOffice (Docker, returns when ready)
            startup_onlyoffice
            # 2. Langfuse (Docker, returns when ready)
            startup_langfuse
            # 3. Gateway in background (agents spawn on demand per-user)
            trap cleanup EXIT INT TERM
            startup_gateway background
            # 4. Verify agents are configured
            if ! check_agents_configured; then
                log_error "No agents configured"
                exit 1
            fi
            # 5. Webapp in foreground (blocking)
            startup_webapp
            ;;
        onlyoffice) startup_onlyoffice ;;
        langfuse)   startup_langfuse ;;
        gateway)    shutdown_agents; shutdown_gateway; startup_gateway foreground ;;
        agents)     startup_agents foreground ;;
        webapp)     startup_webapp ;;
        *) usage ;;
    esac
}

do_shutdown() {
    local component="${1:-all}"
    case "${component}" in
        all)
            shutdown_webapp
            shutdown_agents
            shutdown_gateway
            shutdown_langfuse
            shutdown_onlyoffice
            log_info "All services stopped"
            ;;
        onlyoffice) shutdown_onlyoffice ;;
        langfuse)   shutdown_langfuse ;;
        gateway)    shutdown_agents; shutdown_gateway ;;
        agents)     shutdown_agents ;;
        webapp)     shutdown_webapp ;;
        *) usage ;;
    esac
}

do_status() {
    local component="${1:-all}"
    local has_fail=0

    echo "Service status:"
    echo "--------------"

    case "${component}" in
        all)
            status_onlyoffice || has_fail=1
            status_langfuse   || has_fail=1
            status_gateway    || has_fail=1
            status_agents     || has_fail=1
            status_webapp     || has_fail=1
            echo
            if [ "${has_fail}" -eq 0 ]; then
                log_ok "All services are up"
            else
                log_fail "One or more services are down"
            fi
            ;;
        onlyoffice) status_onlyoffice || has_fail=1 ;;
        langfuse)   status_langfuse   || has_fail=1 ;;
        gateway)    status_gateway    || has_fail=1 ;;
        agents)     status_agents     || has_fail=1 ;;
        webapp)     status_webapp     || has_fail=1 ;;
        *) usage ;;
    esac

    return "${has_fail}"
}

do_restart() {
    local component="${1:-all}"
    do_shutdown "${component}"
    do_startup "${component}" true  # skip_shutdown=true to avoid double shutdown
}

# Helper used during startup_all to verify agents are configured in gateway
check_agents_configured() {
    local agents_json
    agents_json="$(curl -fsS "http://127.0.0.1:${GATEWAY_PORT}/agents" \
        -H "x-secret-key: ${GATEWAY_SECRET_KEY}" 2>/dev/null || true)"
    [ -z "${agents_json}" ] && { log_error "Failed to query agents"; return 1; }

    local summary
    summary="$(echo "${agents_json}" | parse_agents_json 2>/dev/null)" || true
    [ -z "${summary}" ] && { log_error "Failed to parse agents status"; return 1; }

    local total running bad
    read -r total running bad <<< "${summary}"

    if [ "${total}" -eq 0 ]; then
        log_error "No agents configured in gateway"
        return 1
    fi

    log_info "Agents configured (${total} total, instances spawn on demand)"
}

# ==============================================================================
# Usage & Main
# ==============================================================================
usage() {
    cat <<'EOF'
Usage: ctl.sh <action> [component]

Actions:
  startup     Start service(s)
  shutdown    Stop service(s)
  status      Check service status
  restart     Restart service(s)

Components:
  all         All services (default)
  onlyoffice  OnlyOffice Document Server (Docker)
  langfuse    Langfuse observability platform (Docker)
  gateway     Gateway HTTP proxy server
  agents      Goosed agent processes (managed by gateway)
  webapp      Web application (Vite dev server)

Note: agents are child processes spawned by gateway.
  "startup agents" will restart gateway to re-spawn agents.
  "shutdown agents" kills agent processes only (gateway stays).
EOF
    exit 1
}

ACTION="${1:-}"
COMPONENT="${2:-all}"

[ -z "${ACTION}" ] && usage

case "${ACTION}" in
    startup)  do_startup  "${COMPONENT}" ;;
    shutdown) do_shutdown "${COMPONENT}" ;;
    status)   do_status   "${COMPONENT}" ;;
    restart)  do_restart  "${COMPONENT}" ;;
    -h|--help|help) usage ;;
    *) log_error "Unknown action: ${ACTION}"; usage ;;
esac
