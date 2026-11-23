#!/usr/bin/env bash
# Builds the `lh` CLI (apps/cli) into agent-computer/vendor/lh, where the computer image's
# Dockerfile copies it from. Run it before `docker compose build` whenever apps/cli or a package it
# bundles changes. `lh hetero exec` is what runs Claude Code on the coding computer and streams it
# back to the server.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cli="$here/../cli"

(cd "$cli" && pnpm install && pnpm run build)
rm -rf "$here/agent-computer/vendor/lh"
mkdir -p "$here/agent-computer/vendor"
cp -R "$cli/dist" "$here/agent-computer/vendor/lh"
echo "lh built into agent-computer/vendor/lh"
