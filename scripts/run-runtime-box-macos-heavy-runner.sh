#!/usr/bin/env bash
set -euo pipefail

# Runs one repository-scoped macOS heavy job, then removes the complete runner work root.
REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY="Liatir/liatir-stack"
MODEL_ID="snap-stanford-uce-4layer"
TARGET_ID="macos-aarch64-metal"
MODE="native-lifecycle"
RUNNER_VERSION="2.336.0"
RUNNER_ARCHIVE="actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
RUNNER_ARCHIVE_SHA256="8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079"
RUNNER_ARCHIVE_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"
RUNNER_ONLINE_TIMEOUT_SECONDS=11400
RUNNER_ROOT=""
PREFLIGHT_ONLY=0
RUNNER_NAME=""
RUNNER_PID=""
WATCHDOG_PID=""
MARKER_NAME=".liatir-runtime-box-runner"

usage() {
  cat <<'EOF'
Usage: scripts/run-runtime-box-macos-heavy-runner.sh --runner-root ABSOLUTE_PATH [--preflight-only]

Preflights or runs one private, repository-scoped, ephemeral Apple silicon
GitHub Actions runner. The runner root must be outside the repository checkout.
The complete runner root is removed after success, failure, or interruption;
runner diagnostic logs are retained beside it in ABSOLUTE_PATH.logs.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --runner-root)
      [[ $# -ge 2 ]] || { echo "--runner-root requires a value." >&2; exit 2; }
      RUNNER_ROOT="$2"
      shift
      ;;
    --preflight-only)
      PREFLIGHT_ONLY=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

[[ "$RUNNER_ROOT" == /* ]] || { echo "--runner-root must be an explicit absolute path." >&2; exit 2; }
[[ "$RUNNER_ROOT" != "/" ]] || { echo "The filesystem root cannot be used as a runner root." >&2; exit 2; }
case "$RUNNER_ROOT" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
    echo "The runner root must be outside the repository checkout." >&2
    exit 2
    ;;
esac
[[ ! -L "$RUNNER_ROOT" ]] || { echo "The runner root cannot be a symbolic link." >&2; exit 2; }

for command in arch awk curl df gh node shasum sleep tar; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
[[ "$(uname -s)" == "Darwin" ]] || { echo "The heavy runner requires macOS." >&2; exit 1; }
[[ "$(arch)" == "arm64" ]] || { echo "The heavy runner requires Apple silicon." >&2; exit 1; }

RESOLUTION="$(node "$REPOSITORY_ROOT/scripts/runtime-box-ci.mjs" resolve \
  --model "$MODEL_ID" \
  --target "$TARGET_ID" \
  --mode "$MODE" \
  --native-requested false)"
json_field() {
  node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(String(value[process.argv[2]]));' "$RESOLUTION" "$1"
}
RUNNER_LABEL="$(json_field runs_on)"
RUNNER_NAME_PREFIX="$(json_field runner_name_prefix)"
MINIMUM_BOOTSTRAP_FREE_DISK_BYTES="$(json_field minimum_bootstrap_free_disk_bytes)"
[[ "$(json_field self_hosted)" == "true" ]] || { echo "The resolved target is not self-hosted." >&2; exit 1; }

DISK_PATH="$RUNNER_ROOT"
while [[ ! -e "$DISK_PATH" ]]; do
  DISK_PATH="$(dirname "$DISK_PATH")"
done
AVAILABLE_KIB="$(df -Pk "$DISK_PATH" | awk 'NR == 2 { print $4 }')"
[[ "$AVAILABLE_KIB" =~ ^[0-9]+$ ]] || { echo "Unable to read free disk space for $DISK_PATH." >&2; exit 1; }
AVAILABLE_BYTES=$((AVAILABLE_KIB * 1024))
if (( AVAILABLE_BYTES < MINIMUM_BOOTSTRAP_FREE_DISK_BYTES )); then
  echo "Heavy runner preflight failed: ${AVAILABLE_BYTES} free bytes; ${MINIMUM_BOOTSTRAP_FREE_DISK_BYTES} required before setup." >&2
  exit 1
fi

gh auth status --hostname github.com >/dev/null
EXISTING_RUNNERS="$(gh api "repos/$REPOSITORY/actions/runners" --paginate \
  --jq ".runners[] | select(any(.labels[]; .name == \"$RUNNER_LABEL\")) | .name")"
[[ -z "$EXISTING_RUNNERS" ]] || {
  echo "A runner with label $RUNNER_LABEL is already registered; refusing concurrent registration." >&2
  exit 1
}

echo "Heavy runner preflight passed for $RUNNER_LABEL with $AVAILABLE_BYTES free bytes."
if [[ "$PREFLIGHT_ONLY" == "1" ]]; then
  exit 0
fi

[[ ! -e "$RUNNER_ROOT" ]] || { echo "Runner root already exists: $RUNNER_ROOT" >&2; exit 1; }
mkdir -p "$RUNNER_ROOT"
touch "$RUNNER_ROOT/$MARKER_NAME"
RUNNER_NAME="${RUNNER_NAME_PREFIX}$(date +%s)-$$"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$WATCHDOG_PID" ]] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
  fi
  if [[ -n "$RUNNER_PID" ]] && kill -0 "$RUNNER_PID" 2>/dev/null; then
    kill -TERM "$RUNNER_PID" 2>/dev/null || true
    wait "$RUNNER_PID" 2>/dev/null || true
  fi
  if [[ -n "$RUNNER_NAME" ]]; then
    local runner_id
    runner_id="$(gh api "repos/$REPOSITORY/actions/runners" --paginate \
      --jq ".runners[] | select(.name == \"$RUNNER_NAME\") | .id" 2>/dev/null || true)"
    if [[ -n "$runner_id" ]]; then
      gh api --method DELETE "repos/$REPOSITORY/actions/runners/$runner_id" >/dev/null 2>&1 \
        || echo "Warning: GitHub runner deregistration failed for $RUNNER_NAME." >&2
    fi
  fi
  if [[ -d "$RUNNER_ROOT/_diag" ]]; then
    local diagnostic_root="${RUNNER_ROOT}.logs/$(date -u +%Y%m%dT%H%M%SZ)-${RUNNER_NAME}"
    mkdir -p "$diagnostic_root"
    cp -R "$RUNNER_ROOT/_diag/." "$diagnostic_root/" \
      || echo "Warning: runner diagnostic log retention failed." >&2
  fi
  if [[ -f "$RUNNER_ROOT/$MARKER_NAME" ]]; then
    /bin/rm -rf -- "$RUNNER_ROOT"
  else
    echo "Warning: cleanup refused because the runner marker is missing: $RUNNER_ROOT" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

curl --fail --location --retry 3 --output "$RUNNER_ROOT/$RUNNER_ARCHIVE" "$RUNNER_ARCHIVE_URL"
ACTUAL_SHA256="$(shasum -a 256 "$RUNNER_ROOT/$RUNNER_ARCHIVE" | awk '{ print $1 }')"
[[ "$ACTUAL_SHA256" == "$RUNNER_ARCHIVE_SHA256" ]] || {
  echo "Runner archive SHA-256 mismatch: $ACTUAL_SHA256" >&2
  exit 1
}
tar -xzf "$RUNNER_ROOT/$RUNNER_ARCHIVE" -C "$RUNNER_ROOT"
/bin/rm -f -- "$RUNNER_ROOT/$RUNNER_ARCHIVE"

REGISTRATION_TOKEN="$(gh api --method POST "repos/$REPOSITORY/actions/runners/registration-token" --jq .token)"
(
  cd "$RUNNER_ROOT"
  ./config.sh \
    --unattended \
    --ephemeral \
    --disableupdate \
    --no-default-labels \
    --url "https://github.com/$REPOSITORY" \
    --token "$REGISTRATION_TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "$RUNNER_LABEL" \
    --work _work
)
unset REGISTRATION_TOKEN

echo "Runner $RUNNER_NAME is online for exactly one matching job."
(
  cd "$RUNNER_ROOT"
  exec ./run.sh
) &
RUNNER_PID=$!
(
  sleep "$RUNNER_ONLINE_TIMEOUT_SECONDS"
  if kill -0 "$RUNNER_PID" 2>/dev/null; then
    echo "Runner online timeout reached; stopping $RUNNER_NAME." >&2
    kill -TERM "$RUNNER_PID" 2>/dev/null || true
  fi
) &
WATCHDOG_PID=$!

set +e
wait "$RUNNER_PID"
RUNNER_STATUS=$?
set -e
kill "$WATCHDOG_PID" 2>/dev/null || true
wait "$WATCHDOG_PID" 2>/dev/null || true
exit "$RUNNER_STATUS"
