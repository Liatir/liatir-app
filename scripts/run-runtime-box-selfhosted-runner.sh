#!/usr/bin/env bash
set -euo pipefail

# Runs exactly one repository-scoped, ephemeral GitHub Actions job on this host, then removes the
# complete runner work root. Supports macOS (Apple silicon) and Linux x86_64, including WSL2.
# The target's runner profile must declare `selfHosted` in runtime-boxes/catalog.json; every
# operational parameter (label, name prefix, bootstrap disk floor) is read from that catalog so the
# launcher and CI can never disagree.
REPOSITORY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY="Liatir/liatir-stack"
RUNNER_VERSION="2.336.0"
# Pinned per OS/arch from https://github.com/actions/runner/releases/tag/v2.336.0
RUNNER_ARCHIVE_SHA256_OSX_ARM64="8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079"
RUNNER_ARCHIVE_SHA256_LINUX_X64="04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d"
RUNNER_ONLINE_TIMEOUT_SECONDS=11400
MODEL_ID=""
TARGET_ID=""
MODE=""
FOUNDATION_ID=""
RUNNER_ROOT=""
PREFLIGHT_ONLY=0
RUNNER_NAME=""
RUNNER_PID=""
WATCHDOG_PID=""
MARKER_NAME=".liatir-runtime-box-runner"

usage() {
  cat <<'EOF'
Usage: scripts/run-runtime-box-selfhosted-runner.sh \
         (--model MODEL_ID --target TARGET_ID --mode MODE | --foundation FIXTURE_ID) \
         --runner-root ABSOLUTE_PATH [--preflight-only]

Preflights or runs one private, repository-scoped, ephemeral GitHub Actions runner
on macOS (Apple silicon) or Linux x86_64, including WSL2. The runner root must be
outside the repository checkout. The complete runner root is removed after success,
failure, or interruption; runner diagnostic logs are retained beside it in
ABSOLUTE_PATH.logs.

Under WSL2 the runner root must live in the Linux filesystem (for example ~/…), never
under /mnt/<drive>: cross-filesystem I/O there is far too slow for a multi-gigabyte
conda prefix.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model|--target|--mode|--foundation|--runner-root)
      [[ $# -ge 2 ]] || { echo "$1 requires a value." >&2; exit 2; }
      case "$1" in
        --model) MODEL_ID="$2" ;;
        --target) TARGET_ID="$2" ;;
        --mode) MODE="$2" ;;
        --foundation) FOUNDATION_ID="$2" ;;
        --runner-root) RUNNER_ROOT="$2" ;;
      esac
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

[[ -n "$RUNNER_ROOT" ]] || { echo "Missing required argument for RUNNER_ROOT." >&2; usage >&2; exit 2; }
if [[ -n "$FOUNDATION_ID" ]]; then
  [[ -z "$MODEL_ID" && -z "$TARGET_ID" && -z "$MODE" ]] || {
    echo "--foundation cannot be combined with --model, --target, or --mode." >&2
    exit 2
  }
else
  for required in MODEL_ID TARGET_ID MODE; do
    [[ -n "${!required}" ]] || { echo "Missing required argument for ${required}." >&2; usage >&2; exit 2; }
  done
fi

[[ "$RUNNER_ROOT" == /* ]] || { echo "--runner-root must be an explicit absolute path." >&2; exit 2; }
[[ "$RUNNER_ROOT" != "/" ]] || { echo "The filesystem root cannot be used as a runner root." >&2; exit 2; }
case "$RUNNER_ROOT" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
    echo "The runner root must be outside the repository checkout." >&2
    exit 2
    ;;
esac
[[ ! -L "$RUNNER_ROOT" ]] || { echo "The runner root cannot be a symbolic link." >&2; exit 2; }
# WSL keeps Windows drives on a slow 9p mount; a multi-gigabyte conda prefix must not land there.
if [[ "$(uname -s)" == "Linux" && "$RUNNER_ROOT" == /mnt/* ]]; then
  echo "The runner root must live in the Linux filesystem, not on a mounted Windows drive: $RUNNER_ROOT" >&2
  exit 2
fi

# Resolve the host archive and its pinned digest; refuse any host this launcher has not been checked on.
HOST_KERNEL="$(uname -s)"
HOST_ARCH="$(uname -m)"
case "$HOST_KERNEL:$HOST_ARCH" in
  Darwin:arm64)
    RUNNER_PLATFORM="osx-arm64"
    RUNNER_ARCHIVE_SHA256="$RUNNER_ARCHIVE_SHA256_OSX_ARM64"
    HOST_CATALOG_PLATFORM="macos"
    HOST_CATALOG_ARCH="aarch64"
    ;;
  Linux:x86_64)
    RUNNER_PLATFORM="linux-x64"
    RUNNER_ARCHIVE_SHA256="$RUNNER_ARCHIVE_SHA256_LINUX_X64"
    HOST_CATALOG_PLATFORM="linux"
    HOST_CATALOG_ARCH="x86_64"
    ;;
  *)
    echo "Unsupported self-hosted host: $HOST_KERNEL $HOST_ARCH." >&2
    exit 1
    ;;
esac
RUNNER_ARCHIVE="actions-runner-${RUNNER_PLATFORM}-${RUNNER_VERSION}.tar.gz"
RUNNER_ARCHIVE_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}"

# Local tooling first. `gh` is checked later, just before the GitHub calls, so that a wrong-host or
# wrong-target invocation reports the real problem instead of an unrelated missing dependency.
for command in awk curl df node sleep tar; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

# sha256 tooling differs per OS: macOS ships shasum, Linux ships sha256sum.
if command -v sha256sum >/dev/null; then
  sha256_of() { sha256sum "$1" | awk '{ print $1 }'; }
elif command -v shasum >/dev/null; then
  sha256_of() { shasum -a 256 "$1" | awk '{ print $1 }'; }
else
  echo "Missing required command: sha256sum or shasum" >&2
  exit 1
fi

if [[ -n "$FOUNDATION_ID" ]]; then
  RESOLUTION="$(node "$REPOSITORY_ROOT/scripts/runtime-box-ci.mjs" resolve-foundation \
    --recipe "$FOUNDATION_ID")"
else
  RESOLUTION="$(node "$REPOSITORY_ROOT/scripts/runtime-box-ci.mjs" resolve \
    --model "$MODEL_ID" \
    --target "$TARGET_ID" \
    --mode "$MODE" \
    --native-requested false)"
fi
json_field() {
  node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(String(value[process.argv[2]]));' "$RESOLUTION" "$1"
}
RUNNER_LABEL="$(json_field runs_on)"
RUNNER_NAME_PREFIX="$(json_field runner_name_prefix)"
MINIMUM_BOOTSTRAP_FREE_DISK_BYTES="$(json_field minimum_bootstrap_free_disk_bytes)"
[[ "$(json_field self_hosted)" == "true" ]] || { echo "The resolved target is not self-hosted." >&2; exit 1; }

# This launcher is invoked by hand on whichever machine the operator is sitting at, so the target's
# host must be checked explicitly. Without this a macOS target launched from Linux would bring a
# Linux runner online under the macOS label and collect a job it cannot build.
TARGET_PLATFORM="$(json_field runner_platform)"
TARGET_ARCH="$(json_field runner_arch)"
[[ "$TARGET_PLATFORM" == "$HOST_CATALOG_PLATFORM" && "$TARGET_ARCH" == "$HOST_CATALOG_ARCH" ]] || {
  echo "Target runner is ${TARGET_PLATFORM}/${TARGET_ARCH} but this host is ${HOST_CATALOG_PLATFORM}/${HOST_CATALOG_ARCH}." >&2
  exit 1
}

DISK_PATH="$RUNNER_ROOT"
while [[ ! -e "$DISK_PATH" ]]; do
  DISK_PATH="$(dirname "$DISK_PATH")"
done
AVAILABLE_KIB="$(df -Pk "$DISK_PATH" | awk 'NR == 2 { print $4 }')"
[[ "$AVAILABLE_KIB" =~ ^[0-9]+$ ]] || { echo "Unable to read free disk space for $DISK_PATH." >&2; exit 1; }
AVAILABLE_BYTES=$((AVAILABLE_KIB * 1024))
if (( AVAILABLE_BYTES < MINIMUM_BOOTSTRAP_FREE_DISK_BYTES )); then
  echo "Self-hosted runner preflight failed: ${AVAILABLE_BYTES} free bytes; ${MINIMUM_BOOTSTRAP_FREE_DISK_BYTES} required before setup." >&2
  exit 1
fi

command -v gh >/dev/null || { echo "Missing required command: gh (needed to mint the runner registration token)" >&2; exit 1; }
gh auth status --hostname github.com >/dev/null
EXISTING_RUNNERS="$(gh api "repos/$REPOSITORY/actions/runners" --paginate \
  --jq ".runners[] | select(any(.labels[]; .name == \"$RUNNER_LABEL\")) | .name")"
[[ -z "$EXISTING_RUNNERS" ]] || {
  echo "A runner with label $RUNNER_LABEL is already registered; refusing concurrent registration." >&2
  exit 1
}

echo "Self-hosted runner preflight passed for $RUNNER_LABEL with $AVAILABLE_BYTES free bytes."
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
ACTUAL_SHA256="$(sha256_of "$RUNNER_ROOT/$RUNNER_ARCHIVE")"
[[ "$ACTUAL_SHA256" == "$RUNNER_ARCHIVE_SHA256" ]] || {
  echo "Runner archive SHA-256 mismatch: $ACTUAL_SHA256" >&2
  exit 1
}
tar -xzf "$RUNNER_ROOT/$RUNNER_ARCHIVE" -C "$RUNNER_ROOT"
/bin/rm -f -- "$RUNNER_ROOT/$RUNNER_ARCHIVE"

# The Linux runner links against libicu; report it here instead of failing opaquely inside config.sh.
# grep reads the whole listing: with `-q` it exits at the first match, ldconfig dies of SIGPIPE, and
# pipefail turns a present libicu into a missing one.
if [[ "$RUNNER_PLATFORM" == "linux-x64" ]] && ! ldconfig -p 2>/dev/null | grep libicuuc >/dev/null; then
  echo "Missing libicu. Install it once with: sudo $RUNNER_ROOT/bin/installdependencies.sh" >&2
  exit 1
fi

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
