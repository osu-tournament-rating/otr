#!/usr/bin/env bash
# Prints the ID the web image is built with. Open pages compare it with the
# server's to notice a release that changed the site, and the server refuses
# their writes until they reload. It covers only what the web image is built
# from, so a release that changes only the processor, scripts, docs or
# monitoring leaves open pages working.
set -euo pipefail

git rev-parse \
  HEAD:apps/web \
  HEAD:packages/otr-core \
  HEAD:lib \
  HEAD:package.json \
  HEAD:bun.lock \
  HEAD:tsconfig.json |
  sha256sum | cut -c1-12
