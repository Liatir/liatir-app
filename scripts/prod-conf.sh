# scripts/prod-conf.sh
set -euo pipefail

# -----------------------------
# Read inputs with safe defaults
# -----------------------------
: "${APP_URL:=http://blank.html}"
: "${APP_VERSION:=0.1.0}"
: "${CARGO_PACKAGE_NAME:=desktopr-wrapper}"
: "${CARGO_PACKAGE_VERSION:=$APP_VERSION}"
: "${APP_IDENTIFIER:=app.desktopr.app}"
: "${UPDATE_ENDPOINT:?Missing UPDATE_ENDPOINT (set by CI)}"
: "${TAURI_SIGNING_PUBLIC_KEY:=}"

if [ -z "${ED25519_PUBKEY:-}" ] && [ -n "${TAURI_SIGNING_PUBLIC_KEY:-}" ]; then
  ED25519_PUBKEY="$TAURI_SIGNING_PUBLIC_KEY"
fi

: "${ED25519_PUBKEY:?Missing ED25519_PUBKEY (CI var/secret)}"
: "${DEEPLINK_SCHEME:=}"
: "${MAIN_WINDOW_TITLE:=Desktopr}"
: "${MAIN_WINDOW_WIDTH:=1200}"
: "${MAIN_WINDOW_HEIGHT:=800}"
: "${MAIN_WINDOW_BG_COLOR:=#ffffff}"
: "${MAIN_WINDOW_URL:=$APP_URL}"
: "${MAIN_WINDOW_RESIZABLE:=true}"
: "${MAIN_WINDOW_OPEN_FULLSCREEN:=false}"
: "${COMPANION_MODE:=false}"

cat > src-tauri/window.env << EOF
MAIN_WINDOW_URL=${MAIN_WINDOW_URL}
MAIN_WINDOW_TITLE=${MAIN_WINDOW_TITLE}
MAIN_WINDOW_WIDTH=${MAIN_WINDOW_WIDTH}
MAIN_WINDOW_HEIGHT=${MAIN_WINDOW_HEIGHT}
MAIN_WINDOW_BG_COLOR=${MAIN_WINDOW_BG_COLOR}
MAIN_WINDOW_RESIZABLE=${MAIN_WINDOW_RESIZABLE}
MAIN_WINDOW_VISIBLE=false
MAIN_WINDOW_OPEN_FULLSCREEN=${MAIN_WINDOW_OPEN_FULLSCREEN}
EOF

# -----------------------------
# Resolve APP_URL origin and remote URL patterns
# -----------------------------

APP_URL_ORIGIN="$(printf '%s' "$APP_URL" | sed -E 's#^(https?://[^/]+).*$#\1#')"

if ! printf '%s' "$APP_URL_ORIGIN" | grep -Eq '^https?://[^/]+$'; then
  echo "Invalid APP_URL origin resolved from APP_URL: $APP_URL"
  exit 1
fi

APP_URL_SCHEME="$(printf '%s' "$APP_URL_ORIGIN" | sed -E 's#^(https?)://.*$#\1#')"
APP_URL_HOST="$(printf '%s' "$APP_URL_ORIGIN" | sed -E 's#^https?://([^/:]+)(:[0-9]+)?$#\1#')"
APP_URL_PORT="$(printf '%s' "$APP_URL_ORIGIN" | sed -nE 's#^https?://[^/:]+(:[0-9]+)$#\1#p')"

APP_URL_HOST_WITH_PORT="${APP_URL_HOST}${APP_URL_PORT}"
APP_URL_WILDCARD_HOST="*.${APP_URL_HOST}${APP_URL_PORT}"

echo "Resolved APP_URL_ORIGIN=$APP_URL_ORIGIN"
echo "Resolved APP_URL_SCHEME=$APP_URL_SCHEME"
echo "Resolved APP_URL_HOST_WITH_PORT=$APP_URL_HOST_WITH_PORT"

if [ "$COMPANION_MODE" = "true" ]; then
  echo "COMPANION_MODE=true (this build accepts IPC from any https origin)"
fi

# -----------------------------
# Always use PROD templates
# -----------------------------

TAURI_TEMPLATE="conf-templates/tauri.conf.template.prod.json"

# -----------------------------
# Generate files from templates
# -----------------------------

echo "1. Generating files from templates"

# remote.json capabilities
cp conf-templates/remote.template.json src-tauri/capabilities/remote.json

if [ "$COMPANION_MODE" = "true" ]; then
  jq '
    .remote = (.remote // {}) |
    .remote.urls = [
      "https://*/*",
      "https://*.*/*",
      "http://localhost/*",
      "http://localhost:*/*",
      "http://127.0.0.1/*",
      "http://127.0.0.1:*/*"
    ]
  ' src-tauri/capabilities/remote.json > src-tauri/capabilities/remote.json.tmp && mv src-tauri/capabilities/remote.json.tmp src-tauri/capabilities/remote.json
else
  jq \
    --arg scheme "$APP_URL_SCHEME" \
    --arg host "$APP_URL_HOST_WITH_PORT" \
    --arg wildcardHost "$APP_URL_WILDCARD_HOST" \
    '
    .remote = (.remote // {}) |
    .remote.urls = [
      ($scheme + "://" + $host + "/*"),
      ($scheme + "://" + $wildcardHost + "/*")
    ]
    ' src-tauri/capabilities/remote.json > src-tauri/capabilities/remote.json.tmp && mv src-tauri/capabilities/remote.json.tmp src-tauri/capabilities/remote.json
fi

echo "  remote.json             -> patched"
echo "  remote.urls:"
jq '.remote.urls' src-tauri/capabilities/remote.json

# Cargo.toml
sed -e "s/%%CARGO_PACKAGE_NAME%%/${CARGO_PACKAGE_NAME}/g" \
    -e "s/%%CARGO_PACKAGE_VERSION%%/${CARGO_PACKAGE_VERSION}/g" \
  conf-templates/Cargo.template.toml > src-tauri/Cargo.toml

echo "  Cargo.toml              -> patched [${CARGO_PACKAGE_NAME} ${CARGO_PACKAGE_VERSION}]"

# bridge.constants.json
sed -e "s|%%APP_URL%%|${APP_URL_ORIGIN}|g" \
    -e "s|%%APP_VERSION%%|${APP_VERSION}|g" \
  conf-templates/bridge.constants.template.json > src-ts/bridge.constants.json

echo "  bridge.constants.json   -> patched"

# tauri.conf.json
cp "${TAURI_TEMPLATE}" src-tauri/tauri.conf.json

# -----------------------------
# Patch configuration values
# -----------------------------

echo "2. Checking if file exists and is valid JSON"
jq . src-tauri/tauri.conf.json >/dev/null

# Identifier and product name
echo "3. Patching identifier and product name"
jq \
  --arg ident "$APP_IDENTIFIER" \
  --arg prod "$MAIN_WINDOW_TITLE" \
  '
  .identifier = ($ident // .identifier) |
  .productName = ($prod // .productName)
  ' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# Top-level version
echo "3.1. Patching top-level version"
jq \
  --arg ver "$APP_VERSION" \
  '.version = $ver' \
  src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# CSP allowlist
echo "5. Patching CSP allowlist"
if [ "$COMPANION_MODE" = "true" ]; then
  jq '
    .app = (.app // {}) |
    .app.security = (.app.security // {}) |
    .app.security.csp = (
      "default-src * data: blob: '\''unsafe-inline'\'' '\''unsafe-eval'\''; " +
      "img-src * data: blob:; " +
      "connect-src * ipc: http://ipc.localhost; " +
      "media-src *;"
    )
  ' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
else
  jq --arg url "$APP_URL_ORIGIN" '
    .app = (.app // {}) |
    .app.security = (.app.security // {}) |
    .app.security.csp = (
      "default-src '\''self'\'' " + $url + "; " +
      "script-src '\''self'\'' " + $url + " '\''unsafe-inline'\''; " +
      "style-src '\''self'\'' " + $url + " '\''unsafe-inline'\''; " +
      "img-src * data: blob:; " +
      "connect-src *; " +
      "media-src *;"
    )
  ' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
fi

# Ensure remote capability is enabled
echo "5.1. Ensuring remote capability is enabled"
jq '
  .app = (.app // {}) |
  .app.security = (.app.security // {}) |
  .app.security.capabilities = (
    ((.app.security.capabilities // []) + ["remote"]) | unique
  )
' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# Updater config
echo "6. Patching updater settings (Tauri v2 plugin)"
jq --arg endpoint "$UPDATE_ENDPOINT" --arg pubkey "$ED25519_PUBKEY" '
  .bundle = (.bundle // {}) |
  .bundle.createUpdaterArtifacts = true |
  .plugins = (.plugins // {}) |
  .plugins.updater = (.plugins.updater // {}) |
  .plugins.updater.endpoints = [ $endpoint ] |
  .plugins.updater.pubkey = $pubkey
' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# Deep link config
echo "7. Patching deep-link plugin configuration"
if [ -n "$DEEPLINK_SCHEME" ]; then
  jq --arg scheme "$DEEPLINK_SCHEME" '
    .plugins = (.plugins // {}) |
    .plugins["deep-link"] = (.plugins["deep-link"] // {}) |
    .plugins["deep-link"].desktop = (.plugins["deep-link"].desktop // {}) |
    .plugins["deep-link"].desktop.schemes = [ $scheme ]
  ' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
fi

# -----------------------------
# Final checks
# -----------------------------

echo "8. Final checks"
echo "  tauri.conf.json -> patched"

echo "  enabled capabilities:"
jq '.app.security.capabilities' src-tauri/tauri.conf.json

echo "  final window URLs:"
jq '.app.windows[].url' src-tauri/tauri.conf.json

echo "  final remote.json:"
cat src-tauri/capabilities/remote.json