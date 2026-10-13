#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ "${PLAYWRIGHT_DOCKER:-}" = 1 ]; then
  bun run build
  exec bunx playwright test "$@"
fi

runtime=docker
if command -v podman >/dev/null 2>&1; then runtime=podman; fi
# shellcheck disable=SC2016
exec "$runtime" run --rm --init --ipc=host --platform linux/amd64 \
  -v "$PWD:/work" -v /work/node_modules -w /work \
  -e PLAYWRIGHT_DOCKER=1 mcr.microsoft.com/playwright:v1.61.1-noble \
  sh -c 'apt-get update -qq && apt-get install -y -qq git unzip >/dev/null &&
    git config --global --add safe.directory /work &&
    npm install --prefix /tmp/tools bun@1.3.14 >/dev/null &&
    export PATH="/tmp/tools/node_modules/.bin:$PATH" &&
    bun install --frozen-lockfile && sh scripts/test-browser.sh "$@"' sh "$@"
