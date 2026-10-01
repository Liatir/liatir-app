#!/bin/sh

set -eu

# The `liatir` SDK is versioned with the app, and the root package.json is the app version's only
# source (see scripts/app-version.mjs). Read it there rather than from a generated copy.
SOURCE_FILE="../package.json"
PACKAGE_JSON_FILE="./package.json"
PACKAGE_LOCK_JSON_FILE="./package-lock.json"

API_VERSION=$(jq -r '.version // empty' "$SOURCE_FILE")

if [ -z "$API_VERSION" ]; then
  echo "\"version\" not found in $SOURCE_FILE" >&2
  exit 1
fi

tmp_package="$(mktemp)"
tmp_package_lock="$(mktemp)"

jq --arg value "$API_VERSION" '
  .version = $value
' "$PACKAGE_JSON_FILE" > "$tmp_package"

jq --arg value "$API_VERSION" '
  .version = $value
  | .packages[""].version = $value
' "$PACKAGE_LOCK_JSON_FILE" > "$tmp_package_lock"

mv "$tmp_package" "$PACKAGE_JSON_FILE"
mv "$tmp_package_lock" "$PACKAGE_LOCK_JSON_FILE"

echo "Copied \"version\" from $SOURCE_FILE to \"version\" in $PACKAGE_JSON_FILE"
echo "Copied \"version\" from $SOURCE_FILE to \"version\" in $PACKAGE_LOCK_JSON_FILE"
echo "Copied \"version\" from $SOURCE_FILE to \"packages[\"\"].version\" in $PACKAGE_LOCK_JSON_FILE"
