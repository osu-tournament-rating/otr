#!/usr/bin/env bash

# Updates the production stack. deploy.yml feeds this file to
# `ssh <host> bash -s -- <remote path>`, so it runs on the host, in the
# directory holding the compose file the deploy just uploaded.
#
# Any failed command stops it and fails the deploy, so a release whose images
# did not pull or whose stack did not restart never moves the processor's
# `latest` or installs its operations scripts.

set -euo pipefail

cd "$1"
docker compose pull
# The previous release keeps serving while this migrates, so a migration
# that queues behind a long transaction for a table lock, such as the
# rating run's, would hold up every query on that table. The lock
# timeout stops it after 10 seconds instead and fails the deploy, which
# can then run again. The statement timeout stops a runaway statement;
# 15 minutes leaves room to rewrite the largest table.
# compose run attaches stdin, which is this script, so without
# </dev/null it consumes the lines below and they never run.
docker compose --profile migrate run --rm -T \
  -e MIGRATION_LOCK_TIMEOUT_MS=10000 \
  -e MIGRATION_STATEMENT_TIMEOUT_MS=900000 \
  migrate </dev/null
# One-time move of the docs into the stack: otr-docs' own deploy
# ran an `otr-docs` container outside compose, which holds the
# name and port compose's docs service needs. Remove this once a
# release has deployed the docs service.
if labels="$(docker container inspect -f '{{ json .Config.Labels }}' otr-docs 2>/dev/null)" &&
  [[ "$labels" != *com.docker.compose.project* ]]; then
  docker rm -f otr-docs
fi
# One web container at a time, so the other keeps serving. --wait
# holds until the new container passes its health check, and a
# container that never does stops the deploy with the other one
# still serving. `web-standby` goes first because Caddy sends it
# traffic only while `web` is down. A rollback to a release whose
# compose file has no `web-standby` restarts `web` alone, and
# --remove-orphans below then removes the standby.
services="$(docker compose config --services)"
for service in web-standby web; do
  grep -qx "$service" <<<"$services" || continue
  docker compose up -d --wait --wait-timeout 300 "$service"
done
# Both web containers are current by now, so this leaves them be.
docker compose --profile node-exporter up -d --remove-orphans
# up -d leaves a container alone when only a file it mounts
# changed, so Prometheus and Alertmanager reread their config and
# rules here. An invalid file keeps the previous one loaded.
docker compose kill -s SIGHUP prometheus alertmanager
