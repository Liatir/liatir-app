#!/usr/bin/env bash

# Installs the native Linux libraries required to compile and exercise the Tauri product lifecycle.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Runtime Box Linux product dependencies require a Linux host." >&2
  exit 1
fi

PACKAGES=(
  libwebkit2gtk-4.1-dev
  build-essential
  curl
  wget
  file
  libxdo-dev
  libssl-dev
  libayatana-appindicator3-dev
  librsvg2-dev
  xvfb
)

MISSING=()
for package in "${PACKAGES[@]}"; do
  status="$(dpkg-query --show --showformat='${db:Status-Status}' "$package" 2>/dev/null || true)"
  [[ "$status" == "installed" ]] || MISSING+=("$package")
done

# Reach for root only when there is something to install. A self-hosted runner is a prepared
# machine whose operator may deliberately withhold passwordless sudo; on such a host an
# unconditional `apt-get update` fails the job over packages that are already present.
if (( ${#MISSING[@]} == 0 )); then
  echo "Every Runtime Box Linux product dependency is already installed."
  exit 0
fi

echo "Installing missing Runtime Box Linux product dependencies: ${MISSING[*]}"
sudo apt-get update
sudo apt-get install --yes --no-install-recommends "${MISSING[@]}"
