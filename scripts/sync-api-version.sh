#!/bin/sh

set -eu

SOURCE_FILE="../src-ts/bridge.constants.json"
PACKAGE_JSON_FILE="./package.json"
PACKAGE_LOCK_JSON_FILE="./package-lock.json"

SOURCE_KEY="apiVersion"

API_VERSION=$(jq -r --arg key "$SOURCE_KEY" '
  if has($key) then .[$key] else empty end
' "$SOURCE_FILE")

if [ -z "$API_VERSION" ]; then
  echo "Key \"$SOURCE_KEY\" not found in $SOURCE_FILE" >&2
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

echo "Copied \"$SOURCE_KEY\" from $SOURCE_FILE to \"version\" in $PACKAGE_JSON_FILE"
echo "Copied \"$SOURCE_KEY\" from $SOURCE_FILE to \"version\" in $PACKAGE_LOCK_JSON_FILE"
echo "Copied \"$SOURCE_KEY\" from $SOURCE_FILE to \"packages[\"\"].version\" in $PACKAGE_LOCK_JSON_FILE"