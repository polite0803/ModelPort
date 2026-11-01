---
name: modelport-provider-model-matrix
description: Use when running ModelPort provider and model matrix tests using live /v1/models discovery and management API attribution.
---

# ModelPort Provider Model Matrix

Use this skill when model coverage must follow the live `/v1/models` surface.

## Rules

- Use `GET /v1/models` as the primary model source.
  Since 2026-11-01 that endpoint advertises **routes only** (`docs/PLAN-routes-only-surface.md` R2):
  every id returned is an enabled `AppConfig.routes` name with `owned_by: auto-router`, and no
  per-provider model or user alias appears. A matrix run against it therefore proves the routes; to
  cover individual models name them directly (a served model still answers `model: <name>`) or read
  the provider catalogue through the management API.
- Use management API data for attribution and cleanup.
- Keep provider fail-fast opt-in.

## Commands

```bash
modelport_BASE_URL=http://127.0.0.1:8080 \
modelport_MGMT_SECRET=mgmt_xxx \
MODELPORT_API_KEY=sk_xxx \
node skills/modelport-provider-model-matrix/scripts/run-model-matrix.mjs \
  --fixture backup/har/cherry-studio-fixture.json \
  --profile cherry-studio
```

The default model source is `GET /v1/models`. Use `--provider`, `--model`, and `--fail-fast-provider N` to narrow live runs.
