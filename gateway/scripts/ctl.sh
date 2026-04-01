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

# --- Configuration (env var > config.yaml > default) ---
yaml_val() {
    local key="$1" file="${SERVICE_DIR}/config.yaml"
    [ -f "${file}" ] || return 0
    awk -F': ' -v k="${key}" '$1==k {print $2}' "${file}" | head -n1 | sed 's/^["'"'"']//;s/["'"'"']$//'
}

yaml_nested_val() {
    local section="$1" key="$2" file="${SERVICE_DIR}/config.yaml"
    [ -f "${file}" ] || return 0
    local inline
    inline="$(awk -v section="${section}" '
      $0 ~ "^" section ":[[:space:]]*\\{" { print; exit }
    ' "${file}")"
    if [ -n "${inline}" ]; then
        echo "${inline}" \
          | sed -E "s/^${section}:[[:space:]]*\\{//; s/}[[:space:]]*$//" \
          | tr ',' '\n' \
          | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
          | awk -F': *' -v key="${key}" '$1==key {print $2; exit}' \
          | sed 's/^["'"'"']//;s/["'"'"']$//'
        return 0
    fi
    awk -F': ' -v section="${section}" -v key="${key}" '
      $0 ~ "^" section ":" { in_section=1; next }
      in_section && $0 ~ "^[^[:space:]]" { in_section=0 }
      in_section && $1 ~ "^[[:space:]]+" key "$" { print $2; exit }
    ' "${file}" | sed 's/^["'"'"']//;s/["'"'"']$//'
}

GATEWAY_HOST="${GATEWAY_HOST:-$(yaml_val host)}"
GATEWAY_HOST="${GATEWAY_HOST:-0.0.0.0}"
GATEWAY_PORT="${GATEWAY_PORT:-$(yaml_val port)}"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"
GATEWAY_SECRET_KEY="${GATEWAY_SECRET_KEY:-$(yaml_val secretKey)}"
GATEWAY_SECRET_KEY="${GATEWAY_SECRET_KEY:-test}"
CORS_ORIGIN="${CORS_ORIGIN:-$(yaml_val corsOrigin)}"
CORS_ORIGIN="${CORS_ORIGIN:-http://127.0.0.1:5173}"
GOOSED_BIN="${GOOSED_BIN:-$(yaml_val goosedBin)}"
GOOSED_BIN="${GOOSED_BIN:-goosed}"
# Resolve relative goosedBin path against gateway root (JVM CWD is per-user agent dir)
case "${GOOSED_BIN}" in
    /*) ;;  # already absolute
    *)  [ -f "${SERVICE_DIR}/${GOOSED_BIN}" ] && GOOSED_BIN="${SERVICE_DIR}/${GOOSED_BIN}" ;;
esac
GOOSE_TLS="${GOOSE_TLS:-$(yaml_val gooseTls)}"
GOOSE_TLS="${GOOSE_TLS:-$(yaml_val goosedTls)}"
GOOSE_TLS="${GOOSE_TLS:-true}"
GATEWAY_TLS="${GATEWAY_TLS:-$(yaml_val gatewayTls)}"
GATEWAY_TLS="${GATEWAY_TLS:-true}"
GATEWAY_KEY_STORE="${GATEWAY_KEY_STORE:-$(yaml_val gatewayKeyStore)}"
GATEWAY_KEY_STORE_PASSWORD="${GATEWAY_KEY_STORE_PASSWORD:-$(yaml_val gatewayKeyStorePassword)}"
GATEWAY_KEY_STORE_PASSWORD="${GATEWAY_KEY_STORE_PASSWORD:-changeit}"

# Gateway TLS scheme + curl options
if [ "${GATEWAY_TLS}" = "true" ]; then
    GATEWAY_SCHEME="https"
    CURL_TLS_OPTS="-k"
else
    GATEWAY_SCHEME="http"
    CURL_TLS_OPTS=""
fi
IDLE_TIMEOUT_MINUTES="${IDLE_TIMEOUT_MINUTES:-$(yaml_nested_val idle timeoutMinutes)}"
IDLE_TIMEOUT_MINUTES="${IDLE_TIMEOUT_MINUTES:-15}"
IDLE_CHECK_INTERVAL="${IDLE_CHECK_INTERVAL:-$(yaml_nested_val idle checkIntervalMs)}"
IDLE_CHECK_INTERVAL="${IDLE_CHECK_INTERVAL:-60000}"

# SSE relay timeouts
SSE_FIRST_BYTE_TIMEOUT="${SSE_FIRST_BYTE_TIMEOUT:-$(yaml_nested_val sse firstByteTimeoutSec)}"
SSE_FIRST_BYTE_TIMEOUT="${SSE_FIRST_BYTE_TIMEOUT:-120}"
SSE_IDLE_TIMEOUT="${SSE_IDLE_TIMEOUT:-$(yaml_nested_val sse idleTimeoutSec)}"
SSE_IDLE_TIMEOUT="${SSE_IDLE_TIMEOUT:-300}"
SSE_MAX_DURATION="${SSE_MAX_DURATION:-$(yaml_nested_val sse maxDurationSec)}"
SSE_MAX_DURATION="${SSE_MAX_DURATION:-600}"

UPLOAD_MAX_FILE_SIZE_MB="${MAX_FILE_SIZE_MB:-$(yaml_nested_val upload maxFileSizeMb)}"
UPLOAD_MAX_FILE_SIZE_MB="${UPLOAD_MAX_FILE_SIZE_MB:-50}"
UPLOAD_MAX_IMAGE_SIZE_MB="${MAX_IMAGE_SIZE_MB:-$(yaml_nested_val upload maxImageSizeMb)}"
UPLOAD_MAX_IMAGE_SIZE_MB="${UPLOAD_MAX_IMAGE_SIZE_MB:-20}"
AGENTS_DIR="${AGENTS_DIR:-$(yaml_nested_val paths agentsDir)}"
AGENTS_DIR="${AGENTS_DIR:-agents}"
USERS_DIR="${USERS_DIR:-$(yaml_nested_val paths usersDir)}"
USERS_DIR="${USERS_DIR:-users}"
PROJECT_ROOT="${PROJECT_ROOT:-${ROOT_DIR}}"

# Limits
MAX_INSTANCES_PER_USER="${MAX_INSTANCES_PER_USER:-$(yaml_nested_val limits maxInstancesPerUser)}"
MAX_INSTANCES_PER_USER="${MAX_INSTANCES_PER_USER:-5}"
MAX_INSTANCES_GLOBAL="${MAX_INSTANCES_GLOBAL:-$(yaml_nested_val limits maxInstancesGlobal)}"
MAX_INSTANCES_GLOBAL="${MAX_INSTANCES_GLOBAL:-200}"

# Prewarm
PREWARM_ENABLED="${PREWARM_ENABLED:-$(yaml_nested_val prewarm enabled)}"
PREWARM_ENABLED="${PREWARM_ENABLED:-true}"
PREWARM_DEFAULT_AGENT_ID="${PREWARM_DEFAULT_AGENT_ID:-$(yaml_nested_val prewarm defaultAgentId)}"
PREWARM_DEFAULT_AGENT_ID="${PREWARM_DEFAULT_AGENT_ID:-universal-agent}"

LANGFUSE_HOST="${LANGFUSE_HOST:-$(yaml_nested_val langfuse host)}"
LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-$(yaml_nested_val langfuse publicKey)}"
LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-$(yaml_nested_val langfuse secretKey)}"

OFFICE_PREVIEW_ENABLED="${OFFICE_PREVIEW_ENABLED:-$(yaml_nested_val officePreview enabled)}"
ONLYOFFICE_URL="${ONLYOFFICE_URL:-$(yaml_nested_val officePreview onlyofficeUrl)}"
FILE_BASE_URL="${FILE_BASE_URL:-$(yaml_nested_val officePreview fileBaseUrl)}"

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

LOG_DIR="${SERVICE_DIR}/logs"
GATEWAY_HEALTH_PATH="/gateway/status"
GATEWAY_AGENTS_PATH="/gateway/agents"

# --- Utilities ---
check_port() { lsof -ti:"$1" >/dev/null 2>&1; }

generate_gateway_api_password() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24
        return
    fi
    if command -v python3 >/dev/null 2>&1; then
        python3 - <<'EOF'
import secrets
print(secrets.token_hex(24))
EOF
        return
    fi
    if command -v uuidgen >/dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-'
        return
    fi
    date +%s | shasum | awk '{print $1}'
}

read_gateway_api_password() {
    if [ ! -t 0 ] || [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
        return 2
    fi

    printf "Enter API password for gateway REST interface: " >/dev/tty
    if ! IFS= read -r -s GATEWAY_API_PASSWORD </dev/tty; then
        printf "\n" >/dev/tty
        log_error "Failed to read API password"
        return 1
    fi
    printf "\n" >/dev/tty

    if [ -z "${GATEWAY_API_PASSWORD}" ]; then
        log_error "Password cannot be empty"
        return 1
    fi
}

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
            curl -fsS ${CURL_TLS_OPTS} "${url}" -H "${headers}" >/dev/null 2>&1 && return 0
        else
            curl -fsS ${CURL_TLS_OPTS} "${url}" >/dev/null 2>&1 && return 0
        fi
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

gateway_url() {
    local sk="${GATEWAY_SECRET_KEY}"
    for host in "${GATEWAY_HOST}" "127.0.0.1"; do
        if curl -fsS ${CURL_TLS_OPTS} "${GATEWAY_SCHEME}://${host}:${GATEWAY_PORT}${GATEWAY_HEALTH_PATH}" \
                -H "x-secret-key: ${sk}" >/dev/null 2>&1; then
            echo "${GATEWAY_SCHEME}://${host}:${GATEWAY_PORT}"; return 0
        fi
    done
    for host in "${GATEWAY_HOST}" "127.0.0.1"; do
        local code
        code="$(curl -s ${CURL_TLS_OPTS} -o /dev/null -w "%{http_code}" \
            "${GATEWAY_SCHEME}://${host}:${GATEWAY_PORT}${GATEWAY_HEALTH_PATH}" 2>/dev/null || true)"
        [ "${code}" = "401" ] && { echo "${GATEWAY_SCHEME}://${host}:${GATEWAY_PORT}"; return 0; }
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
    agents_json="$(curl -fsS ${CURL_TLS_OPTS} "${GATEWAY_SCHEME}://127.0.0.1:${GATEWAY_PORT}${GATEWAY_AGENTS_PATH}" \
        -H "x-secret-key: ${GATEWAY_SECRET_KEY}" -H "x-user-id: admin" 2>/dev/null || true)"
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
        agents_json="$(curl -fsS ${CURL_TLS_OPTS} "${base_url}${GATEWAY_AGENTS_PATH}" \
            -H "x-secret-key: ${GATEWAY_SECRET_KEY}" -H "x-user-id: admin" 2>/dev/null || true)"
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
            log_fail "Failed to query ${GATEWAY_AGENTS_PATH}"
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

    # Auto-generate self-signed keystore for TLS if needed
    local gateway_key_alias=""
    if [ "${GATEWAY_TLS}" = "true" ]; then
        if [ -z "${GATEWAY_KEY_STORE}" ]; then
            GATEWAY_KEY_STORE="${SERVICE_DIR}/.gateway-keystore.p12"
            gateway_key_alias="gateway"
        else
            # Resolve relative path against SERVICE_DIR
            case "${GATEWAY_KEY_STORE}" in
                /*) ;; # already absolute
                *)  GATEWAY_KEY_STORE="${SERVICE_DIR}/${GATEWAY_KEY_STORE}" ;;
            esac
        fi
        if [ ! -f "${GATEWAY_KEY_STORE}" ]; then
            log_info "Generating self-signed TLS certificate..."
            keytool -genkeypair -alias gateway -keyalg RSA -keysize 2048 \
                -storetype PKCS12 -keystore "${GATEWAY_KEY_STORE}" \
                -storepass "${GATEWAY_KEY_STORE_PASSWORD}" \
                -validity 3650 -dname "CN=localhost" \
                -ext "SAN=dns:localhost,dns:host.docker.internal,ip:127.0.0.1,ip:0.0.0.0" 2>/dev/null
            log_info "Certificate saved to ${GATEWAY_KEY_STORE}"
        fi
        # Auto-detect alias from existing keystore when not auto-generated
        if [ -z "${gateway_key_alias}" ] && [ -f "${GATEWAY_KEY_STORE}" ]; then
            gateway_key_alias=$(keytool -list -keystore "${GATEWAY_KEY_STORE}" \
                -storepass "${GATEWAY_KEY_STORE_PASSWORD}" -storetype PKCS12 2>/dev/null \
                | awk -F, '/PrivateKeyEntry/ {print $1; exit}' | xargs)
        fi
        # Export certificate as PEM for Docker containers (OnlyOffice etc.)
        local gateway_cert_pem="${GATEWAY_KEY_STORE%.p12}.pem"
        if [ ! -f "${gateway_cert_pem}" ] || [ "${GATEWAY_KEY_STORE}" -nt "${gateway_cert_pem}" ]; then
            keytool -exportcert -alias "${gateway_key_alias:-1}" -keystore "${GATEWAY_KEY_STORE}" \
                -storepass "${GATEWAY_KEY_STORE_PASSWORD}" -rfc > "${gateway_cert_pem}" 2>/dev/null || true
        fi
    fi

    if [ -z "${GATEWAY_API_PASSWORD:-}" ]; then
        if read_gateway_api_password; then
            log_info "Using user-provided gateway API password"
        else
            local password_status=$?
            if [ "${password_status}" -ne 2 ]; then
                return 1
            fi
            GATEWAY_API_PASSWORD="$(generate_gateway_api_password)"
            log_info "Generated random internal gateway API password for child processes"
        fi
    fi

    # Log gooseTls configuration for debugging
    log_info "[gooseTls config] env=$GOOSE_TLS (source: env var > config.yaml > default)"

    log_info "Starting gateway at ${GATEWAY_SCHEME}://${GATEWAY_HOST}:${GATEWAY_PORT}"
    log_info "[gooseTls config] Java will be started with -Dgateway.goose-tls=${GOOSE_TLS}"

    # Build Java command — inject all config as Spring properties
    local java_cmd="java"
    local java_opts=(
        "-Dloader.path=${lib_dir}"
        "-Dserver.port=${GATEWAY_PORT}"
        "-Dserver.address=${GATEWAY_HOST}"
        "-Dgateway.secret-key=${GATEWAY_SECRET_KEY}"
        "-Dgateway.cors-origin=${CORS_ORIGIN}"
        "-Dgateway.goosed-bin=${GOOSED_BIN}"
        "-Dgateway.goose-tls=${GOOSE_TLS}"
        "-Dgateway.paths.project-root=${PROJECT_ROOT}"
        "-Dgateway.paths.agents-dir=${AGENTS_DIR}"
        "-Dgateway.paths.users-dir=${USERS_DIR}"
        "-Dgateway.idle.timeout-minutes=${IDLE_TIMEOUT_MINUTES}"
        "-Dgateway.idle.check-interval-ms=${IDLE_CHECK_INTERVAL}"
        "-Dgateway.sse.first-byte-timeout-sec=${SSE_FIRST_BYTE_TIMEOUT}"
        "-Dgateway.sse.idle-timeout-sec=${SSE_IDLE_TIMEOUT}"
        "-Dgateway.sse.max-duration-sec=${SSE_MAX_DURATION}"
        "-Dgateway.upload.max-file-size-mb=${UPLOAD_MAX_FILE_SIZE_MB}"
        "-Dgateway.upload.max-image-size-mb=${UPLOAD_MAX_IMAGE_SIZE_MB}"
        "-Dgateway.limits.max-instances-per-user=${MAX_INSTANCES_PER_USER}"
        "-Dgateway.limits.max-instances-global=${MAX_INSTANCES_GLOBAL}"
        "-Dgateway.prewarm.enabled=${PREWARM_ENABLED}"
        "-Dgateway.prewarm.default-agent-id=${PREWARM_DEFAULT_AGENT_ID}"
        "-Dgateway.api.password=${GATEWAY_API_PASSWORD}"
    )

    # Gateway TLS: inject Spring Boot SSL properties
    if [ "${GATEWAY_TLS}" = "true" ]; then
        java_opts+=(
            "-Dserver.ssl.enabled=true"
            "-Dserver.ssl.key-store=file:${GATEWAY_KEY_STORE}"
            "-Dserver.ssl.key-store-password=${GATEWAY_KEY_STORE_PASSWORD}"
            "-Dserver.ssl.key-store-type=PKCS12"
        )
        if [ -n "${gateway_key_alias}" ]; then
            java_opts+=("-Dserver.ssl.key-alias=${gateway_key_alias}")
        fi
    fi

    # Optional: langfuse
    [ -n "${LANGFUSE_HOST}" ]       && java_opts+=("-Dgateway.langfuse.host=${LANGFUSE_HOST}")
    [ -n "${LANGFUSE_PUBLIC_KEY}" ] && java_opts+=("-Dgateway.langfuse.public-key=${LANGFUSE_PUBLIC_KEY}")
    [ -n "${LANGFUSE_SECRET_KEY}" ] && java_opts+=("-Dgateway.langfuse.secret-key=${LANGFUSE_SECRET_KEY}")

    # Optional: office preview
    [ -n "${OFFICE_PREVIEW_ENABLED}" ] && java_opts+=("-Dgateway.office-preview.enabled=${OFFICE_PREVIEW_ENABLED}")
    [ -n "${ONLYOFFICE_URL}" ]         && java_opts+=("-Dgateway.office-preview.onlyoffice-url=${ONLYOFFICE_URL}")
    [ -n "${FILE_BASE_URL}" ]          && java_opts+=("-Dgateway.office-preview.file-base-url=${FILE_BASE_URL}")

    # Use external log4j2.xml if available
    if [ -f "${log4j_config}" ]; then
        java_opts+=("-Dlogging.config=file:${log4j_config}")
    fi

    java_opts+=("-jar" "${jar}")

    if [ "${mode}" = "background" ]; then
        local log_file="${LOG_DIR}/gateway.log"
        GATEWAY_PID="$(start_detached "${log_file}" "${java_cmd}" "${java_opts[@]}")"
        if ! kill -0 "${GATEWAY_PID}" 2>/dev/null; then
            log_error "Failed to start gateway"
            return 1
        fi
        if ! wait_http_ok "Gateway" "${GATEWAY_SCHEME}://127.0.0.1:${GATEWAY_PORT}${GATEWAY_HEALTH_PATH}" \
                "x-secret-key: ${GATEWAY_SECRET_KEY}" 40 1; then
            log_error "Gateway failed to become healthy. Check logs: ${log_file}"
            kill "${GATEWAY_PID}" 2>/dev/null || true
            return 1
        fi
        log_info "Gateway started (PID: ${GATEWAY_PID}, log: ${log_file})"
        check_agents_configured || true
    else
        exec ${java_cmd} "${java_opts[@]}"
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
            log_ok "Gateway running (${GATEWAY_SCHEME}://localhost:${GATEWAY_PORT})"
        else
            log_fail "Gateway port open but ${GATEWAY_HEALTH_PATH} check failed"
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
