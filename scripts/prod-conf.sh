# scripts/prod-conf.sh
set -euo pipefail

# -----------------------------
# Read inputs with safe defaults
# -----------------------------
: "${APP_VERSION:?is set from package.json by scripts/run-conf.mjs}"
: "${CARGO_PACKAGE_NAME:=liatir}"
: "${CARGO_PACKAGE_VERSION:=$APP_VERSION}"
: "${APP_IDENTIFIER:=app.liatir.app}"
# direct: the app updates itself from UPDATE_ENDPOINT. msix: the Microsoft Store
# owns updates, so the build carries no updater configuration at all.
: "${DISTRIBUTION:=direct}"
: "${TAURI_SIGNING_PUBLIC_KEY:=}"

case "$DISTRIBUTION" in
  direct)
    : "${UPDATE_ENDPOINT:?Missing UPDATE_ENDPOINT (set by CI)}"
    if [ -z "${ED25519_PUBKEY:-}" ] && [ -n "${TAURI_SIGNING_PUBLIC_KEY:-}" ]; then
      ED25519_PUBKEY="$TAURI_SIGNING_PUBLIC_KEY"
    fi
    : "${ED25519_PUBKEY:?Missing ED25519_PUBKEY (CI var/secret)}"
    ;;
  msix) ;;
  *)
    echo "DISTRIBUTION must be direct or msix, got: $DISTRIBUTION"
    exit 1
    ;;
esac
: "${DEEPLINK_SCHEME:=}"
: "${MAIN_WINDOW_TITLE:=Liatir}"
: "${MAIN_WINDOW_WIDTH:=1200}"
: "${MAIN_WINDOW_HEIGHT:=800}"
: "${MAIN_WINDOW_BG_COLOR:=#ffffff}"
: "${MAIN_WINDOW_URL:=}"
: "${MAIN_WINDOW_RESIZABLE:=true}"
: "${MAIN_WINDOW_OPEN_FULLSCREEN:=false}"

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
# Validate immutable release inputs
# -----------------------------

if [ -n "$MAIN_WINDOW_URL" ]; then
  echo "MAIN_WINDOW_URL must be empty for an offline-capable production build"
  exit 1
fi

if [ "$DISTRIBUTION" = direct ] && ! printf '%s' "$UPDATE_ENDPOINT" | grep -Eq '^https://'; then
  echo "UPDATE_ENDPOINT must use HTTPS for a production build"
  exit 1
fi

# -----------------------------
# Always use PROD templates
# -----------------------------

TAURI_TEMPLATE="conf-templates/tauri.conf.template.prod.json"

# -----------------------------
# Generate files from templates
# -----------------------------

echo "1. Generating files from templates"

# Production web content is bundled. The app never depends on a hosted UI.
cp conf-templates/capability.local.json src-tauri/capabilities/local.json
echo "  local.json              -> copied (bundled frontend)"

# Cargo.toml
sed -e "s/%%CARGO_PACKAGE_NAME%%/${CARGO_PACKAGE_NAME}/g" \
    -e "s/%%CARGO_PACKAGE_VERSION%%/${CARGO_PACKAGE_VERSION}/g" \
  conf-templates/Cargo.template.toml > src-tauri/Cargo.toml

echo "  Cargo.toml              -> patched [${CARGO_PACKAGE_NAME} ${CARGO_PACKAGE_VERSION}]"

# bridge.constants.json
sed -e "s|%%APP_URL%%||g" \
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

# Updater config
echo "6. Patching updater settings (Tauri v2 plugin, $DISTRIBUTION)"
if [ "$DISTRIBUTION" = direct ]; then
  jq --arg endpoint "$UPDATE_ENDPOINT" --arg pubkey "$ED25519_PUBKEY" '
    .bundle = (.bundle // {}) |
    .bundle.createUpdaterArtifacts = true |
    .plugins = (.plugins // {}) |
    .plugins.updater = (.plugins.updater // {}) |
    .plugins.updater.endpoints = [ $endpoint ] |
    .plugins.updater.pubkey = $pubkey
  ' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
else
  jq '
    .bundle.createUpdaterArtifacts = false |
    del(.plugins.updater)
  ' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
fi

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
echo "  frontendDist:"
jq '.build.frontendDist' src-tauri/tauri.conf.json
