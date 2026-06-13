# scripts/dev-config.sh
set -euo pipefail

# remote.json -> blank.html
APP_URL="http://blank.html"
APP_VERSION="0.2.1"
CARGO_PACKAGE_VERSION="0.2.1"
CARGO_PACKAGE_NAME="desktopr-wrapper"

sed -e "s|%%APP_URL%%|${APP_URL}|g" \
    -e "s|%%ASSETS_CDN_URL%%|${APP_URL}|g" \
  conf-templates/remote.template.json > src-tauri/capabilities/remote.json


sed -e "s/%%CARGO_PACKAGE_NAME%%/${CARGO_PACKAGE_NAME}/g" \
    -e "s/%%CARGO_PACKAGE_VERSION%%/${CARGO_PACKAGE_VERSION}/g" \
  conf-templates/Cargo.template.toml > src-tauri/Cargo.toml


sed -e "s|%%APP_URL%%|${APP_URL}|g" \
    -e "s|%%APP_VERSION%%|${APP_VERSION}|g" \
  conf-templates/bridge.constants.template.json > src-ts/bridge.constants.json


cp conf-templates/tauri.conf.template.local.dev.json src-tauri/tauri.conf.json

cat > src-tauri/window.env << 'EOF'
MAIN_WINDOW_URL=
MAIN_WINDOW_TITLE=Desktopr Companion
MAIN_WINDOW_WIDTH=1200
MAIN_WINDOW_HEIGHT=800
MAIN_WINDOW_BG_COLOR=#171717
MAIN_WINDOW_RESIZABLE=true
MAIN_WINDOW_VISIBLE=true
MAIN_WINDOW_OPEN_FULLSCREEN=false
EOF

echo "Dev remote.json -> ${APP_URL}"
echo "Dev Cargo.toml package name -> ${CARGO_PACKAGE_NAME}"
echo "Dev Cargo.toml package version -> ${CARGO_PACKAGE_VERSION}"
echo "Dev window.env -> written"
