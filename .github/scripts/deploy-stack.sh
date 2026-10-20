#!/usr/bin/env bash

# Updates the production stack. deploy.yml feeds this file to
# `ssh <host> bash -s -- <remote path>`, so it runs on the host, in the
# directory holding the compose file the deploy just uploaded.

cd "$1"
docker compose pull
# compose run attaches stdin, which is this script, so without
# </dev/null it consumes the lines below and they never run.
docker compose --profile migrate run --rm -T migrate </dev/null || exit
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
services="$(docker compose config --services)" || exit
for service in web-standby web; do
  grep -qx "$service" <<<"$services" || continue
  docker compose up -d --wait --wait-timeout 300 "$service" || exit
done
# Both web containers are current by now, so this leaves them be.
docker compose --profile node-exporter up -d --remove-orphans
# up -d leaves a container alone when only a file it mounts
# changed, so Prometheus and Alertmanager reread their config and
# rules here. An invalid file keeps the previous one loaded.
docker compose kill -s SIGHUP prometheus alertmanager
