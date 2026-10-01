# scripts/local-dev-conf.sh
set -euo pipefail

: "${APP_VERSION:?is set from package.json by scripts/run-conf.mjs}"
CARGO_PACKAGE_VERSION="$APP_VERSION"
CARGO_PACKAGE_NAME="liatir"

sed -e "s/%%CARGO_PACKAGE_NAME%%/${CARGO_PACKAGE_NAME}/g" \
    -e "s/%%CARGO_PACKAGE_VERSION%%/${CARGO_PACKAGE_VERSION}/g" \
  conf-templates/Cargo.template.toml > src-tauri/Cargo.toml

sed -e "s|%%APP_URL%%||g" \
    -e "s|%%APP_VERSION%%|${APP_VERSION}|g" \
  conf-templates/bridge.constants.template.json > src-ts/bridge.constants.json

sed -e "s|%%APP_VERSION%%|${APP_VERSION}|g" \
  conf-templates/tauri.conf.template.local.dev.json > src-tauri/tauri.conf.json

# local capability — for local webview content (build:local → tauri://localhost)
cp conf-templates/capability.local.json src-tauri/capabilities/local.json

# local-dev capability — authorizes the Vite dev server (devUrl http://localhost:5173)
# to use the bridge commands during `npm run dev` (HMR). Not used by build:local/prod.
cp conf-templates/capability.local-dev.json src-tauri/capabilities/local-dev.json

cat > src-tauri/window.env << 'EOF'
MAIN_WINDOW_URL=
MAIN_WINDOW_TITLE=Liatir
MAIN_WINDOW_WIDTH=1200
MAIN_WINDOW_HEIGHT=800
MAIN_WINDOW_BG_COLOR=#171717
MAIN_WINDOW_RESIZABLE=true
MAIN_WINDOW_VISIBLE=true
MAIN_WINDOW_OPEN_FULLSCREEN=false
EOF

echo "Local dev config applied"
echo "Cargo.toml -> ${CARGO_PACKAGE_NAME} v${CARGO_PACKAGE_VERSION}"
echo "Capability -> local (tauri://localhost, no remote.urls)"
