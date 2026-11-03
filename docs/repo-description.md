# GitHub repository description

> 适用版本：v1.7.0 ｜ 最后核对：2026-11-04 ｜ 状态：现行

## Short description (About field, 96 characters)

```text
OpenAI-compatible desktop gateway: 89 aggregate channels, 13 account channels, custom endpoints.
```

## Longer introduction

```text
ModelPort is an Electron desktop app that runs a local OpenAI-compatible API gateway. It bundles an aggregate catalogue of 89 endpoints and 570 models, thirteen account channels with their own account pools and credit accounting, and user-defined custom providers behind one base URL. Requests are routed across candidates with failover, quota-aware pacing, live credit gating and a virtual auto model; history trimming stays deletion-only and the gateway adds no system or user prompt turns. An optional HTTPS listener with managed certificate trust covers browser and Node-based clients, and per-request logs with X-Request-Id make failures traceable. Runs on macOS, Windows and Linux.
```
