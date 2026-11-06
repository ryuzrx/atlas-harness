#!/bin/bash
# Builds and runs the Dynamic Island checks (no screen recording or accessibility permission needed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
swiftc -target "$(uname -m)-apple-macosx14.0" -o "$OUT/island-test" \
  "$ROOT/apps/macos/tests/island/main.swift" "$ROOT/apps/macos/companion.swift"
"$OUT/island-test"
