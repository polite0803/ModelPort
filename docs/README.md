# ModelPort Documentation

This directory holds the reference material for ModelPort. The documents have different jobs, and
they are not interchangeable:

- [`../README.md`](../README.md) and [`../README_CN.md`](../README_CN.md) are for people installing
  and using the app.
- [`../AGENTS.md`](../AGENTS.md) is the short rulebook for coding agents: build gate, architecture
  map, and the invariants that must not break.
- [`AGENTS-full.md`](AGENTS-full.md) is the full reference. Each section explains a subsystem and,
  where relevant, the failure that produced the rule.
- [`plan/`](plan/) holds dated decision records. They describe what was decided at that date, not
  necessarily what the code does today; read the state column before trusting a statement in them.
- [`data/`](data/) holds the source receipts for generated pricing, quota and capability sidecars.

When a document and the code disagree, the code and `AGENTS-full.md` win. Please update the doc in
the same change that moves the behaviour.

## Where to start

| If you want to… | Read |
| --- | --- |
| Install the app and send a first request | [`../README.md`](../README.md) (quick start), [`../README_CN.md`](../README_CN.md) |
| Add an aggregate entry, log in to an account channel, or create a custom provider | [`providers/README.md`](providers/README.md), [`../README.md`](../README.md) |
| Understand the request path and module layout | [`../AGENTS.md`](../AGENTS.md) (Architecture), [`AGENTS-full.md`](AGENTS-full.md) |
| Change the public API contract | [`AGENTS-full.md`](AGENTS-full.md) §Public API Contract, [`../AGENTS.md`](../AGENTS.md) (Invariants) |
| Extend a provider | [`../AGENTS.md`](../AGENTS.md) (Extending), [`AGENTS-full.md`](AGENTS-full.md) §Adding a New Provider, [`providers/README.md`](providers/README.md) |
| Debug routing, quota or streaming | [`AGENTS-full.md`](AGENTS-full.md) §Auto Routing, §Aggregate Free-Quota Layer, §Degenerate Stream Detection |
| Set up HTTPS on a LAN and make a client trust it | [`AGENTS-full.md`](AGENTS-full.md) §HTTPS Listener and Certificate Trust, [`../README.md`](../README.md) |
| Read request logs, trace a single request, or export diagnostics | [`AGENTS-full.md`](AGENTS-full.md) §Data Storage, [`../README.md`](../README.md) |
| Understand why the gateway does not rewrite prompts | [`AGENTS-full.md`](AGENTS-full.md) §Gateway-Authored Text Reaching the Model |

## Architecture and subsystem reference

[`AGENTS-full.md`](AGENTS-full.md) is the authoritative long-form document. The sections most often
needed:

- Build and verification, including the two `tsc` programs and the sandbox-only test failures
- Provider Adapters, Online Model List Update, Aggregate Provider Catalogue
- Inbound Protocols (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/completions`)
- Load Balance Strategies and Auto Routing (the virtual `auto` model)
- Aggregate Free-Quota Layer, per-model cost classification, live credit gate
- Account Channels and the vendored channel pack
- Tool Calling (native passthrough only) and Gateway-Authored Text
- Public API Contract, HTTPS Listener and Certificate Trust
- Data Storage, Adding a New Provider

[`../CODE_WIKI.md`](../CODE_WIKI.md) is an older, shorter overview. It is kept for orientation only;
where it differs from `AGENTS.md` or `AGENTS-full.md`, the latter are correct.

## Provider notes

- [`providers/README.md`](providers/README.md) - how the three provider classes are stored, how
  namespaced model names are built, and what the aggregate catalogue needs at save time.
- [`providers/opencode.md`](providers/opencode.md) - the live `opencode` account channel, and the
  retired local runtime that must not be confused with it.

## Decision records

[`plan/`](plan/) contains dated plans, field measurements and closing notes. They are useful for
provenance ("why is this rule here?") and for the evidence behind a threshold; they are not a
description of the current product surface.

| Document | Date | State |
| --- | --- | --- |
| [`plan/PLAN-api-defects.md`](plan/PLAN-api-defects.md) | 2026-10-27 | Implemented and closed; P3 entries superseded by the 2026-11-03 no-prompt ruling |
| [`plan/PLAN-api-defects-status.md`](plan/PLAN-api-defects-status.md) | 2026-10-27 | Execution status and gate readings |
| [`plan/PLAN-retire-web-providers-aggregate.md`](plan/PLAN-retire-web-providers-aggregate.md) | 2026-10-28 | Implemented and closed 2026-11-03 |
| [`plan/PLAN-port-freellmapi-free-token.md`](plan/PLAN-port-freellmapi-free-token.md) | 2026-10-29 | Implemented; upstream response field spelling still needs a valid-key check |
| [`plan/PLAN-auto-routing-v2.md`](plan/PLAN-auto-routing-v2.md) | 2026-10-29 | Closed 2026-11-03; sticky hard pin is the default |
| [`plan/PLAN-magpie-borrowing.md`](plan/PLAN-magpie-borrowing.md) | 2026-10-29 | Closed; several phases withdrawn after review |
| [`plan/PLAN-token-compression.md`](plan/PLAN-token-compression.md) | 2026-10-29 | P0-P3 and P5 implemented; P4 not implemented by decision |
| [`plan/PLAN-auto-routing-freellmapi.md`](plan/PLAN-auto-routing-freellmapi.md) | 2026-10-30 | Closed 2026-11-03 |
| [`plan/PLAN-routes-only-surface.md`](plan/PLAN-routes-only-surface.md) | 2026-11-01 | Closed 2026-11-03 |
| [`plan/PLAN-channel-auto-stability.md`](plan/PLAN-channel-auto-stability.md) | 2026-11-01 | Field evidence and fix batches; see the task tracker for closing state |
| [`plan/PLAN-newapi-parity.md`](plan/PLAN-newapi-parity.md) | 2026-11-02 | Implemented 2026-11-02 |
| [`plan/PLAN-workbuddy-adaptation.md`](plan/PLAN-workbuddy-adaptation.md) | 2026-11-03 | Implemented and closed 2026-11-03 |
| [`plan/PLAN-next-dev-code-tasks.md`](plan/PLAN-next-dev-code-tasks.md) | 2026-11-03 | Task tracker; only external-key verification was left open at closing |
| [`plan/PLAN-model-list-scheduler.md`](plan/PLAN-model-list-scheduler.md) | 2026-11-03 | Scheduler decision record; implementation lives in `src/main/scheduler/` |

[`superpowers/`](superpowers/) holds the May 2026 in-app update and tool-testing skills
plans/specs. They are historical implementation notes, not current requirements.

## Data receipts

[`data/`](data/) is input, not output. The files there are the receipts behind the generated
TypeScript sidecars:

| Receipt | Generated sidecar | Builder |
| --- | --- | --- |
| `data/models-dev-cost.json` | `src/shared/aggregatePricing.ts` | `scripts/build-aggregate-pricing.mjs` |
| `data/models-dev-capabilities.json` | `src/shared/aggregateCapabilities.ts` | `scripts/build-aggregate-capabilities.mjs` |
| `data/free-quota-research/*.json` | `src/shared/aggregateQuota.ts` | `scripts/build-aggregate-quota.mjs` |

Edit the receipts and re-run the builder; never hand-edit the generated sidecar.
`free-quota-research/` is a dated probe log, so an old file records the measurement of that day,
not a current quota.

## Vendored upstream snapshots

[`upstream/workbuddy-v2.5.1/README.md`](upstream/workbuddy-v2.5.1/README.md) explains the WorkBuddy
source snapshot: provenance, checksums, and why it is staged for reading rather than imported by the
build.

## Screenshots

[`screenshots/`](screenshots/) holds the images used by the README files. Images that show a page
which no longer exists should be removed rather than left to imply a feature.
