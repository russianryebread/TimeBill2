#!/usr/bin/env bash
# Bump the patch version in root package.json, then sync apps/desktop/src-tauri/Cargo.toml
# so both the web display and the native build agree on the version.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

npm version patch --no-git-tag-version

# Sync Cargo.toml with the new version
NEW_VER="$(node -p "require('./package.json').version")"
sed -i '' -E 's/^version = ".*"/version = "'"$NEW_VER"'"/' apps/desktop/src-tauri/Cargo.toml

echo "→ bumped to $NEW_VER"
