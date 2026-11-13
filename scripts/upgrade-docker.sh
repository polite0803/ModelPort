#!/usr/bin/env bash
# Upgrade the ModelPort Docker container to a released image, preserving data + config.
#
#   bash upgrade-docker.sh <version> [arch]        # arch defaults to x64 (arm64 machines pass arm64)
#   DRY_RUN=1 bash upgrade-docker.sh 1.8.14        # print the plan, change nothing
#   CONTAINER=modelport REPO=polite0803/ModelPort  # overridable via env
#
# Run this ON the Docker host. It reads the existing container's volume(s), published
# ports and restart policy and reuses them verbatim, so the upgrade cannot drift from how
# the container was first deployed. The named volume (data.json / tls / channels) is never
# touched - that is what makes this an upgrade and not a reinstall. First-time installs use
# the console deploy guide (--init-host), not this script.
set -euo pipefail
VER="${1:?usage: upgrade-docker.sh <version> [arch]}"
ARCH="${2:-x64}"
CONTAINER="${CONTAINER:-modelport}"
REPO="${REPO:-polite0803/ModelPort}"
NAME="modelport-daemon-${VER}-docker-${ARCH}.tar.gz"
BASE="https://github.com/${REPO}/releases/download/v${VER}"
TAG="modelport-daemon:${VER}"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "no container '$CONTAINER' on this host - this is an upgrade tool; for a first install use the console deploy guide" >&2
  exit 1
fi

# Capture the live run config so the new container matches it exactly.
RESTART=$(docker inspect "$CONTAINER" --format '{{.HostConfig.RestartPolicy.Name}}')
mapfile -t VOLS < <(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}:{{.Destination}}{{"\n"}}{{end}}{{end}}')
mapfile -t PORTS < <(docker inspect "$CONTAINER" --format '{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{if .HostIp}}{{.HostIp}}:{{end}}{{.HostPort}}:{{$p}}{{"\n"}}{{end}}{{end}}')

RUN_ARGS=( -d --name "$CONTAINER" --restart "$RESTART" )
for v in "${VOLS[@]}"; do [ -n "$v" ] && RUN_ARGS+=( -v "$v" ); done
for p in "${PORTS[@]}"; do [ -n "$p" ] && RUN_ARGS+=( -p "$p" ); done
RUN_ARGS+=( "$TAG" )

echo "current image : $(docker inspect "$CONTAINER" --format '{{.Config.Image}}')"
echo "target image  : $TAG"
echo "volume(s)     : ${VOLS[*]}"
echo "port(s)       : ${PORTS[*]}"
echo "restart       : $RESTART"
echo "docker run    : docker run ${RUN_ARGS[*]}"
if [ "${DRY_RUN:-0}" = "1" ]; then echo "(dry run - nothing changed)"; exit 0; fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

echo "== download ${NAME} =="
curl -fL --retry 3 --connect-timeout 20 -O "$BASE/$NAME"
curl -fL --retry 3 --connect-timeout 20 -O "$BASE/$NAME.sha256"

echo "== verify sha256 =="
sha256sum -c "$NAME.sha256"

echo "== docker load =="
docker load -i "$NAME"

echo "== recreate container (volume kept) =="
docker stop "$CONTAINER"
docker rm "$CONTAINER"
docker run "${RUN_ARGS[@]}"

echo "== wait for HTTP listener =="
HTTP_PORT=$(docker exec "$CONTAINER" node -e "const d=require('/data/data.json');process.stdout.write(String((d.config&&d.config.proxyPort)||8080))")
healthy=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then
  echo "::error::daemon did not come up on ${HTTP_PORT}; last logs:" >&2
  docker logs "$CONTAINER" --tail 40 2>&1
  exit 1
fi

echo "== container =="
docker ps --filter "name=${CONTAINER}" --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'
echo "== version =="
curl -fsS "http://127.0.0.1:${HTTP_PORT}/" | grep -o '"version":"[^"]*"'

echo "== management plane (secret read inside container, never echoed) =="
SECRET=$(docker exec "$CONTAINER" node -e "const d=require('/data/data.json');process.stdout.write((d.config&&d.config.managementApi&&d.config.managementApi.managementApiSecret)||'')")
echo "secret prefix: ${SECRET:0:5}  len: ${#SECRET}"
WITH=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Management-Secret: ${SECRET}" "http://127.0.0.1:${HTTP_PORT}/v1/management/config")
WITHOUT=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HTTP_PORT}/v1/management/config")
echo "mgmt with-secret HTTP: ${WITH}  without-secret HTTP: ${WITHOUT}"
if [ "$WITH" != "200" ] || [ "$WITHOUT" != "401" ]; then
  echo "::error::management plane probe unexpected (want 200/401)" >&2
  docker logs "$CONTAINER" --tail 30 2>&1
  exit 1
fi
echo "== UPGRADE OK: ${VER} running, management plane 200/401 =="