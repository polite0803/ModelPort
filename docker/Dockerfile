# Build context is the staged daemon tree from `npm run build:daemon`:
#   docker build -f docker/Dockerfile -t modelport-daemon:<ver> dist/daemon-stage/modelport-daemon-<ver>
FROM node:24-slim

WORKDIR /app
COPY modelport-daemon.cjs ./
COPY resources ./resources
COPY renderer ./renderer

# The daemon resolves its data directory from homedir(), so HOME is the persistence
# knob: data.json, tls, ccr and logs all land in the /data volume.
ENV HOME=/data \
    MODELPORT_RESOURCE_ROOT=/app/resources \
    MODELPORT_WEB_ROOT=/app/renderer

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data

EXPOSE 8080 8443

ENTRYPOINT ["node", "/app/modelport-daemon.cjs"]