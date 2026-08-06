#!/usr/bin/env bash

# Installs the native Linux libraries required to compile and exercise the Tauri product lifecycle.
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Runtime Box Linux product dependencies require a Linux host." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install --yes --no-install-recommends \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  xvfb
