# AGENTS.md

> 适用版本：v1.7.3 ｜ 最后核对：2026-11-04 ｜ 状态：现行

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

ModelPort is an Electron desktop application that provides an OpenAI-compatible API proxy for standard HTTP model endpoints. It ships three provider classes: a 92-entry aggregate catalogue of key-based / key-less endpoints (see "Aggregate Provider Catalogue"), the fifteen account channels served by the vendored channel pack (see "Account Channels"), and user-defined custom providers. It runs on macOS, Windows, and Linux.

## Build Commands

```bash
# Development
npm run dev              # Start dev server (macOS/Linux)
npm run dev:win          # Start dev server (Windows)

# Build
npm run build            # Build the application
npm run build:mac        # Build for macOS (dmg only)
npm run build:win        # Build for Windows (nsis)
npm run build:linux      # Build for Linux (AppImage, deb)
npm run build:all        # Build for all platforms

# Preview production build
npm run preview
```

## Verification

`.github/workflows/ci.yml` runs the full gate (build + typecheck + suite) on every push and pull
request across Linux, Windows and macOS; `.github/workflows/release.yml` builds and publishes the
installers on a tag push matching `v*.*.*` / `v*.*.*-*`. `electron-vite build` transpiles without type
checking - a green build says nothing about types - which is why the gate runs both `tsc` programs.

The suite runs on Node's built-in test runner and must run on a Node that strips TypeScript natively
(22.18+ / 23.6+ / 24; CI pins 24). `scripts/check-node-version.mjs` fails fast with the fix when the
`node` on PATH is an older 22.x, where every `.test.ts` dies with `ERR_UNKNOWN_FILE_EXTENSION` - a
runtime problem, not a test failure. `npm run gate` is exactly what CI runs:

```bash
npm run gate                                           # build + tsc x2 + full suite
# equivalently, step by step:
npm run build                                          # bundle + check-source-artifacts guard
npx tsc --noEmit -p tsconfig.json                      # renderer + shared
npx tsc --noEmit -p tsconfig.node.json                 # main + preload
node --test "tests/**/*.test.ts" "tests/**/*.test.mjs" "tests/**/*.test.js"
```

Both `tsc -p tsconfig.json` (renderer + shared) and `tsc -p tsconfig.node.json` (main + preload +
shared) are clean - 0 errors. The two configs are standalone `tsconfig`s with no `references` /
`composite` wiring: each one includes `src/shared/**/*.ts` directly, so any error either one reports is
real. Do not reintroduce a project reference between them - a composite `tsconfig.node.json` makes the
renderer program resolve `@shared/*` through not-yet-built declaration outputs, which surfaces as
`TS6305` "output file has not been built" and silently suppresses the real downstream type errors.

**Eight test files cannot run in a pipe-blocking sandbox, and that is not a regression.** They fail
with `spawn EPERM` before any assertion executes, on both of the suite's two child-process paths:

| Files | Mechanism |
|-------|-----------|
| `tests/channels/{qoder-plan-gate,qoder-session-payload,workbuddy-port,minimax-tool-call-name}.test.ts` | `esbuild.build()` spawns the esbuild service binary |
| `tests/skills/modelport-{har-tool-fixture,tool-client-replay,provider-model-matrix,management-api}.test.mjs` | `spawnSync('node', …)` captures the child's stdout through a pipe |

Both hit the same boundary: a confined process cannot open a named pipe. (`node --test` spawns one
child per test file, so in a spawn-blocking sandbox the *whole* command fails regardless of content;
running a single file as `node tests/…/<file>.test.ts` works for every dependency-free test, just
not for the esbuild ones.) Counting these as regressions costs real time - re-run the same command in
a normal environment before touching source. Before attributing a red to your own change, check
whether the failing file mentions `esbuild` or `child_process` at all, and whether the file it reads
is one you edited: this checkout carries a large body of uncommitted work, so a red in
`tests/api/parameter-policy.test.ts` (which asserts on strings inside
`src/main/proxy/forwarder.ts`) or a `tsconfig.node.json` error coming
from `src/main/index.ts` can be somebody else's pending edit rather than your regression.

Two further `tests/skills/` cases fail on a Windows checkout for environmental reasons independent
of the above (a child process spawned with a macOS-style `/private/tmp` fixture path, and a `\n`-only
regex against CRLF files).

Packaging constraints worth knowing before a release: macOS produces **dmg only** (no zip), which
breaks `electron-updater` on macOS; no build is code-signed and macOS is not notarized; the
`build.publish` block decides where `--publish=always` uploads and which repo the packaged
auto-update feed points at, so it must match the repository you are releasing from.

The packaged asar ships **no `node_modules`** (`build.files` excludes the directory), so every
main-process runtime dependency must be bundled by rollup - an external dependency is a startup
crash, not a size saving. 1.4.5 externalized `electron-store` and left every install at
`Storage not initialized, please call initialize() first`; `tests/build/main-bundle-deps.test.ts`
keeps it bundled, and `store.ts` loads it inside `initialize()`'s try so a future packaging mistake
surfaces as a real error instead of that generic message.

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts            # App entry point
│   ├── ipc/                # IPC handlers (main ↔ renderer communication)
│   ├── proxy/              # Proxy server (Koa)
│   │   ├── server.ts       # HTTP server, API-key middleware, `proxyServer` singleton
│   │   ├── forwarder.ts    # Request forwarding; dispatch via the `providerForwarders` registry
│   │   ├── loadbalancer.ts # Account selection (round-robin / fill-first / failover)
│   │   ├── modelMapper.ts  # Model -> actual model / preferred provider / preferred account
│   │   ├── adapters/       # Provider-specific adapters (+ stream handlers)
│   │   ├── routes/         # chat.ts, completions.ts, models.ts
│   │   │   └── management/ # /v1/management/* HTTP API
│   │   ├── middleware/     # managementAuth
│   │   └── services/       # contextManagementService (history trimming)
│   ├── oauth/              # OAuth authentication
│   │   ├── manager.ts      # OAuth flow orchestration
│   │   ├── inAppLogin.ts   # In-app browser login with token auto-extraction
│   │   └── adapters/       # Provider-specific OAuth adapters
│   ├── channelPack/         # Vendor channel-pack host: worker.ts + compat shims + bridge.ts
│   ├── providers/          # Provider configurations
│   │   ├── builtin/        # Built-in provider configs (one file per provider)
│   │   ├── aggregate/      # Aggregate catalogue (registry data + manager)
│   │   ├── accountChannels/ # Thirteen login channels: catalogue, vault, manager, runtimeState
│   │   └── custom.ts       # Custom provider support
│   ├── store/              # Persistent storage (electron-store)
│   │   ├── store.ts        # Main store manager with IPC bridge
│   │   ├── types.ts        # Type definitions and default values
│   │   └── config.ts       # Configuration management
│   └── tray/               # System tray integration
├── preload/                # Context bridge (IPC API exposure)
├── renderer/               # React frontend
│   ├── components/         # UI components
│   ├── pages/              # Page components
│   ├── stores/             # Zustand state management
│   └── i18n/               # Internationalization (en-US, zh-CN)
└── shared/                 # Shared types between main and renderer
```

## Key Concepts

### Provider Adapters
Each AI provider has a dedicated adapter in `src/main/proxy/adapters/` that handles:
- Message format conversion (OpenAI format → provider-specific format)
- Authentication header construction
- Stream response parsing
- Multi-turn conversation context

Adapters share no interface: each `chatCompletion()` returns a different shape
(`{response, sessionId}`, `{response, conversationId}`, `{stream, sessionId}`, ...) and session
teardown is variously named `deleteSession` / `deleteConversation` / `deleteChat`. The forwarder
only needs `is<Provider>Provider(provider)` plus the call signature it handles.

To add a new provider:
1. Create config in `src/main/providers/builtin/<provider>.ts`
2. Register it in `src/main/providers/builtin/index.ts` (both `builtinProviders` and `builtinProviderMap`)
3. Create OAuth adapter in `src/main/oauth/adapters/<provider>.ts` and register it in that folder's `index.ts` (two switches)
4. Create proxy adapter in `src/main/proxy/adapters/<provider>.ts`; keep its stream handler class in the
   same file (no provider keeps a separate `-stream.ts` any more) and export it from `adapters/index.ts`
5. Add one entry to the `providerForwarders` array in `src/main/proxy/forwarder.ts`
6. Add the UI icon mapping and i18n entries

`src/main/store/types.ts` needs no edit: it re-exports `builtinProviders` as `BUILTIN_PROVIDERS`.

### Online Model List Update
One model-list source exists after the web-provider retirement and the OpenCode runtime
retirement: `src/main/providers/modelListSource.ts` answers `http` for a builtin that declares
`modelsFetch`, and `unsupported` for everything else. The `runtime` branch is gone with the
flag it keyed on (`runtimeModels`).

- `http` - a builtin that declares `modelsFetch` (`url`, optional `method`/`body`, `reader`,
  `auth`, extra `headers`). `src/main/providers/modelCatalog.ts` makes the request;
  `modelListReaders.ts` turns the payload into `{ displayName, actualModelId }` pairs.
- `unsupported` - everything else. Startup writes `supportsModelFetch` from this, so a provider
  with neither source shows "does not support dynamic model updates".

Two readers exist, tried in this order under `reader: 'auto'`: `openai-list`
(`data: [{id, name?}]`, also `{models: [...]}`-shaped payloads that carry `id`) and
`openai-free-list` (the same payload filtered to `isFree === true`, used for the Kilo free pool;
a catalogue with no free model reports `empty`, never a paid model). An unrecognised payload
reports `unrecognized_shape` instead of returning an empty list, so an upstream change never
looks like "this provider has no models".

The `auth` rule list (`{ from, into: 'header', header, prefix }`, `{ from, into: 'cookie', cookie }`,
`{ from: 'cookies', into: 'cookie-map' }`) is unchanged and unused by any shipped provider: no
builtin declares `modelsFetch` now. `{uuid}` placeholders in the url/body are still substituted
with a fresh `crypto.randomUUID()` per call for any future declaration.

Aggregate providers do not use `modelsFetch`; their sync path lives in
`providers/aggregate/manager.ts`. `syncModels(id)` probes the catalogue's `modelsUrl`, or
`<baseUrl>/models` when the catalogue declares none, with every stored key in turn, then **merges**
the upstream ids into the provider's namespaced model list (see "Aggregate Provider Catalogue").

**models.dev is a fallback, and the upstream answer is tri-state.** When the probe fails
(`no_model_list`, `invalid_api_key`, `http_status`, `network_error`) `syncModels` retries the
**models.dev** catalogue (`https://models.dev/api.json`, read by `src/shared/modelsDev.ts`) under the
same entry id, and the result carries `modelSource: 'models.dev'` so the UI can say the list may lag
upstream. The decision lives in `planSyncModelIds()` and is unit-tested, because the easy mistake is
treating "upstream answered zero models" as "unavailable":

- `null` (probe failed) - **only** this unlocks the models.dev fallback;
- `[]` (probe succeeded, zero models) - the upstream's own answer; it must never be replaced by a
  third-party list, or a request is sent to a model the vendor does not serve;
- `[...]` - upstream wins outright, even when models.dev lists more, so a curated registry list is
  never widened behind the user's back.

The reader is deliberately narrow: it takes only `id` + `name`, drops every non-chat `type`
(`embedding` / `reranking` / `transcription` / `image` / `video` / `speech`), and never reads
`cost` / `limit` / `tool_call` from models.dev - those belong to `aggregateQuota.ts` and
`modelCapabilities.ts`, and copying them here would create a second source of truth.


Fetched models are stored in `userModelOverrides[providerId].fetchedModels` (+ `fetchedAt`), **not** in
`provider.supportedModels` - the startup sync rewrites that field from code. They merge into
`getEffectiveModels()` as `source: 'fetched'`, after built-in and user-added entries, skipping names
that already exist or are excluded, and `providers:resetModels` clears them along with the rest of the
overrides.

The action is the single `providers:updateModels` channel. The card menu renders it for a builtin whose
record carries `supportsModelFetch`, and for every `type: 'aggregate'` record; an aggregate id is
routed to `aggregateProviderManager.syncModels` instead of the builtin `modelsFetch` path. Failures
return a typed `reason` (`unsupported`, `no_active_account`, `http_status`, `empty`,
`unrecognized_shape`, `network_error`, plus aggregate-only `invalid_api_key`), each with its own
message in the UI.

### Aggregate Provider Catalogue

`src/main/providers/aggregate/registry.ts` is data transcribed from the reference registry:
92 entries / 580 models. Beyond dropping `openai` and `github_copilot` (browser-login account
channels - the class that was retired) and `fleetrelay_t1` (responses-only relay), seven model rows
were removed on 2026-10-29 because upstream no longer serves them (3 anthropic ids the API answers
with an error, 4 xai ids retired 2026-05-15 whose slugs still resolve and silently redirect), and
`mistral_codestral` was withdrawn as a whole because its host is absent from Mistral's published
docs while `codestral-latest` is already covered by `mistral`. `agnes` was switched on the same day
to the vendor's China host (`https://api.agnes-ai.cn/v1`) with `agnes-3.0-flash` / `agnes-2.5-flash`
in place of the deprecated `agnes-2.0-flash` (`agnes-3.0-pro` is still 即将上线). `qiniu` was added
for the Conatus campaign (model `qiniu/conatus-free`, 1亿 tokens/day for verified accounts to
2026-11-30); its receipt carries `tpd`/`contextWindow`, and the entry must be withdrawn when the
campaign ends because the vendor stops serving the model entirely. `sensenova` was added for the
Token Plan public beta; its schema rejects fields the official table does not list, so the entry
declares `dropParams` (`response_format`, `enable_thinking`, `tool_choice=auto`,
`tools[].function.strict`).
`tests/aggregate/registry.test.ts` pins that list so a re-transcription cannot resurrect them.
`openai_api` stays and is served over the chat wire. `vertex` / `vertex-partner` are listed with
`authKind: 'unsupported'` because Google ADC cannot be produced here.

Ten domestic entries were added on 2026-11-03: Baichuan
(`https://api.baichuan-ai.com/v1`), Alibaba Cloud Bailian pay-as-you-go
(`https://dashscope.aliyuncs.com/compatible-mode/v1`) and Token Plan
(`https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`), SiliconFlow China
(`https://api.siliconflow.cn/v1`), iFlytek Spark (`https://spark-api-open.xf-yun.com/v1`), StepFun
pay-as-you-go (`https://api.stepfun.com/v1`) and Step Plan
(`https://api.stepfun.com/step_plan/v1`), Volcengine Ark platform
(`https://ark.cn-beijing.volces.com/api/v3`) and Agent Plan
(`https://ark.cn-beijing.volces.com/api/plan/v3`), and Yi
(`https://api.lingyiwanwu.com/v1`). A vendor's pay-as-you-go endpoint and each subscription endpoint
**must stay separate entries**: the vendors isolate the API key and base URL per billing channel, so
sharing an entry either returns 401/403 or silently bills the payg account. The existing
`volcengine-ark` entry is the Coding Plan (`/api/coding/v3`); its model list was refreshed on the
same day (GLM-5.1 left upstream on 2026-06-30). All four subscription entries
(`bailian_token_plan`, `stepfun_step_plan`, `volcengine-ark`, `volcengine_ark_agent_plan`) are in
`AGGREGATE_PLAN_ENTRIES`, so their zero marginal price reads as `included`, never `free`.

- `manager.ts` only writes a provider record when the user saves one, so the provider list never
  carries 70+ unusable rows. The record is `type: 'aggregate'`, `id` = registry id, and carries
  `wire`, `authHeader`/`authPrefix`, `aggregateId`, `supportedModels`, `modelMappings`.
  `initializeDefaultProviders()` only repairs `type === 'builtin'` records, so aggregate records
  survive a restart.
- Accounts: a keyed entry stores **one account per key** (the config dialog takes one key per line);
  the load balancer round-robins the entry's requests over them, so a rate-limited key falls through
  to the next. A key-less entry (`kilo`, `ollama`, `lmstudio`, `llamacpp`) gets a credential-less
  active account so the load balancer can route it.
- Display names are `<providerId>/<modelId>`. `save()` writes `provider.modelMappings`
  (displayName -> upstream id), which is what the load balancer translates through; the name is
  pinned to that entry by its `<providerId>/` prefix (`modelServing::derivePreferredProvider`), so
  the global `config.modelMappings` table stays user data (aliases, pins, stopped names). Removing
  the provider drops any row pinned to it the next time the config is read.
- Wires: `openai-chat` reuses the forwarder's default branch (86 entries).
  `anthropic-messages` (`anthropic`, `glm`'s `/api/anthropic`, `minimax-cn`) uses
  `proxy/adapters/anthropic.ts`, which converts messages/system/tool_use blocks and re-emits the
  SSE stream as OpenAI chunks with `skipTransform`.
- `openai-responses` is **outbound only** (`wire: 'openai-responses'`, path `/responses`), for
  endpoints that expose nothing but the Responses API. `forwarder.forwardResponsesWire()` takes the
  request over from the default branch *before* any chat body is built, because the two differ in
  three ways:
  - no prompt-based tool injection - Responses has native tools, and layering the managed prompt
    on top would double the tool description;
  - the body is rebuilt by `chatToResponsesRequest()` rather than copied field by field;
  - the stream is translated per event, not buffered to the end, so time-to-first-byte stays equal
    to the upstream's first delta.

  `src/shared/responsesWire.ts` holds all of it as pure functions (`chatToResponsesRequest`,
  `responsesBodyToChat`, `responsesEventToChatChunks`) so the translation is testable without
  network. Four rules are load-bearing and each has a test in `tests/shared/responses-wire.test.ts`:
  - `usage` is `null` when upstream did not report it - never zero-filled;
  - exactly one `[DONE]`, emitted once even if upstream closes without `response.completed`;
  - `response.failed` / `error` becomes a `{"error": ...}` frame, never assistant text;
  - `refusal` and `function_call` output items never leak into `message.content`.

  There is **no inbound `/v1/responses` route** in this bullet's scope: the bullet above is about
  *outbound* wires. The client-facing endpoint is a separate surface - see *Inbound Protocols*.
- Auth header: `Authorization: Bearer` by default, `x-api-key` for the anthropic wire, `api-key`
  for `azure_openai`; `forwarder.buildHeaders()` reads `provider.authHeader`/`authPrefix`.
- A baseUrl containing `{placeholders}` is never expanded: the user has to override it. `test`
  probes the list endpoint for connectivity; `syncModels` merges what it answers into the exposed
  list (only adds, never removes, so curated lists and per-model parameters survive). `kilo`
  uses the `openai-free-list` reader, so only `isFree: true` models are exposed.
- Parametpolicy passes every parameter through for any `type !== 'builtin'` provider, so aggregate
  requests are never silently stripped.

### Inbound Protocols

The internal canonical shape is OpenAI chat. Two client-facing endpoints speak a different protocol
and reach it the same way: translate the request, then loop it back over local HTTP to
`/v1/chat/completions`. Routing, failover, account pools, quota metering, context compression,
request logs and tool-violation detection therefore stay one implementation - re-implementing them
per protocol is how two behaviors appear and later fork (the reason stated in `routes/messages.ts`).

- `POST /v1/messages`, plus `POST /v1/messages/count_tokens` (local estimate, never forwarded).
  Codec: `src/shared/anthropicWire.ts`. Because a refusal has to be readable by an anthropic client,
  the auth middleware chooses the error envelope by path (`server.ts`). Claude Code only ever sends
  `claude-*` names, so this entry resolves the model through `anthropicInbound.modelMap` /
  `defaultModel` (four ordered sources in `resolveAnthropicModel`) and publishes what actually ran in
  `X-ModelPort-Anthropic-Resolved`, because echoing the client's own name is necessary but not
  honest on its own.
- `POST /v1/responses`. Codec: `src/shared/responsesInbound.ts` (`responsesToChatRequest`,
  `chatResponseToResponseBody`, `createResponsesStreamTranslator`). No model-name fallback here: a
  Codex-family client lets the user set the name, so an unknown name keeps chat's
  `503 no_available_account` instead of silently running a substitute model. Parameters that require
  the gateway to remember an earlier turn - `previous_response_id`, `conversation`,
  `background: true`, `input[].item_reference` - are refused `400 unsupported_parameter` naming the
  parameter, and the refusal is written to the request log (a refusal that reaches no provider is
  otherwise invisible on the dashboard). `store: true` is accepted but answered with
  `X-ModelPort-Responses-Store: not-retained`. A Responses stream ends in exactly one
  `response.completed` / `response.incomplete` / `response.failed` and never carries `[DONE]`;
  `usage` stays `null` until upstream reports it, so unlike the anthropic stream there is no
  required-but-unavailable token cell to estimate and no `X-ModelPort-Usage-Estimated` header.

The protocol-neutral half of the loopback (target host, credential forwarding, the caller's
`User-Agent`, SSE headers, upstream error text, inner `X-Request-Id` adoption, `X-ModelPort-*`
passthrough) lives in `proxy/utils/inboundLoopback.ts` - shared by both entries precisely because a
second copy drifts. Forwarding `User-Agent` is not cosmetic: the request log's `client` and the
`X-ModelPort-Client` response header are classified from the UA alone
(`shared/clientProfile.ts`), so an entry that drops it reports every caller as the proxy's own
fetch client (`node`), which is exactly the lead an operator needs when a harness misbehaves. The UA
goes through `toHeaderValue` like every other dynamic header value.

**Freeform (`custom`) tools are a separate contract from functions, and both halves are
load-bearing.** Codex declares `apply_patch` as `{type: 'custom', format: …}` - its argument is raw
text, not a JSON object - and its call/result items are `custom_tool_call` / `custom_tool_call_output`.
Chat has exactly one place to express an argument contract (`tools[].function.parameters`), so the
inbound folds a freeform tool into a single required string `input` (`freeformToolNamesOf` +
`FREEFORM_INPUT_PARAMETERS`), and the outbound must return the call as a `custom_tool_call` item whose
`input` is that raw text, because the client dispatches on the item's `type` and does not execute a
`function_call` for a tool it declared custom. Measured 2026-11-03 on a 1568-line Codex session: 304
calls - 298 `exec_command`, each with a result, and 6 `apply_patch`, **none** with a result, 4 of them
with `arguments: {}`. Because the history projection recognized only `function_call`, the patch text
never reached the model again (the next four turns' request bodies contain no `Begin Patch`), so the
agent re-declared "我现在直接落盘" turn after turn against a clean working tree - the "says it is done,
nothing changed" report. Hosted tools (`web_search`) are not freeform and get no invented schema. In
streaming mode the freeform `input` is delivered once, in `response.custom_tool_call_input.done`:
forwarding partial JSON as `arguments.delta` would corrupt the patch.

One parameter is carried in both directions under the same name: `prompt_cache_key`. Inbound
translates it onto the chat request, `buildRequestBody` passes it to the upstream (it is in the
undeclared-field list next to `response_format` / `stream_options` / `seed`), and the outbound
responses wire folds it back in - dropping it is silent, and all the operator sees is a slower
upstream.

**One assistant message per batch of parallel calls.** Responses' `input` is one `function_call` item
per call, and the chat lane (and every Anthropic-shaped upstream behind the channel pack) requires the
whole batch on a single assistant message with the results immediately after it. Projecting each item
into its own assistant message produced `assistant(A) / assistant(B) / tool(A) / tool(B)`; MiniMax
rejected exactly that on 2026-11-12 16:39 (`invalid params, tool call result does not follow tool call
(2013)`) and the route's other 31 candidates were never tried. `pushToolCall` in the inbound codec now
merges consecutive call items into the batch's assistant, appends a reasoning item to that same
message rather than inserting a standalone assistant, and closes the batch as soon as a result (or any
text/user message) arrives. The predicate `isToolCallOrderingError` keeps a still-bad legacy history
from ending the chain on its first candidate; it is a capability mismatch, never an account fault.

Tests split by layer: `tests/shared/anthropic-wire.test.ts` and
`tests/shared/responses-inbound.test.ts` for the codecs, `tests/routes/anthropic-inbound.test.ts`
and `tests/routes/responses-inbound.test.ts` for the entries end to end (real `ProxyServer` looping
back into real `routes/chat.ts`, with a `node:http` stand-in upstream).

### Load Balance Strategies

`LoadBalanceStrategy` is `round-robin | fill-first | failover | smart | pace`. The first three use
pool order and failure history only. The last two are driven by the quota ledger
(`src/main/proxy/quota/ledger.ts` + the pure logic in `src/shared/quotaPacing.ts`):

- **`smart`** picks the candidate whose quota window **resets soonest**, so allowance that is about
  to roll over gets used instead of wasted;
- **`pace`** picks the candidate with the most **remaining allowance per hour** until its window
  closes.

Three rules, all encoded in `tests/shared/quota-pacing.test.ts`:

1. **Reset time is derived, never stored.** The ledger keeps usage only; `quotaPacing` recomputes the
   boundary from the window definition (rolling minute / rolling 24h aligned to whole windows, UTC
   calendar month). `quota-ledger.json` keeps its current format.
2. **No derivable reset means no opinion.** A candidate whose provider has no enforceable cap, or
   whose ledger read failed, does not participate; `selectByQuotaPacing()` returns `null` and
   `selectAccount()` falls back to `fill-first` order. Never a forced pick, never a dropped
   candidate - "cannot compute" is not "cannot serve".
3. **An exhausted candidate is a last resort.** `pickBestPace` skips candidates with zero remaining
   when any usable one exists; `pickSoonestReset` ranks full candidates after every candidate that
   still has allowance, even when the full one resets sooner.

`auto` has its own scoring profile per strategy (`AutoRoutingStrategy` mirrors the same five values).
Its `smart`/`pace` branches cannot see reset times - scoring runs before selection - so they only
raise the weight of `headroom` and `quota`; the actual reset-aware step happens later in
`loadbalancer`.

The union is declared **twice** (`src/shared/types.ts` and `src/main/store/types.ts`) with no type
wiring between them, and the UI carries two hard-coded maps plus the selector list.
`tests/shared/load-balance-strategies.test.ts` pins all five values across the two unions, the auto
enum, the selector, both label maps and both locales, because missing one produces a strategy that
silently cannot be selected or renders as `undefined`.

### Aggregate Free-Quota Layer

The free-tier caps of the aggregate catalogue live in a generated sidecar,
`src/shared/aggregateQuota.ts` (`entryId -> { rpm, rpd, tpm, tpd, monthlyTokens, contextWindow,
source, perModel, docUrl, asOf, officialNote }`). It is produced by
`scripts/build-aggregate-quota.mjs` from the evidence receipts in
`docs/data/free-quota-research/*.json`; edit the receipts, then re-run the script - never hand-edit
the output. Each receipt row must carry a verbatim quote and a `docUrl`, and the generator flips
`source` to `documented` **only** when at least one number is present (a page that was found but
publishes nothing is `undocumented`). Receipts may set `withdrawn: true` to keep the evidence for an
entry that left the catalogue.

Current coverage: 16 of 89 entries have at least one documented number; the rest are `undocumented`.
Two rules follow from that and are easy to break:

- **`undocumented` never blocks a candidate.** "No published cap" is not "no quota": the gate
  (`proxy/quota/gate.ts`) and `limits.resolveCaps()` only enforce when a real cap exists, otherwise
  the entry routes as before. 73 of 89 entries depend on this.
- **A cap that is not in tokens is never converted.** `officialNote` carries the vendor's own unit
  and conditions (Cloudflare's Neurons/day, kilo's requests/hour/IP, concurrency limits, monthly USD
  spend, minimum-purchase thresholds). The panel displays it verbatim; it takes no part in
  enforcement.

Runtime accounting and enforcement:

- `proxy/quota/ledger.ts` keeps per `(providerId, accountId, modelId)` counters in
  `quota-ledger.json` (debounced write, temp-file rename, corrupt file set aside). Windows are
  **rolling** last-minute / last-24h plus a **UTC calendar month** - intentionally not the vendor's
  calendar day, so an exhausted window is detected earlier rather than later.
- `proxy/quota/observations.ts` learns caps from what the user's own traffic already returned:
  `x-ratelimit-limit-*` headers and `limit: N` plus an axis keyword in a 429 body. Learning is
  fill-or-lower only, never raise, and an unparsable axis is not guessed. This is the only channel
  through which `undocumented` entries ever gain a number.
- `proxy/quota/limits.ts` merges entry caps, per-model caps and learned caps (each only lowers) and
  reports which window is full; `monthlyTokens` > `rpd`/`tpd` > `rpm`/`tpm` in reporting order.
- `routes/chat.ts` meters every success exit (non-stream body, both stream branches) and feeds the
  learner from every response. Usage the upstream did not report is estimated for the ledger only -
  it is never written into the client's response body, which stays `usage: null`.

**The estimate has two rules that used to be violated in both directions at once**
(`proxy/quota/usage.ts`, pinned by `tests/proxy/quota-usage.test.ts` and fenced by
`tests/proxy/quota-metering.test.ts`):

- **`sseDeltaText()` strips the SSE framing before estimating output.** Feeding the raw collected
  stream to `chars/4` counts every frame envelope as model text — ~150-260 characters per emitted
  token, i.e. output inflated 40-65x. Measured on this machine after the fix: raccoon's
  ledger average fell **4.7x** (48,695 → 10,345 tokens/request) and loomy's 1.5x on identical
  traffic, the difference being exactly the frame bytes. Do not read this as "every provider number
  was 40x wrong": TRAE's 503,769 estimated tokens/request happened to sit within 0.1% of TRAE's own
  reported 503,128 - the estimate was inflated there too, but its requests were near-empty of deltas,
  so the two errors cancelled. An estimate is only trustworthy per provider, which is why the
  upstream/estimated pools stay separate. Text with no `data:` lines passes through unchanged (the
  non-stream path hands in plain content; returning `''` for it would erase real output). SSE with no
  deltas at all estimates 0, because frame bytes are not the model's answer. Tool-call
  `name`/`arguments` count as output.
- **`usageInputText()` counts `messages` + `system` + `tools`.** The old
  `JSON.stringify(request.messages ?? [])` omitted tool schemas, which for agent clients are
  usually the largest part of the request - so input was underestimated while output was
  overestimated, and the number that decides "is prefix replay worth fixing" was wrong in the
  flattering direction.
- **`cacheReadTokens` is an upstream-reported subset of input, and is absent, never 0, when the
  upstream did not report it.** `0` is a claim ("nothing was cached"); absence is the fact ("this
  path does not tell us"). The day counter stores `upstreamCacheRead` and the dashboard row renders
  only above zero, so a channel that reports nothing cannot be read as "caching failed". Caps are
  deliberately **unchanged**: `ledger.record()` still subtracts `totalTokens`, because whether a
  cache read also consumes the vendor's own allowance is unevidenced, and crediting it as free would
  make `smart`/`pace` believe a fuller window than we can prove.
- `normalizeDayBucket()` derives its field list from `emptyBucket()` (loop, not transcription), and
  `accumulateDayBucket()` runs its persisted input through it. Both exist because buckets come off
  the disk: an older `data.json` predating any added field would otherwise make `base.field + x`
  `NaN` and poison the whole day.

**Inside the pack, `TokenUsage.inputTokens` means "input *excluding* cache reads."** The gateway adds
`cacheReadTokens`/`cacheWriteTokens` back (`openai-gateway/usage.ts::toOpenAiUsage`) - that convention
is what the documented 2026-10-04 Codex under-count fix rests on. So an adapter that starts reporting a
cache field must know which convention that field carries, and `vendor/channel-pack/src/usage-cache.ts`
is the single place that decides, **by field name rather than by provider** (a provider can change
gateway without changing its name): `prompt_tokens_details.cached_tokens` and
`prompt_cache_hit_tokens` are **subsets** of `prompt_tokens` → subtract; `cache_read_input_tokens`
(Anthropic) is **parallel** to `input_tokens` → never subtract. Reversing it either double-counts the
cache (inflated context, the client compacts too early) or double-deducts it (reported context pinned
near zero, auto-compaction never fires). Pinned by `tests/channels/usage-cache.test.ts`, including
"absent stays absent" and the `cached > prompt` clamp. TRAE previously read only three usage keys, so
its cache-read total of 0 on this machine is *either* "TRAE does not cache" *or* "TRAE reports it and
we never looked" - indistinguishable until this landed.

Bare model names across entries:

- A request for `glm-5.2` (no `<entry>/` prefix) is expanded by
  `shared/aggregateRouting.ts` into an ordered chain over every entry serving that exact id, ordered
  by headroom, and `loadbalancer.selectChainCandidates()` turns it into candidates. A prefixed name
  (`glm/glm-5.2`) is a pinned choice and is never expanded; `preferredAccountId` is likewise a hard
  pin.
- `forwarder.forwardChainCompletion()` and `forwardAutoCompletion()` share one loop
  (`forwardFirstReachable`), so both fail over on 429/5xx/no-status and stop on other 4xx. When the
  chain is used, `routes/chat.ts` adopts the account that actually answered and sets
  `X-ModelPort-Aggregate-Chain` to its entry id - observability without log-reading.

The aggregate page renders one quota cell per entry with five mutually exclusive states
(`needs-key`, `exhausted`, `documented`, `undocumented`, `absent`) plus a separate free-pool badge;
the numbers always carry their window, and "exhausted" means the documented cap against **this
app's** metering, not a live balance. The two are separate rows on purpose - see the live-credit layer below.

**Live account credit exists, but it is a gate, never a number.** Two catalogue entries declare an account-level
credit endpoint through `AggregateEntry.quotaProbe` (`open_router` → `/key`, `siliconflow` → `/user/info`); the
path is resolved against the **provider record's own `apiEndpoint`** and authenticated through
`buildProbeHeaders`, so the query follows the same host and key that chat traffic already uses instead of
inventing a second credential path. Nothing is polled and opening the page never asks: the aggregate detail
panel sends exactly one GET per stored key per click, capped at `CREDIT_QUERY_KEY_CAP` with the un-queried
remainder stated out loud. The single authority for "does this affect routing" is
`shared/aggregateCredit.ts::creditSnapshotExhausted` - the row must be complete, explicitly not `unlimited`,
carry an actual number, be `<= 0`, and be inside `CREDIT_SNAPSHOT_TTL_MS` (15 min, because a hand-clicked
reading must not steer routing for a day). A hit folds `aggregateHeadroom` to the existing `-1` and adds the
`'no-credit'` reason; everything else returns the token-window computation untouched. USD credit, CNY balance
and this app's token ledger are three incomparable count domains, so `QuotaBlockReason` is split into
`QuotaWindowBlockReason | 'no-credit'` and the metric/reason tables only cover the window half - turning a
balance into a token ratio is not just discouraged, it does not typecheck. A response whose field names are not
recognised is reported as `unexpected-shape` in the UI rather than guessed into a number: both endpoint shapes
came from a transcribed record, not from a captured payload, so the first real click is what confirms them.

### Aggregate Per-Model Cost Classification

Quota answers "how much may I send"; cost answers "does this model cost extra". Separate sidecars,
because the sources differ in kind:

- `src/shared/aggregateQuota.ts` - **vendor-official** caps, every number with `docUrl` + `asOf`.
- `src/shared/aggregatePricing.ts` - **third-party** prices (`models.dev`, USD / 1M tokens) **and**
  the vendor-official free list. Generated by `scripts/build-aggregate-pricing.mjs` from
  `docs/data/models-dev-cost.json`; refresh the snapshot with `--payload <api.json>`, then re-run.
- `src/shared/aggregateCapabilities.ts` - **third-party capabilities** (`tools` / `reasoning` /
  input modalities / context window), generated by `scripts/build-aggregate-capabilities.mjs` from
  `docs/data/models-dev-capabilities.json`. Same exact-`baseUrl` alignment and the same
  skip-on-ambiguity rule as the pricing sidecar; only `tool_call: true` / `reasoning: true` count as
  evidence, because a community `false` usually means "unfilled" and treating it as "no" would
  silently over-filter. It is the lowest capability layer, so it never overrides anything above it.
  Never hand-edit any of these sidecars.

`src/shared/aggregateCost.ts` is the single classifier (`aggregateCostOf`); consumers read
`AggregateModelInfo.cost` rather than inspecting prices. Four classes, in evidence order:

| class | evidence | meaning |
|-------|----------|---------|
| `free` | `official` > `catalogue` > `third-party` | no extra cash outlay |
| `included` | `plan` | allowance already inside a subscription |
| `priced` | `third-party` | metered by token |
| `unknown` | `none` | nothing known - neither free nor paid |

Four rules are load-bearing, each pinned by `tests/aggregate/aggregate-cost.test.ts`:

1. **A zero price is not "free".** Subscription endpoints (`AGGREGATE_PLAN_ENTRIES`: `kimi_code`,
   `zai`, `glm-cn`, `qwencloud`, `qwencloud_coding`, `bailian_token_plan`, `xiaomi-tokenplan`,
   `sensenova`, `stepfun_step_plan`, `volcengine-ark`, `volcengine_ark_agent_plan`) show a zero
   *marginal* price on models.dev because the allowance was bought up front; calling that "free"
   says a user can run without paying when the plan allowance simply ends. The list is hand-written
   with a per-entry reason - **do not** regex on "plan" in the id: `sensenova`'s host is
   `token.sensenova.cn` (no "plan" substring), while `zai_api` is the same vendor's *metered*
   endpoint (`api.z.ai/api/paas/v4`) and keeps its real prices.
2. **Alignment is by exact `baseUrl` only** (host + path, trailing slash ignored). Brand names and
   bare hosts collide: `zai` (coding-plan, zero) and `zai_api` (pay-as-you-go, metered) serve the
   same ids at contradictory prices. A `baseUrl` matching more than one models.dev provider is
   skipped, never guessed.
3. **USD is never folded into a multiplier.** A multiplier is *relative*; a price is absolute.
   Converting needs a base this repo does not have, so `costBucketOfAggregateClass` answers only
   "does it cost extra": `free`/`included` -> `free`, `priced` -> `above-base`, `unknown` ->
   `unknown` (neutral). No ordering, no price comparison.
4. **Unknown is a real answer.** An unmarked, unpriced model stays `unknown`, never folded into the
   free bucket. `aggregateCostCounts` keeps four separate counts so the panel shows "N free / N in
   plan / N metered / N unlabelled" instead of a misleading free/paid split.

`auto` routing reads this through `costBucketFor` in `autoRouter.ts`, replacing the old
`freeModelsHint`-only branch that sent all 91 priced rows and every subscription endpoint to
`unknown` (which left `cheap` preference unable to avoid paid models). The panel renders one badge
per row plus a cost filter, and the free badge carries its evidence in the label ("Free
(vendor-declared)" / "Free (catalogue)" / "Free (third-party price)") because only the first is a
vendor claim.

`AGGREGATE_OFFICIAL_FREE` reuses the `freeModelIds` the quota receipts were already collecting but
the quota generator discarded; it keeps only ids the catalogue ships, since claiming a free model we
cannot route to advertises something that never answers.

### Account Channels

Thirteen login channels - `lobsterai`, `qoder`, `qodercn`, `trae`, `cline`, `loomy`,
`raccoon`, `minimax`, `zcode`, `gemini`, `workbuddy`, `buddy`, `opencode` - are not HTTP endpoints
either. Twelve prove ownership through a browser / device-code / OAuth flow; `opencode` is the
exception (`loginKind: 'api-key'`): the pack adds an anonymous slot or a pasted `sk-` key and opens
no browser, so `account.create` has no branch for it and the host must call `opencode.addAccount` /
`opencode.addAnonymous` instead. Three consequences follow, and each has a gate:

- the add-account UI branches on `channelAddFlowOf(loginKind)` (`shared/channels.ts`): `redirect`
  runs the browser flow + `login.poll`, `credential` opens a local form that posts the method names
  the catalogue declares in `credentialAdd` - so a new `api-key` channel is data, not a UI fork;
- the host must resync itself after those methods (`accountChannels/rpcSync.ts`,
  `resyncsAfterChannelRpc` + `notifyChanged()`), because the pack **does not** broadcast `changed`
  for `opencode.addAccount` / `opencode.addAnonymous` - skip it and the slot lands in the pool while
  the provider record never appears, leaving the card stuck at "not configured" behind a "success"
  toast;
- the two gates live in `tests/channels/rpc-resync.test.ts` and `tests/channels/catalogue.test.ts`
  (method-name ownership, flow mapping, locale parity, and the wiring itself).

Each one is a DSH
"channel pack" provider that owns its own login flow, account pool, daily credit claim and model
gating. The upstream implementation is **vendored as source**, not as a bundle:

- `vendor/channel-pack/src/` is the upstream tree (149 upstream TS files plus the local
  `qoder-plan-gate.ts`, `qoder-session.ts`, `queue-wait.ts` and the WorkBuddy family: `buddy.ts`,
  `buddy-auth.ts`, `buddy-oauth.ts`,
  `buddy-adapter.ts`, `buddy-balance-*.ts`, `product.ts`, `openai-gateway/tencent-fingerprint.ts`).
  `qoder-session.ts` and `queue-wait.ts` are deliberately **import-free** so their rules can be
  unit-tested by `import()`ing the source directly - vendor files carrying TS parameter properties
  (`qoder-wasm.ts`) cannot be, and need the esbuild path.
- Both buddy products resolve an account through `BuddyBalanceSelector` (`buddy-balance-rank.ts`
  supplies the 15-day expiring/permanent split). A product with `permanentLocked` and no expiring
  credits throws instead of falling back to pool order: the fallback would burn permanent credits
  and make the lock meaningless. Free models skip the balance query entirely, since they cost 0.
- `src/main/channelPack/compat/` holds the shims for the private packages the upstream imports
  (`virtual:*`, `@deepseek-ai/*`, `undici`, `image-pricing`). They are only reachable through
  esbuild aliases; `src/main/types/channelPack.d.ts` declares the virtual modules so `tsc` never
  walks into the vendor tree.
- `scripts/build-channel-pack.mjs` bundles `src/main/channelPack/worker.ts` into
  `resources/channel-pack/worker.mjs` (gitignored; the `.wasm` / `LICENSE` / `NOTICE.md` next to it
  are vendored and tracked). `npm run build` and both dev scripts run it first.
- The worker **cannot live inside the asar**: `package.json` copies `resources/channel-pack` to
  `extraResources`, and `bridge.ts` resolves it from `process.resourcesPath` when packaged
  (`resources/channel-pack` in dev).
- Two env vars are mandatory at spawn. `DSH_CHANNEL_PACK_STATE_DIR=<dataDir>` (the pack appends
  its own `channel-pack/` subdirectory, so state lands next to our `credentials.json`); without it
  the pack writes its accounts into the user's real `~/.dsh`; and
  `DSH_OPENAI_GATEWAY_ENABLED=0`, otherwise the pack mounts its own fixed-port (8326) OpenAI
  gateway and the second instance dies with `EADDRINUSE`.

Flow: `bridge.ts` (main) spawns the worker and shuttles
`credential | log | changed | ready | sse | completion | done | result | error` up and
`credential-result | cancel | close | models | rpc | complete` down. Credentials never travel by
message value: the worker asks, `vault.ts` resolves from
`<dataDir>/channel-pack/credentials.json` (values encrypted through `storeManager`), and only
`{value}` / `undefined` goes back. Provider management is an in-worker HTTP route (`/api/channel-pack`)
whose result is `{ok:true,value}` / `{ok:false,error}`; the methods used here are `provider.status`,
`provider.setEnabled`, `account.list|create|update|delete`, `login.poll`, `credits.balances`,
`credits.claimAll`, `onboarding.claimAll`, `model.list` and `usage.autoCheckin` (the global one-switch daily auto-claim: no
argument reads its state, a boolean writes it. Completion is recorded **per channel** for the current
UTC+8 day; channels that failed or declared `retryLater` (Qoder before its 10:00 refresh) stay pending
and are retried every 30 minutes — `DSH_CHANNEL_PACK_AUTO_CHECKIN_RETRY_MS` — while finished channels
are not requested again; crossing midnight makes the next retry start a new day. The first round is
still scheduled 30s after the pack starts, and the switch defaults to off).

`onboarding.claimAll` is the second claim button on the channel card (「领取任务积分」) and is a
**different capability** from `credits.claimAll`: a daily check-in is one fixed action per day, a growth
task is one-shot and only claimable once the upstream marks it `completed`. Which channels expose it is
`ChannelDefinition.growthTasks` — required, not optional, for the same reason `dailyCheckin` is: an
optional flag lets a new channel simply not state it, and the UI renders a button that can only fail.
The pack supports exactly one channel there today (`buddy`), and the case rejects the rest with a
readable message rather than the generic `unsupported provider`. Rewards come back in **two separate
domains** (`reward_credit` 积分 and `reward_energy` 能量, measured 2026-11-08): they are summed within a
domain and never across one, which is why the response carries `gained: {credit, energy}` instead of a
single number.

The model catalogue comes from `model.list`, **not** from `bridge.models()` — with exactly one
exception: `model.list` carries no context window, so `manager.models()` pulls the OpenAI-shaped
`/v1/models` view **once per cache refresh** (shared by all fifteen channels) and merges only
`context_window` into the catalogue (`modelCatalog.ts::attachContextWindows`). The view cannot say a
model's multiplier or its `disabled` / `dead` state, which is why `model.list` stays authoritative.
`model.list` returns `{models: [{id, name, disabled, dead, isFree?}]}` and is the only place
that knows a model's **credit weight** - there is no numeric field for it, the multiplier is appended
to the display name in one of three shapes:

```
MiniMax M3 · x4.0          rate only          (loomy / lobsterai / qoder)
GLM-5-3-Flash · x0.2→x0.1  base → effective   (qoder promo / raccoon)
Qwen3.8-Flash · 免费        free               (qoder priceFactor 0 / cline / raccoon)
```

`providers/accountChannels/modelCatalog.ts` is the single parser (`splitModelLabel` +
`readModelList`); everything else reads `ChannelModelInfo`. Three rules: a missing `weight` stays
`undefined`, **never** `0` - trae / minimax report no rate at all, and treating "unknown" as free
would make a user pick a metered model expecting a free quota; an upstream `isFree: true` wins
over the label, so a model is free when `isFree` is set **or** the weight parses to 0; and a missing
`contextWindow` stays missing, **never** a guess - `autoRouting` hard-filters on `contextTokens`, so
inventing a small number silently removes whole channels from every long-context request, which is
the opposite of the "unknown is a real answer" rule the router is built on.

`capabilityHintOf` writes `free` in **both** directions, but only from evidence: `· 免费` /
`isFree: true` gives `free: true`, and an explicit positive multiplier (`· x2`, `x0.2→x0.1`) gives
`free: false` — a model the channel prices by weight cannot simultaneously be a free model, so this
is read off the channel's own quote, not "unknown folded into false". No rate label at all (trae /
minimax) writes neither value, and the attribute stays `unclassified`. Routing is unaffected either
way: `costSignalFor` short-circuits on `free === true` and `costBucketOf` keys off `weight`, so
`false` behaves exactly like absent there; what changes is annotation coverage, where `free` used to
be unfillable for every metered channel model.

The IPC surface is `channels:models` (one channel's catalogue, 30s cache),
`channels:refreshModels` (re-read online, then rewrite the provider record and the global model
mappings; failures return `reason: 'empty'` while keeping the old record), and the two model
mutations `channels:setModelDisabled` / `channels:clearDeadModels` (`model.setDisabled` /
`model.clearDead`, both returning the fresh catalogue). All three clear the **whole** catalogue cache
and run a full `syncProviders()` rather than refreshing one channel: a partial cache would make
`syncProviders` see the other channels as having no models, and an enabled record with an empty model
list becomes a wildcard route target.

`syncProviders` writes only the models that are neither `disabled` nor `dead` into
`supportedModels` / `modelMappings`. `model.list` deliberately keeps both in the catalogue - a model
the user switched off has to stay visible or it can never be switched back on, and a dead model needs
to stay visible for `model.clearDead` - but exposing them as routable would send requests to models
that are guaranteed to fail (disabled) or that the pack pruned for repeatedly failing (dead; the only
self-heal is a 30-day TTL, so the clear button is the sole manual recovery). Account credentials are
renewed through `channels:rpc('account.refresh', {accountId})` and the pool order through
`channels:rpc('account.reorder', {provider, orderedIds})` - the load balancer hands requests out in
pool order, so reordering is how a user picks the preferred account.

`manager.ts` mirrors that state into provider records. It only writes one when the channel has at
least one account, so the provider list never grows fifteen unusable rows; records are
`type: 'account'`, `apiEndpoint: channel://<id>` (a placeholder that is never requested),
`supportsModelFetch: false`, an identity `supportedModels` / `modelMappings` ledger (that ledger is
the pin - `derivePreferredProvider` returns the provider whose ledger lists the requested name - and
the global alias table is never written by the sync), and a credential-less local account so the load
balancer can route. Two rules are easy to get wrong: **zero accounts means the record is
deleted**, and **accounts but an empty model list means `enabled: false`** - an enabled provider with
no models is treated as a wildcard by `providerSupportsModel` and would swallow every model name.
Model ids are `<channel>/<model>`; the worker splits on the first `/`, so nothing plain-prefixes
them twice.

`checker.ts` answers `online` / `unknown` for these from `accountChannels/runtimeState.ts` - it must
never send HTTP to the `channel://` endpoint and never start the worker as a side effect of a status
check. The request path is one `providerForwarders` entry (`provider.type === 'account'`) that hands
the body to `bridge.complete` / `bridge.openStream`; the stream is already OpenAI-shaped, so it
returns `skipTransform: true`.

**The host retry budget is per provider class, and for account channels it is one short retry**
(`src/main/proxy/retryPolicy.ts::planForwardRetries`, the only consumer being
`forwardChatCompletion`'s loop). Account channels already own queueing, quota and account-switch
backoff inside the worker, so the old uniform `5000ms x retryCount(3)` stacked a second backoff on
top - and a host-side retry is not free there: it re-resolves the credential across the thread
boundary, re-encrypts the entire history through WASM and re-hits upstream. Dropping retries to zero
would be the opposite mistake, because the pack does *not* cover two transient classes (worker
restart, `TRANSPORT`), so the host keeps exactly one 500ms attempt. The policy only ever **lowers**
a caller-supplied budget: `forwardAutoCompletion` passes `{ maxRetries: 0 }` as an instruction
(fail the candidate, move to the next), and raising it would double the chain's wait.

**Tool calls round-trip through the pack gateway twice, and both hops can lose the name.** The
chat projection (`vendor/channel-pack/src/openai-gateway/stream.ts`) takes a tool call's `name`
**only** from the `tool-call-delta` chunk and ignores the one in `block-end`, so an adapter that
omits `name` on the delta yields an OpenAI-shaped `tool_calls` with no `function.name`. The client
echoes that history back, the gateway's inbound check
(`messages.ts` `convertToolCalls`) rejects it with `assistant.tool_calls contains an invalid
function call`, and the whole conversation dies on a request that looks fine. minimax hit exactly
this - it recorded the tool name in `content_block_start` but never put it on the delta; the fix
adds `name` there, and `tests/channels/minimax-tool-call-name.test.ts` drives the real vendor
parser plus the real gateway projection (bundled through esbuild, since vendor source cannot be
imported directly under `node --test`) so a regression is caught at the wire format, not at the
adapter's internals.

That inbound error is also why the worker pre-validates the history itself
(`src/main/channelPack/toolCallValidation.ts`, called from `worker.ts` before `toGenerateOptions`):
the pack's own message says only "invalid function call", so a client developer has no way to tell
which message, which call, or which field is wrong. The pre-check mirrors the gateway's rules
exactly - it must never reject what the gateway accepts - and reports the coordinates plus the
received type (`messages[2].tool_calls[0].function.arguments must be a string, received object`).
It throws with `status: 400` so the client sees `invalid_request_error` rather than a 500.

**Pairing is repaired, not rejected.** Shape is only half of what a strict upstream checks: it also
requires every `tool_calls` entry to have exactly one `role: tool` result and vice versa. Measured
2026-11-11 on a Codex turn routed through `codex`: the same history was refused by
`buddy/deepseek-v4-pro` and `buddy/kimi-k3.1-pro` with 502
`工具记录不完整，请新建任务 tool calls and tool results do not match` (that Chinese sentence is the
upstream's own - `grep -rn 工具记录不完整 src vendor` returns nothing), then served 200 by
`buddy/mimo-v2.6-pro`. The cost is three full attempts (each one a full prefill of the same history)
plus a mid-conversation model rotation: that session had been served by `cline/anthropic/claude-opus-4.5`
and `agnes-2.5-pro` up to 15:46, and after these rejections every following turn reports
`auto.reason: sticky` on mimo. Do not read the rotation as "fell back to a weak model" - measured on
this same session mimo drove `finishReason=tool_calls` correctly on turns 12 and 13 (including one
response with four parallel `exec_command` calls), so the two later `finish_reason=stop` turns are not
attributable to model quality; what they had in common was that no permission-request tool was listed
for the turn at all, which is a client-side approval-profile gap, not a routing one. So
`repairToolCallPairing` runs at the same worker site and **only deletes**: a call nobody answered, a
duplicate declaration of the same `call_id`, a result with no call, and the second result for one call.
It never invents a tool result, because the gateway authors no prompt text (裁定 2026-11-03) - a
synthetic "（无结果）" would be a third `GATEWAY-TEXT` site for what deletion already fixes. Deleting the
call keeps the assistant's text when it has any, and drops the message when it does not, since
`content: null` with no calls reads to the upstream as an empty reply. Rejecting locally instead was the
other option and is wrong here: 400 is terminal under the failover policy, so it would turn "slow but
working" into a hard failure. Two boundaries: this site sees only the OpenAI messages the host hands
the worker, so if the counts stay 0 while the upstream still answers that 502, the defect is being
introduced further down inside the pack's own harness conversion - do not "fix" it here; and the repair
is logged as a warn carrying `kind messages[i].tool_calls[j] (call_id)`, coordinates only, because the
body-logging route is structurally blind to the tail (see `countToolCallShapes`).

**Qoder's numeric business codes are classified by code/payload, never by HTTP status**, and each
one has exactly one home: `model-queue.ts` for `10605` (queue) and `110` (daily billing quota:
`QUOTA_EXCEEDED`, switch account and mark the model until 00:00 UTC+8), `qoder-plan-gate.ts` for
`112`. The `10605` wait is **sliced, not truncated**: `rawQueueDelayMs()` returns the server's
declared delay uncapped and `queue-wait.ts`'s `planQueueWait()` sleeps that whole delay in slices of
≤ 10s (`DSH_QODER_QUEUE_SLICE_MS`), honoring at most 30s of it (`DSH_QODER_QUEUE_MAX_WAIT_MS`)
before re-sending **once**. The old code clamped the *wait* to 10s and re-sent, so a server-said-30s
queue cost three full encrypted requests plus three full prefills. `queueDelayMs()` keeps the old
clamped semantics but is now only for callers that want a single `Retry-After` hint; the adapter must
use the uncapped one. `112` is a **plan/tier gate**, not quota: the
upstream answers (HTTP 200, inside the SSE envelope) with
`{"code":112,"message":"{\"isHighestTier\":false,\"pricingUrl\":\"https://qoder.com.cn/pricing?client=qoder\"}"}`
while a free model on the same account still works (measured 2026-10-29: `qodercn/dfmodel` gated,
`qodercn/qfmodel` fine), so only an upgrade changes the answer. It is recognised in all three
channels - the envelope-unwrapped frame, the bare frame, and a non-SSE JSON body - and becomes a
readable `PERMISSION_DENIED` (non-retryable) error carrying the pricing URL, never a credential
refresh. Leaving it as `SERVER` produced the reported symptom: raw JSON plus `(112/model_error)` in
the client, and five pointless retries. `compat/dshLlm.ts` also keeps the upstream status in
`failure.status` (the contract `openai-gateway/stream.ts` and `opencode-adapter.ts` already read),
so a 4xx survives to the client instead of degrading to 502. **The SSE frame has to carry it too**:
a pre-first-chunk failure only reaches the host as one error frame, and a frame without
`error.status` is judged by wording alone - `forwardAccountChannel` then records 502, the failover
loop books it as an account fault, and three cline `:batch` variants (upstream 404 `model not
supported`, every time) spend a `maxAttempts: 3` route whole and end the chain at attempt 7 of 1152
(2026-11-12 `chatcmpl-mwcbjari-izjtek`, client sees `503 no_available_model`). Both halves are
fenced: `tests/channels/openai-gateway-error-frame-status.test.ts` puts the number in the frame,
`tests/routes/account-channel-stream-error-status.test.ts` proves the loop reads it.

**Qoder's `session_id` is a conversation identity, not a per-request nonce**
(`qoder-session.ts::deriveQoderSessionId`, consumed by `buildQoderInferPayload` via
`QoderInferAsk.sessionId`). The adapter re-sends the **whole** history every turn, so a random
session id (`crypto.randomUUID()`, the old behaviour) makes turn N pay for a cold prefill of turns
1..N-1 on every single round - that is the measured-feel "much slower than the IDE", because the IDE
talks inside one server-side session. Derivation dims are `model / account / system / first user
text` (same set `gemini.ts::deriveGeminiSessionId` uses; the hash itself is not the vendor's), and
the value stays UUID-shaped so the wire does not change form. Three rules follow: **the first** user
message, never the last (the last one changes every turn and would recreate the bug); `generation 0`
must hash identically to "no generation" (otherwise shipping this rotates every live conversation
and throws away the cache it was meant to build); and the account is part of the seed, so a
queue/quota account switch rotates the session with it. Rotation is bounded and observed: a 409
`duplicate_request` bumps `sessionGeneration` (a same-content resend under a reused session would
otherwise hit the same dedupe), and `looksLikeSessionConflict` bumps it once more - but only on
wording that is actually about the session or the context length, never on `10605` / `110` / `112`,
each of which already has a correct handler. `DSH_QODER_SESSION_REUSE=0` restores random ids;
`onSessionConflictFallback` logging is the only signal that reuse is being rejected upstream.

**A test of the envelope path must peel the envelope first.** Production is
`consumeOpenAiSse(unwrapQoderEnvelopeStream(response, 'qoder'))` (`qoder-adapter.ts`), and the two
halves are not interchangeable: handing the raw envelope to `consumeOpenAiSse` shows it a frame with
no `choices` and none of the inner `code`, so it drops the frame silently and the stream ends
normally. A test written that way asserts on a `undefined` error and reads as a product regression -
`tests/channels/qoder-plan-gate.test.ts` hit exactly this (it even destructured
`unwrapQoderEnvelopeStream` and never called it), while every bare-frame and non-SSE case passed.
Any new case for this pipeline should drive the pair in production order rather than testing the
consumer in isolation.

**Reasoning is replayed into the inbound history, because the client does not send it back.**
DeepSeek-family upstreams reject an assistant turn that carries `tool_calls` without the
`reasoning_content` it produced (see the reasoning note in `openai-gateway/messages.ts`). Measured
2026-10-30 on one 274-turn capture: `trae/deepseek-v4.1-flash` was missing `reasoning_content` on
**253 of 274** tool-call turns (92%) while `loomy/GLM-5.3-Flash` missed only 4 of 41 (its upstream
does not require the pairing) - which is exactly why only the DeepSeek-family channels failed, with
the upstream's own generic `assistant.tool_calls contains an invalid function call`.
`channelPack/reasoningReplay.ts` fixes it on the proxy side: it observes **what we emit downstream**
(not what the upstream produces, because upstreams express reasoning either as a field or as an
inline `<think>` tag that `sse.ts` un-shifts, and the downstream is where those two forms have
already merged), caches it **by `tool_call.id`** - the only stable anchor both sides share, since the
client may rewrite content - and injects it on the next request when the client left it out.
Four rules: a turn the client already sent reasoning for is **never touched**; a turn with genuinely
no reasoning is never filled (no fabrication) and is not cached; the cache is **bounded**
(`REPLAY_MAX_IDS`, 4096 ids, oldest-first) because it is cross-request state and an unbounded one
would be a de-facto session table; and `DSH_REASONING_REPLAY=0` restores plain pass-through, which is
the first thing to try if an upstream ever starts validating that the replayed reasoning matches its
own record. Acceptance criterion, pinned by `tests/channels/reasoning-replay.test.ts`: after replay,
`countToolCallShapes().missingReasoning` is 0 with the `assistantWithCalls` denominator unchanged.

**The aggregate lane needed the same replay, and had never been wired to it.** The mechanism above
lives in the channel-pack worker, so it only covered `type: 'account'` channels; a client naming an
aggregate model directly (Qoder against the aggregate `deepseek` route, `api.deepseek.com`) goes
through `forwarder.ts`'s generic `openai-chat` branch instead. Three requests on 2026-11-07
(`chatcmpl-mw71last-4u3cl8`, `-mw71lf3u-rh0wto`, `-mw71linp-5lqnnm`) died with 400 `The
reasoning_content in the thinking mode must be passed back to the API.` `proxy/reasoningEcho.ts`
closes it without a second cache: it observes the upstream SSE where the chat route already collects
its tail (`routes/chat.ts`), splits frames **by line through a `StringDecoder`** (a chunk boundary can
land inside a multi-byte Chinese character, and a replacement character replayed upstream is worse
than no replay), and injects before the body is assembled (`forwarder.ts`). Scope is the **endpoint**
(`api.deepseek.com`), not a model list: the requirement is the upstream's, and `type: 'account'`
stays with the worker so nothing is observed twice. `ReasoningReplay` keeps one accumulator per
response and shares only the id→reasoning map (`ReasoningReplayCache`), because a single object used
as both cache and accumulator mixes two concurrent streams' deltas. `isMissingReasoningHistoryError`
also recognises DeepSeek's wording (`must be passed back`) so an `auto` route still switches past the
800 when the cache misses (e.g. right after a restart); a direct model name gets the honest 400.
Tests: `tests/proxy/reasoning-echo.test.ts`.

**The shadow counter exists because request-body logging structurally cannot answer this.**
`countToolCallShapes()` (same file as the validator, and **pure observation** - it never affects
validation) logs one line per request that has tool-call turns. Body logging was tried first and
failed for a concrete reason: a real request body measured **1.8 MB** while
`requestLogConfig.maxBodyChars` truncates **from the head** (8000 default, 40 000 at most), and
`tool_calls` necessarily live in the tail of `messages` - so the evidence was always cut off, and
raising the cap to fit would cost hundreds of MB per day. Logging counts instead of content answers
"how many turns are missing reasoning" with no user text on disk.

### Auto Routing (the virtual `auto` model)

`auto` is a reserved display name routed by `src/main/proxy/autoRouter.ts` (data collection, sticky
state, cooling) and `src/main/proxy/autoRouting.ts` (all pure decision logic, unit-tested directly).
Its candidate pool is exactly `getEffectiveModels(provider)`, i.e. the models the user kept served -
auto never widens that.

**Preset routes are seeded once, the same way `auto` was migrated.** Since R2 (`/v1/models`
advertises enabled route names only), both a client that can only send one fixed model name and a
user picking a chat tier need a route of their own, so `store/modelRoutes.ts::PRESET_ROUTE_SEEDS`
lists them (today: `codex` for the Responses client, plus the three `/v1/chat` tiers `daily` /
`stable` / `performance`) and `store.ts::seedPresetRoutes` creates the missing ones at the end of
`initialize()`. Two rules keep that honest. First, the gate is the on-disk
`config.seededPresetRoutes` marker - never "is the table empty", which would resurrect a route the
user deleted; creation goes through `createRoute`, so the seed obeys the same charset / duplicate /
`conflicts_model` checks as the UI, and a name already held by a served model is skipped *and still
recorded as handled* so it is not retried on every start. Second, only a tier seed may carry a pool
filter, because the tier *is* its filter: `daily` = `free-only` (prefer `cheap`), `stable` =
`channel-only` (prefer `balanced`, i.e. account-channel quota rather than aggregate spend),
`performance` = `strong-tier` (prefer `strong`). The protocol seed intentionally carries none: the
capability predicates are strict (`tools-capable` drops every un-annotated candidate) and an
out-of-the-box filter there would advertise a name that can only answer 503. An empty tier pool is
not hidden either - the route is still advertised and answers `503 no_available_model` with
`details.missing = ['pool_strategy']`, which is the same state the route card warns about. Tool
capability needs no seed-level gate anyway: it is enforced per request (channel
`capabilities.tools === false`, `maxTools`). `auto` itself is left untouched by the seed, so existing
configs keep their behavior.

The same startup pass also runs the Anthropic discovery (`shared/anthropicDiscovery.ts` via
`store/anthropicRoutes.ts`). It has to: a route that only appears when someone clicks a button in
settings means every install that never clicked has zero Claude routes, and after R2 a bare model
name is no longer advertised for Claude's own name filter to see. Names are the leaf segment of real
`claude*` / `anthropic*` models, one route per model, `pinModels` set so the name cannot drift, and
the same recorded-name list is passed as `skipNames` so a route the user deleted is not re-created.
A catalogue entry without an active account yields no route and is deliberately *not* recorded, so
activating the account later lets the next start add it. The summary log
(`Anthropic discoverable routes seeded: N`) carries the skip reasons - the only way to explain a
client-side empty list (no active account / name not routable / name already taken).

**Capability is tri-state and unknown is a real answer.** `ModelCapability` (vision/tools/reasoning)
is `yes | no | unknown`; `contextTokens` is `undefined` when unknown and never defaulted to a number.
`resolveCapabilityDetail()` in `proxy/autoRouting.ts` merges six ordered layers, per field: manual
mark (`userModelMarks`) > provider record (`Provider.modelCapabilities`) > aggregate-official >
the static table in `src/main/proxy/modelCapabilities.ts` > the provider-level default there >
**third-party** (`shared/aggregateCapabilities.ts`, models.dev). `ModelCapability.sources` records
which layer won each field and `tierEvidenced` distinguishes a mark from a name heuristic, because
the route editor must be able to show "vision = yes (provider default)" instead of an assumption
dressed up as evidence. The static table is keyed by provider record id and *also* retried against
the part after the last `/`, because aggregate display names are `<entryId>/<modelId>` and the old
table silently missed every one of them.

**Manual marks are a separate store key, not an override.** `userModelMarks`
(`providerId -> displayName -> ModelCapabilityHint`) is written only by
`store.setUserModelMark` / `providers:setModelMark`. It is deliberately not part of
`userModelOverrides`, because every model sync rewrites that structure; a user's correction must
survive a sync. `store/modelMarks.ts::normalizeModelMark` keeps only explicitly set valid fields -
`unknown` is not a storable value (delete the entry to return to automatic), and an entry with no
valid field is removed rather than stored as an empty shell.

Filtering rules (`hardFilterFailure`, shared with `rankCandidates` and the route preview): an image
request only reaches a model whose vision is `yes` (an image dropped upstream is a wrong answer);
`tools: no` is excluded but unknown is allowed with a small penalty; a **published** `contextTokens`
smaller than the request's estimate filters here, and an unknown one is never filtered - "no
published ceiling" is not evidence of overflow, so the request goes out and, when that channel really
cannot fit it, its context-class 400 switches to the next candidate
(`failover.ts::isContextOverflowError`). `UNANNOTATED_CONTEXT_FLOOR` (64000) is therefore *not* an
admission threshold any more; it survives only as a scoring one - an un-annotated window costs 0.05
once the estimate passes half of it, because unknown should yield to evidenced. A request that names a
reasoning tier (`reasoning_effort` / `reasoningEffort`, anything but `none` - `none` means "explicitly
do not think" and must not filter non-reasoning models out) carries `profile.needsReasoning`: candidates
annotated `reasoning: 'no'` are dropped for that request, unannotated ones stay eligible with a 0.05
penalty, and `details.missing` may say `reasoning` only when **every** candidate is explicitly `no`.

**Contract filtering.** `contractNeeds()` derives what the response shape depends on - `n > 1` and
`response_format: json_object | json_schema`. Only builtin providers fail those (see
`parameterPolicy.ts`). If no candidate can satisfy the contract: `n > 1` is a 400
`unsupported_parameter`, while `response_format` still routes and sets
`X-ModelPort-Auto-Degraded: response_format` - returning free text beats refusing the request, but it
must never be silent.

**Cost and preference.** `costBucketOf()` (shared with the channels UI) turns the channel
multiplier into a bucket; unknown is neutral, never "cheap". `prefer` is
`balanced | fast | strong | cheap`, stored in `autoRouting.prefer`, overridable per request with
`X-Auto-Prefer`. It changes both the target tier and the weight the cost factor carries: balanced
0.2, fast 0.2, strong 0.1, cheap 0.6 (cost enters as `weight * (costScore - 0.5)`, so an unknown
cost contributes exactly zero). Builtin and custom providers have no cost data at all.

**Stickiness is a bonus, not a pin.** The previous candidate for the same conversation scores +0.12
(same account) or +0.06 (same model, another account). A cooled-down or exhausted candidate simply
leaves the pool.

"Same conversation" is keyed on the client's own session identity **when it supplies one**
(`shared/clientSessionKey.ts`: `prompt_cache_key` -> `user` -> `metadata.user_id` -> `session_id`
header, first non-blank wins; the inbound protocols resolve it once and hand it to the chat route over
`X-ModelPort-Session-Id` / `-Source`, and a forged source label degrades to `session_id_header`). The
two inbound lanes are not symmetric and that is why the header exists at all: the Responses translation
copies `prompt_cache_key` onto the chat body verbatim (dropping it would throw away the upstream's own
cache hint - `responsesInbound.ts`), so that lane resolves the session with or without the header,
while the Anthropic lane's `metadata.user_id` is deliberately *not* put on the chat body (forwarding it
as `user` is what got a reasoning model rejected with 400 by OVH), so there the header is the only
carrier. Identifiers *coarser* than a conversation (`installation_id`, window ids) are deliberately not
accepted - they would pin two different chats in one window to one candidate, which is worse than the
problem being fixed. Only when the client gives nothing does the key fall back to the content
fingerprint (`conversationKey` = system prompt + first user message), which is the whole pre-2026-11-03
behaviour.

The fingerprint alone was wrong for agent clients, measured: Codex desktop rewrites its own history
into a hand-off summary when it reaches its client-side budget, and that summary *becomes* the new
first user message - the fingerprint changes, stickiness is lost, and the conversation is re-dispatched
mid-session. One remote `prompt_cache_key` covering 79 turns was served by four different models
(raccoon x55 / loomy x20 / lobsterai x2 / qodercn x2) before this existed. `RequestLogEntry.auto
.sessionKeySource` (`client-session` / `content-hash`) records which key answered, so "we switched
because the client rewrote the history" and "we switched because scoring reordered the pool" are two
different readable states instead of one guess. The identifier's value never reaches a log row - only
its hash and the source label.

**Stickiness is a hard priority, per route.** The conversation's last succeeded model is moved to the head of
the ranked list inside `autoRouter::select` (`promoteSticky`), which is stronger than the `+0.12` / `+0.06`
bonus computed in `rankCandidates` - the bonus alone could not hold a Codex session on one model (measured: 21
requests jumping across 7 models before it). `ModelRoute.stickyHardPin` makes this per-route and **absent means
enabled** (the read is `!== false`), so records written before the field existed keep the behaviour they were
observed to need; `basedOnRoute` inherits it from the pool source like every other selection field, and preset
seeding copies it from the `auto` route so a user's deliberate "off" is never silently re-enabled by an upgrade.
Turning it off returns to pure-bonus semantics where scoring alone decides the head, which is why the two
settings are tested as a pair (same pool, a 0.3 cost gap, opposite winners). Note the layering trap: an
assertion over `rankCandidates` cannot see a regression in the promotion, so the sticky test that used to read
"never hard-pins it" is scoped to the layer it actually covers.

Response headers on every `auto` response: `X-ModelPort-Route` (winner), `X-ModelPort-Auto-Prefer`,
`X-ModelPort-Auto-Reason` (`only` / `sticky` / `score`), `X-ModelPort-Auto-Attempts` (set after
forwarding), and `X-ModelPort-Auto-Degraded` when a contract was relaxed. An empty candidate pool
answers 503 with `details.missing` (`vision` / `tools` / `context` for a request-shape gap,
`pool_strategy` / `manual_filter` when the route's own configuration emptied the pool) instead of a
bare "no model". `context` in that list is claimed only when **every** surviving candidate published a
window and each published window is smaller than the request: a candidate that published none is not
evidence it cannot fit, so the row never asserts a capability nobody proved (`explainMissing` - it
describes the pool, it does not change the verdict). The same decision record is stored on
`RequestLogEntry.auto`.

**A candidate that answers "this channel cannot serve this request" is switched past, not fatal.**
`isFailoverEligibleStatus` keeps its pure status-code meaning (429 / 5xx / no status), and a short list
of message-keyed classes is let through it in `forwardFirstReachable` **before** that check, each
without cooldown and without an account-failure count, because the request dies before generation and
the account is healthy: tool-count overflow (`isToolOverflowError`), missing `reasoning_content` in
history (`isMissingReasoningHistoryError`), the channel worker's own `模型不存在或已停用`
(`isChannelModelUnavailableError`, `src/main/channelPack/worker.ts::complete`), a forced
`tool_choice` the target refuses (`isForcedToolChoiceUnsupported`), a context window too small for the
request (`isContextOverflowError`, `failover.ts`), a model that rejects the client's
`reasoning_effort` (`isReasoningEffortUnsupportedError` - OVH's `Meta-Llama-3_3-70B-Instruct` answers
`feature 'reasoning_effort for this model' is not currently supported`, and because that catalogue
entry carries no reasoning annotation the route-side hard filter cannot catch it in advance), a
session-affinity header the upstream demands and we never sent
(`isMissingSessionAffinityError` - OpenCode Go answers 400 `Request is missing x-opencode-session and
cannot be routed efficiently`, 2026-11-11 16:51, `attempts: 1` with nine candidates untried), an
account that has not paid (`isAccountArrearsError` - Bailian answers 400 `Arrearage`, "make sure your
account is in good standing", 2026-11-12 05:24, and because 400 was terminal the whole chain died on
that one unpaid account), and
**any plain `404`** - a renamed or
capability-divergent model is "this channel does not supply it", not an account fault, so since
2026-11-02 (new-api parity) it switches too; previously 400/404 were terminal and one such answer ended
the whole chain (`attempts: 1`) while four other candidates went untried, which the client read as
"auto is unavailable". The third class exists because the two catalogue views of the pack disagree by
design: the host's `supportedModels` comes from `model.list` -> `listAllModels()` (**no** identity
gating), while the worker's request-time pre-check reads `listModels`, which for `opencode` is
free-only when no `sk-` key was pasted - an anonymous-only install therefore advertises 6 paid models
it can never serve, and `auto` ranks one of them first (big window + tools + reasoning). Measured
2026-11-01 08:06:40 / 08:11:00, `opencode/qwen3.8-max`. An opaque aggregate 400 (empty body /
`Unknown error`) joins the same switch list via `isOpaqueAggregateBadRequest`, also without
account penalty; a *described* 400 is still terminal, because 400-means-client-error is what keeps a
wrong request from being retried down a whole pool. Message-keyed matching stays deliberately narrow
(each detector requires both a context word and the overflow phrase) and is pinned by
`tests/routes/proxy-routes-catalog-404.test.ts`, which drives a real local upstream and asserts the
reproducible candidate order, the catalogue-drift 404 switch and the plain-404 switch, plus
`tests/proxy/failover.test.ts` for the detectors themselves.

**OpenCode's session-affinity headers are sent, and only those.** Switching away from the 400 keeps the
turn alive but leaves `opencode_go` permanently at the head of the candidate list, paying one wasted
round-trip per turn, because the aggregate lane never sent the header at all
(`forwarder.ts::buildHeaders` had no request in scope). `src/main/proxy/utils/opencodeAffinity.ts`
sends the four same-value headers the endpoint names (`x-opencode-session`, `x-opencode-session-id`,
`x-session-affinity`, `x-session-id`), keyed on the **client's own** conversation identity where it
declared one (`prompt_cache_key` -> `user` -> `metadata.user_id`, the same precedence as
`clientSessionKey`) and falling back to a per-account value, because "cannot be routed efficiently" is
an affinity request - a fresh random id per call would split one conversation into N sessions and
defeat the thing the header is for. Both branches are pure hashes, so there is **no cross-request cache**
to bound or leak. Two limits, both measured rather than assumed (a five-variant probe against
`/zen/go/v1/chat/completions` with the stored key, reading only status codes): the *value's shape does
not matter* - a plain `mp-<24hex>` clears the gate exactly as well as the pack's CLI-minted
`ses_+12hex+14base62` - so we do **not** copy `x-opencode-project` / `x-opencode-client` / the minted id
/ the v2 `user-agent`, which are a claim that this machine is the OpenCode client, and the gate does not
ask for them; and `x-opencode-request` stays unsent (v1-only, v2 answers 403). After this the same call
answers 403 `An active OpenCode Go subscription is required to use OpenCode Go models.` - the header
gate is cleared and what remains is an account entitlement we cannot and do not fabricate. Pinned by
`tests/proxy/opencode-affinity.test.ts` (host matching incl. `notopencode.ai` / `opencode.ai.example.com`
false positives, the four headers carrying one value, the identity headers asserted **absent**, value
stability and precedence, and a source pin that both `buildHeaders` call sites pass `request`).

**An account the upstream says it will not serve is parked, not rotated - on every channel.**
`vendor/channel-pack/src/account-stop.ts` holds the shared judgement (`ACCOUNT_STOP_MARKERS`:
停止提供服务 / 封禁 / 违规 / 安全审核 / account suspended / official client …, and deliberately *not*
generic `forbidden` / `unauthorized`, which are ordinary 403s) plus `parkStoppedAccount`, which writes
`enabled: false` and `serviceStopped { at, text }` in one store write. Every adapter calls it at the
point where status and body are known: buddy/workbuddy (three paths), qoder (HTTP + in-stream),
trae (first response + rotation loop), cline (region-403 read + both error paths), loomy, raccoon,
minimax, zcode, gemini, opencode, lobsterai (its own `service-stopped` class over
`LOBSTERAI_SERVICE_STOPPED_MARKERS`, checked before the status code because the credit lane reports
the same stop as HTTP 200 + an in-stream error frame). A hit is terminal: no rotation, no token
refresh + resend, no rate-limit badge (a ban shown as "限额重置" is a false statement), and
`getAvailableAccount` / the balance gate / the catalogue pre-check stop selecting the account while
`enabled === false`; the daily claim and balance passes skip it under the same condition, and
re-enabling the row (per account or per channel) drops the record - that switch is the user's
explicit "try again". `tests/channels/account-stop.test.ts` pins the judgement, the write, the
failure-isolation, and a source scan that every adapter still calls it.

Rotation is bounded everywhere: `BUDDY_MAX_ROTATE` replaced workbuddy/buddy's `for (;;)` until the
pool ran dry, and `QODER_MAX_ROTATE` bounds `switchAccountOnQuota`; the other channels already ran at
three. Selection inside a channel is sticky to the **current serving account** (`activeAccounts` +
`moveActiveFirst`): while it is eligible it stays first whatever the manual order says, and the pin
only moves when that account is excluded (it just failed), disabled, or rate-limited for the model.
A hand-over therefore switches once instead of leaving the channel running two accounts at the same
time - the last way one gateway could look like two clients. Re-ordering the accounts in the UI clears
the pin, because that is the user redefining which account should serve. Unattended traffic is
trimmed as well: auto check-in is now **off by default** (a round is
"channels × accounts" authenticated requests nobody asked for), the balance gate only *reads* on the
selection path (`usableFromCache`, background refresh) instead of awaiting a probe per pick, the badge
TTL is 10 minutes. Retired outright on 2026-11-05: trae's check-in device
generation and `DSH_TRAE_ROTATE_MACHINE_ID` machine-id rotation, and opencode's
`opencode.rotateFingerprint` - each of them existed to change device/project identity so a per-device
or per-project limit would not apply, which is evading the upstream's accounting rather than using
it. What none of this does is make the lanes safe: these channels drive consumer accounts through a
client the vendor does not authorise, and that is the stated reason for the stops.

**Pool strategies are set algebra read left-to-right, and a later `or` can void an earlier filter.**
`route.poolStrategies` is a sequence over the 17 predicates in `STRATEGY_PREDICATES`
(`AutoPoolStrategyId`), each carrying `operator: 'and' | 'or'`: `and` intersects the running set, `or`
unions it. So `[free-only, and tools-capable, or vision-capable]` does not mean "free AND tools AND
vision" - the last step re-adds every vision model the second step removed, including paid
tool-less ones. That is a real config, not a hypothetical, and the route must not silently promise one
thing and do another, so `applyPoolStrategies()` returns `conflicts`: one entry per `or` strategy that
voided an earlier strategy **of a different category** (`capability` / `channel` / `context` / `cost` /
`tier`, from `AUTO_POOL_STRATEGIES[].category` via `STRATEGY_CATEGORY`), with how many models it added
back and which steps it broke. Same-category unions are *not* reported - `(free ∪ low-weight ∪ in-plan)`
is exactly how the money-saving presets are written, and warning about it would train the user to
ignore the warning. `RoutePoolEditor` renders `preview.conflicts` as a notice, and the 503
`details.missing` value `pool_strategy` is the same emptied-by-configuration state seen from the
request side.

**Route-level manual include/exclude is the correction for a wrong mark.** `ModelRoute.includeModels`
/ `excludeModels` (`RouteModelRef = {providerId, displayName}`) are applied by
`applyManualModelSelection()` **after** `poolStrategies` and **before** the contract filter:

- `excludeModels` always wins, so a hand-broken config can never reintroduce a model the user removed;
- `includeModels` can only resurrect a model from the pre-strategy candidate pool, and never bypasses
  the request-time hard filters or the contract filter - those protect correctness, not convenience;
- an include that no longer matches a served model is reported as `unresolved`, never silently
  ignored (the route editor lists it with a remove button).

Matching is trim + case-insensitive on both fields, the same normalisation `store/modelRoutes.ts`
uses for dedupe, so a ref typed with different casing is not treated as unresolved. Write-side
validation (`checkRouteModelRefs`) checks shape only - a stale ref must not make every later edit of
that route return 400.

`routes:preview` (`autoRouter.preview`) runs the same collection/strategy/manual pipeline as a real
request and returns one row per model with `status` (`kept` / `included` / `excluded` / `filtered` /
`unavailable`), the first strategy that dropped it, the hard-filter reason, the resolved capability
(with sources) and cost bucket. It does **not** apply cooldown or the contract filter, because those
are request-time properties rather than route configuration. The renderer's route editor renders
exactly this result, so "which model gets routed, and by which step was it dropped" needs no log
reading. `RoutePreviewResult` lives in `shared/types.ts` because the renderer cannot import from
`main/proxy`; `autoRouter.ts` re-exports it.

### Degenerate Stream Detection (the second degraded class)

`isDegradedSuccess` used to recognise exactly one shape: HTTP 200 with
`finish_reason=length` while the client asked for no cap. The 2026-11-03 WorkBuddy agent
session exposed the other shape - **a stream that is protocol-perfect and content-degenerate**:
every turn returned 200 with `finish_reason=tool_calls`, and the client aborted it with its own
`REASONING_LOOP` guard. On our side that lands as `client_abort`, which the scorer skips
(`autoBandit.ts`), so the model that produced it was never penalised and stickiness kept
re-anchoring the conversation to it.

* **The measurement is a pure function over the SSE body** (`shared/streamRepetition.ts`):
  `content` / `reasoning` / `reasoning_content` deltas are re-joined, the verdict is taken over
  the **trailing 128 lines** (a late collapse must not be diluted by a clean opening), and the
  reading (`lines / uniqueLines / dedupRatio / runChars / degraded`) is stored on
  `streamTrace.repetition`. Only aggregates go into the row - never the text.
* **Thresholds are a setting**, `AppConfig.streamRepetitionGuard` (absent = shipped defaults, so
  an old config file neither disables the guard nor silently changes them). The defaults are
  calibrated on 99 real reasoning blocks from that session: healthy median is **1.000**, p10 sits
  between 0.648 and 0.982, and `maxDedupRatio: 0.8` flags 9 of the 99 blocks while never touching
  the cleanest model in the pool (`raccoon`, min 0.982). The client aborted at 0.35, so the gateway
  stays deliberately looser - it must not condemn a stream the client accepted.
* **`runChars` is evidence, not a judgement input.** The first draft required a long consecutive
  run alongside the ratio; the calibration showed long runs appear mostly in *healthy* blocks, so
  the AND rule would have flagged almost nothing. A knob with no consumer is worse than no knob, so
  `minRunChars` was dropped from the settings entirely rather than left decorative.
* **Stickiness is revoked, not merely un-promoted**: `autoRouter.revokeSticky()` is called at both
  stream settle paths when the verdict is degraded. The anchor is written at response-header time,
  so the correction has to happen after the stream ends.
* **Non-streaming responses are not judged, and the panel says so.** There is no per-chunk signal
  and the body only exists when body logging is on; claiming coverage there would be a fabricated
  reading.
* Tests: `tests/shared/stream-repetition.test.ts` (verdict, tail window, short-answer exemption,
  threshold-is-a-real-knob), `tests/proxy/bandit-repetition.test.ts` (streak + no regression on the
  length rule), `tests/renderer/repetition-guard-wiring.test.mjs` (wiring, with six in-memory
  mutations as negative controls).

### Pool failover, and latency as a gate (2026-11-12)

The user reported two defects with routing as shipped: it "feels an order of magnitude slower than one
direct model", and switching between models mid-conversation produces unexplainable client errors. The
five-part plan (lane split, latency gate, reasoning replay unification, `X-ModelPort-Switch`, compatibility
grouping) was approved in that order; this section records the two routing-layer pieces.

**The lane, and why it was retired the same day.** The first model put a per-model fence in the failover
loop: `autoRouter::select` pinned the head candidate's `displayName` as the lane, `forwardFirstReachable`
broke at the first candidate of another model unless `crossModelFailover === true` and the previous failure
was a `capabilityMismatch`, and one exception (`laneExhausted`) advanced past the fence when every account
of the lane model had failed with `isChannelHumanRequiredFailure`. The user's verdict after using it was
that the client aborts on the very first turn and "这种路由模式是死路一条". Live rows agree: `chainLength`
37-116 against `attempts` 1-2, every row carrying `lane.crossModel: false` - an OpenCode 404, a modelscope
`limit_burst_rate` 429 and a workbuddy risk-control 400 all ended the chain at the head model while dozens
of live candidates were never called. A hard failure of one model says nothing about the next one; that is
the premise the fence got wrong.

**The pool.** `autoRouter::select` still does a **stable partition** - one model's accounts contiguous, the
head model's `modelFamilyKey` family next, different names last - but it is **order only**. The loop carries
no fence, no per-model accounting and no lane field: any failure the status policy allows advances to the
next candidate, structurally including the next model, until a candidate answers or the 90 s wall clock /
`baseCap` (account faults: 5xx, network) stops it. `ModelRoute.crossModelFailover`,
`AutoRouteDecision.lane`, `anchorLaneToCandidates` and `RequestLogEntry.auto.lane` are retired; the
pre-dispatch prechecks (channel rate limit, pack service list) no longer need to re-anchor anything, because
there is no anchor to keep. Plain 400 is the one class the pool treats differently from the named-model
chain: on `auto` a bare 400 (not a client abort, not a `capabilityMismatch`) switches the candidate without
an account penalty, capped at `MAX_REJECTED_REQUEST_SWITCHES` = 2 in `forwarder.ts` - one provider refusing a
request body does not condemn the pool, two in a row more likely mean the request itself is malformed, and
`describeAttemptFailure` records such an attempt as `failover` because that is the branch actually taken.
A client abort is still terminal: it surfaces as 400 with `request.signal.aborted`.

**The latency gate.** `ewmaFirstTokenMs` used to be only a capped 0.2 penalty in `scoreCandidate`, which the
hard pin overrode - so a model measured at 9.7-35.1 s first token held the conversation for the whole sticky
window (routing p50 15.3 s / p75 90.2 s against direct p50 1.9 s over the same period; the 8x headline number
is not fully attributable - the routed sample was 17 rows against 281 direct ones - but the pinning mechanism
is). `autoRouting.ts::poolLatencyGateMs` computes the pool's p75 EWMA (needs 4 readable samples, ignores
missing/NaN/zero), `select` skips the hard-pin promotion when the would-be-promoted candidate exceeds it
(`stickyGated`), and the same figure is handed to `shouldRevokeStickyAfterStream` at the settle sites so a
completed-but-slow turn revokes the anchor. Bounded reading: this changes *who goes first*, not what the
pool contains; the sticky bonus (+0.12 / +0.06) still applies, so a slow-but-cheap model can still win on
score.

Header note: `X-ModelPort-Switch`, stickiness and the latency gate all still assume a session is happiest on
one model, so the pool spends its order on that preference first (head model's accounts, then its family).
What it no longer does is let the preference become a cliff: a conversation can move on to another model
inside the same request when the ones ahead of it fail, and the 503 + `Retry-After` collection at the chain
head is reserved for "the whole pool was tried and nothing answered".

### Architecture A: one model per turn (2026-11-13)

The 2026-11-12 pool fixed the dead end by letting a turn walk the whole catalogue, and the user's verdict
after living with it was the opposite complaint: "延迟大；不可预知错误多（换模型契约难对齐）". Both readings
are the same fact from two sides - a turn that moves between *models* has to re-establish context
expectations, tool protocol and the prefix cache mid-conversation, and each new model is a new contract to
align. The approved answer is **A**: a turn serves **one model**; accounts of that model are still a
failover group; a *different model* is only ever reached at a turn boundary. The pool semantics above
remain, but they now describe `modelScope: 'pool'` rather than the default.

**The scope.** `ModelRoute.modelScope: 'single' | 'family' | 'pool'`, default `'single'` when the field is
absent (a route record written before this change keeps working and lands on the new default). `single`
trims the ordered list to the head model's accounts, `family` keeps everything sharing
`modelFamilyKey(head)`, `pool` keeps the previous behaviour. Trimming happens in `autoRouter::select`
*after* the soft pin and *after* the circuit reorder, so a user pick or a degraded model decides which
model the turn serves; nothing downstream re-expands it. A single-scope turn gets
`AUTO_SINGLE_SCOPE_BUDGET_MS` = 40 s through `AutoRouteDecision.wallClockBudgetMs` instead of the 90 s
pool clock: with only accounts left in the chain, waiting longer cannot promote a new model (that can only
happen between turns) and only holds the client's socket.

**Fast switching, and its precedence.** `ModelPin` is the soft pin: memory only, keyed by route plus
scope (route-wide, or a session key), 30 minutes (`DEFAULT_PIN_MINUTES`), `source: 'console' | 'tray' |
'header'`. Precedence in `select` is **soft pin > `ModelRoute.preferredModel` > sticky**: the pin
reorders the list before the latency gate and the circuit, so a pin is *not* vetoed by an automated
ticket (user intent outranks it; the menu still shows the model as circuited). A pinned model that is not
in the pool at all (disabled, no accounts) serves the ordinary order but reports `pinMiss` into the log
and the response headers - a silently ignored choice is how "the tray says X, the traffic says Y" goes
unnoticed. `preferredModel` is the persistent form of the same choice (one `RouteModelRef`), surfaced with
`until: 0` so the UI can draw "一直" instead of a countdown. A client that asks for a model with
`X-ModelPort-Model: <displayName>` (`autoModelFromHeader`) pins it for the conversation
(`source: 'header'`, session scope when a session key exists) - the same mechanism, so the next turn does
not "think for" the client and switch away.

**The model circuit - the between-turn switching channel.** Since a turn cannot change models, "this model
cannot do the job" has to become "start the next turn elsewhere". `tripModelCircuit` records
`(route, model) → until` for 5 minutes (`MODEL_CIRCUIT_MINUTES`), memory only, and `select` demotes those
models to the tail. It is tripped by `modelQualityDegradation` and by nothing else - the five classes
where the model itself failed to finish: ② repetition, ③ empty turn, ④ announced stop, ⑦ prose-only
fallback stop, ⑧ synthesized incomplete step (§Synthesized Incomplete Step, 2026-11-13). ① unrequested
`length`, ⑤ upstream truncation and ⑥ slow first token deliberately do not
trip it: a cap and a queue are events of one turn, and switching models over them is not more correct than
staying. The ticket demotes rather than deletes (a circuited model is still a valid last resort), is
disabled entirely when every model is circuited (an empty pool serves nobody), and is cleared by the first
successful turn on that model in `rememberRoute`. Account-level AIMD stays a separate domain: three
accounts of one model rate-limited say nothing about whether the model can work.

**One menu, three wires.** `autoRouter::routeMenu(route, limit = 8, now)` returns per route: `enabled`,
`modelScope`, `current` (what the next turn would serve), `pin`, the model list with `pinned` /
`circuitUntil`, and `totalModels` so a truncated menu does not read as the whole pool.
`routes:menu` / `routes:switch` / `routes:unpin` are the channels; `switchModel` validates
(unknown route, disabled route, empty pool, session scope from the tray) and returns the refreshed menu
entry even on a refusal, so a refused click still repaints the truth. The shell's tray cannot call them: it
does not hold the management secret, so it publishes `shell:route-menu-request`, the page runs
`routes:menu` on its own transport and answers with `shell:route-menu`, and a click comes back as a
`shell:route-command` intent.
Both directions are gated on `event.sender === window.webContents`. The tray keeps three absences
distinct - no snapshot yet (console not opened), read failed (`snapshot.error`), no enabled routes - and
the tooltip names the route and the model that would serve, because an icon with a menu nobody opens
answers nothing.

Tests: `tests/routes/model-scope-pin-circuit.test.ts` (18 cases: trimming per scope, wall clock, pin vs
sticky, pin vs circuit, `pinMiss`, persistent preference, header pin, circuit trip/expiry/clear on the
*next* turn, all-circuited disabled, menu order and limit, switch reasons, tray session-scope refusal),
`tests/shell/tray-model-menu.test.ts` (artifact-level: menu shape, the three channels on both sides, sender
gate, the four label markers, three absences), `tests/ipc/routes-menu-wire.test.ts` (channel strings, the
`error` shape, unpin clearing both the pin and `preferredModel`). The older pool tests declare
`modelScope: 'pool'` explicitly, which is what they actually prove.

### Fallback-served prose-only stop (2026-11-13, the seventh degraded class)

`codex-deepseek` kept stopping mid-task while the client reported no error. Row
`chatcmpl-mwdt3j2s-d8em3q` is the shape: the sticky anchor held `minimax/MiniMax-M3.1-Flash`, that
candidate produced no first block inside the lowered first-round slice (504, `budgetElapsedMs` 1643,
`attemptDeadlineMs` 20000), the pool advanced to `loomy/spark-x2.6`, and the substitute spent 29 067 ms to
the first token and then returned **35 characters of prose, zero `tool_calls` deltas,
`finish_reason=stop`** - "我先看最近几次提交的改动面——新代码最容易藏缺陷。". The client treats a `stop`
with no calls as a finished turn, so the task ends there while the gateway records a success.

None of the six earlier classes catches it: content > 0 (not the empty turn), one line (the dedup ratio
says `notJudged: too_short`), the last character is `。` not `：` (not the announced stop), the client sent
no cap, and `codex-deepseek`'s pool produced no `latencyGateMs` reading for that request.

`streamOutcomePolicy.ts::isProseOnlyStopAfterStream` is deliberately **not** a judgement on the prose. A
one-line answer with no tool call is exactly what a healthy finish looks like, so judging it on its own
would penalise every normal turn. What carries information is that **the first choice failed**: the pool was
never really sampled. The predicate therefore fires only when `auto.attempts > 1` - `settleSticky` passes
`autoAttempts > 1` as the fourth argument - and it lifts only the anchor: no AIMD reading, no Bandit
sample, no account cooldown or failure. Turning the anchor over once re-ranks the next turn; if the
substitute really was the best answer, it wins the ranking again.

Tests: `tests/proxy/sticky-revoke-policy.test.ts` pins the live row shape in both directions
(`servedByFallback` true revokes, false does not) plus the four-part conjunction controls (zero content is
class ③, tool deltas disqualify, tools not offered disqualify, `client_gone` disqualifies, no reading
disqualifies); `tests/renderer/repetition-guard-wiring.test.mjs` pins the call site's fourth argument and
the policy term.

### Synthesized incomplete step (2026-11-13, the eighth degraded class)

The user reported `codex-deepseek` "always" triggering
`Incomplete response returned, reason: max_output_tokens` in Codex. Two readings killed the stated
cause: every `codex-deepseek` row carries **no `maxTokens`** (the client never set a cap), and the
frequency is 1 turn in 61 across both Codex histories, not "always". The cap story was never true.

**The real mechanism is in the channel pack.** `vendor/channel-pack/src/openai-compat.ts` reused DSH's
`{kind: 'max-tokens'}` as a generic "this step is incomplete, re-run it" signal for seven conditions
that have nothing to do with an output cap: tool-arg JSON truncated, required args arriving empty, an
unnamed tool call dropped, the connection cut before any `stop_reason`, tool chunks announced but never
finished, prose cut by an upstream stop string, and a reasoning loop. `openai-gateway/stream.ts` mapped
that kind to `finish_reason: 'length'`, `shared/responsesInbound.ts::statusOf` turned it into
`response.incomplete` + `incomplete_details: {reason: 'max_output_tokens'}`, and Codex ended the turn
with a token-limit message that named a limit nobody set. DSH's remedy ("let the harness retry the
step") cannot run here: `src/main/channelPack/worker.ts:343-350` streams exactly once and ModelPort has
no harness.

**The fix keeps DSH's vocabulary and adds a cause.** `sse.ts` exports `incompleteStep(cause)` returning
`{kind: 'max-tokens', incompleteCause}` - seven causes, one label each - and every producer that used
to collapse the OR now labels: `openai-compat.ts`, `buddy-adapter.ts`, `lobsterai-adapter.ts`,
`trae-adapter.ts`, `llm-adapter.ts`, `minimax-messages.ts`. `gemini-messages.ts` and `zcode-anthropic.ts`
keep the plain kind because those are genuine upstream `MAX_TOKENS`. At the projection boundary
`openai-gateway/stream.ts::incompleteStepError` turns a *labeled* reason into a 502
`data: {"error": {code: "incomplete_step", ...}}` frame before `state.finishReason` is written, so an
unlabeled `length` (a real cap) still projects as `finish_reason: 'length'` and nothing else changes.
The Responses lane renders that frame as `response.failed` with `response.error.code`, which is the
gateway's existing post-stream failure contract rather than a fabricated token.

**Routing consequence.** `streamOutcomePolicy.ts::modelQualityDegradation` gained a fifth vote
(`'incomplete-step'`, read from the SSE error code in `routes/chat.ts`), so class ⑧ trips the **model**
circuit - the only between-turn switching channel under 架构 A. `accountRuntime.ts::recordStreamOutcome`
gained `modelQuality`, which keeps an `endReason: 'error'` outcome with a model-quality cause out of the
congestion path: AIMD does not shrink (the account answered; the model did not finish), but the success
streak resets. Before this, the only judge that noticed was class ⑤, and it read the synthesized
`length` as an upstream output cap: the anchor got revoked and the row scored as a degraded success,
while the model that could not finish the job took no ticket at all.

**What this does not cover.** (1) No step-level retry exists, so a dropped tool batch still costs the
turn - the fix makes the next turn start elsewhere and makes the message truthful, it does not recover
the current one. (2) Failover only happens when the error frame is the *first* frame (`probeSseHead`);
once prose has streamed, the client sees `response.failed` mid-turn. Whether Codex auto-retries on
`response.failed` was not verifiable from the shipped binary and is deliberately not claimed. (3) The
pack's own Responses projector (`openai-gateway/responses.ts:666`) still maps the kind to `length`;
ModelPort's worker imports only `toOpenAiSse` / `collectOpenAiCompletion`, so that path is unreachable
from this product and was left alone rather than patched blind. (4) The **non-streaming** leg of the same
pack throws `OpenAiGatewayError(502, code: 'incomplete_step')` (`worker.ts` → `bridge.ts:310`
`ChannelBridgeError`), and that leg is recorded by the attempt-outcome path, where `isCongestionFailure`
reads a bare 502 as account congestion and shrinks AIMD. The `modelQuality` bypass exists only on the
streaming settle path - extending it means editing `forwarder.ts` / `failover.ts`, which were mid-rewrite
by another session at the time of this change.

### OpenCode: three lanes, one shipped

"OpenCode" names three unrelated things in this repo; only the third is live.

- **Retired 2026-11-01 - the builtin `opencode` provider (local runtime).** It spawned
  `opencode-ai@1.19.4` (npx fallback) and drove its loopback HTTP/SSE server. The subsystem is
  gone: `src/main/opencode/`, `providers/builtin/opencode.ts`, `proxy/adapters/opencode.ts`, the
  `providerForwarders` entry, the `runtimeModels` flag, the `runtime` branch of
  `modelListSource`, the endpoint-policy runtime exemption, the `opencode` entry in the tool-profile
  registry (that whole subsystem went on 2026-11-03 - see §Tool Calling), and the `opencode:*`
  capability-probe IPC slice. Why: the free
  lane validates the **client shape** (`User-Agent: opencode/<channel>/<version>/<client>` with
  major >= 2; a 1.x client is rejected with `403 FreeTierError`), while the npm `opencode-ai`
  line is frozen at 1.19.5 (zero 2.x versions) and `opencode.ai/install` refuses to install 2.x
  - so the runtime this app could distribute can never be a client the server accepts. Every
  envelope / `permission` / `invalid`-tool finding that used to be documented here was read off
  1.19.4 line by line and is **not** re-verified against 2.x (whose `packages/opencode/src/server`
  no longer even exists); git history has them.
- **Aggregate entries `opencode_zen` (`/zen/v1`) and `opencode_go` (`/zen/go/v1`)** - keyed HTTP,
  unrelated to the runtime, unchanged.
- **The account channel `opencode`** (see "Account Channels") - the channel pack's own v2-shaped
  lane at `https://opencode.ai/inference`: anonymous slots need no credential, a pasted key
  unlocks paid models, and each account can carry its own exit proxy because the free lane is
  capped per source IP. Probe 2026-11-01 from this machine: `GET /inference/v1/models` -> 200,
  `POST /inference/v1/chat/completions` -> `429 FreeUsageLimitError` + `retry-after`. The 403/429
  split is the whole diagnosis: 403 means the client shape was rejected, 429 means the shape
  passed and this exit IP's anonymous allowance is spent. Onboarding the lane makes OpenCode
  reachable and honestly labelled, not immediately usable.

### IPC Communication
All main-renderer communication uses IPC channels defined in `src/main/ipc/channels.ts`. The naming convention is `domain:action` (e.g., `proxy:start`, `accounts:add`).

### Tool Calling (native passthrough only)

`tools` / `tool_choice` / `parallel_tool_calls` travel as the client sent them: `buildRequestBody`
whitelists all three (after `sanitizeChatToolDefinitions` drops unusable definitions, e.g. Codex's
empty-name placeholders), and the reply is forwarded as-is - upstream produces the `tool_calls`, the
client executes them and sends the results back. Nothing in the gateway rewrites either side.

Since 2026-11-04 there is one observation-only exception on this path. When a request declared at
least one tool and the reply carries a `tool_calls[].function.name` outside that declared set,
`routes/chat.ts` writes a `warn` app-log line (serving model, offending names, up to 12 declared
names, `request_id`) through `utils/undeclaredToolNameAudit.ts`. It never validates, drops or
rewrites a byte - the client receives exactly what upstream produced. The line exists because the
request log does not record tool names, so a client-side `Model generated invalid tool call: <name>`
was otherwise indistinguishable from a gateway truncation. One line per `(model, name)` per 5
minutes, so a client retry loop cannot flood the app log. `/v1/messages` and `/v1/responses` need no
hook of their own: both translate inbound tools into chat `function` definitions (names kept verbatim)
and loop back through this same route, so one check covers all three entry points. `/v1/completions`
bypasses the chat route but has no `tool_calls` in its response shape, so it is out of scope.

The managed layer that used to render tool descriptions into a `system` turn and parse text replies
back into `tool_calls` (`src/main/proxy/toolCalling/`, `src/shared/toolCalling.ts`,
`config.toolCallingConfig`, `ToolCallingPanel`, `POST /v1/management/tool-calling/smoke`) was retired
on 2026-11-03 together with the ruling in §Gateway-Authored Text Reaching the Model. What covered the
"model behind this channel has no tools" case was never the prompt: `autoRouting::buildRequestProfile`
sets `needsTools` from the inbound `tools` array and `hardFilterFailure` drops candidates whose
capability says `tools: 'no'`; when every candidate says `no`, the 503 states `missing: ['tools']`.
`services/promptInjectionService.ts` and `proxy/prompt/` mentioned by older revisions of this
document no longer exist.

### Session Management Flow
Context continuity travels in the request itself: the forwarder hands the client's message history
to the provider adapter, which maps it onto that provider's conversation primitives. There is no
server-side session table: the `sessionManager.ts` store-backed table, its 60s sweeper, the
`session:*` IPC channels and the delete-after-chat switch were removed on 2026-11-11. Nothing had
populated the table for years, so the switch never had an effect - `data.json` no longer carries a
`sessions` key and `config.sessionConfig` is stripped on read. `/v1/management/sessions` still
answers 501, now for the same reason the code does: the concept does not exist.
A `sessions` key left behind in a pre-1.8.3 `data.json` is dropped on the next start
(`store.ts::dropRetiredTopLevelKeys` over `keyMigration.ts::retiredTopLevelKeys`).

### Main-Process Console Output
Neither packaged host has a terminal, so a bare `console.error` is a stream nobody reads. Both
install one bridge - `shared/logging/consoleBridge.ts`, which keeps the original console call and
hands a redacted, truncated copy to the sink its host injects:

- the gateway (`gateway/bootstrap.ts`) sends it to `storeManager.addLog`, so it lands in the app
  log the UI shows and a diagnostic bundle exports;
- the console app (`src/shell/consoleLogSink.ts`) appends NDJSON to `<userData>/logs/console.ndjson`,
  capped at 2 MB with one rotated sibling, because the console owns no gateway store and
  `tests/build/shell-entries.test.ts` fences it out of `src/main` imports.

The bridge lives under `shared/` for exactly that reason, as `shared/certificateTrust.ts` does. Two
rules follow from it: a sink reports its own failures on `process.stderr` and never through
`console.*` (that is a self-sustaining loop - `appLogs/manager.ts` and the shell sink both do this),
and only `error`/`warn` are captured, because `info`-level console output is startup narration and
would flush the log list.

## Public API Contract

- Auth is fail-closed: once any enabled API key exists, `/v1/*` always requires it
  (`Authorization: Bearer` or `X-API-Key`; `?api_key=` is no longer read, and comparison is a
  constant-time digest compare). With no key configured the server only binds a loopback host
  (`127.0.0.1` / `::1` / `localhost`) and `start()` refuses anything else; CORS `*` is sent only in
  that key-less loopback mode.
- Config writes validate `apiKeys`, `proxyHost`, `enableApiKey`; `/v1/management/proxy/start` and
  `/restart` reject non-loopback hosts with `invalid_host`.
- Errors use OpenAI shapes: 401/403 → `authentication_error`, 429 → `rate_limit_error` plus
  `Retry-After` (and the account is penalised), other 4xx → `invalid_request_error`, 5xx →
  `api_error`. A failure after the stream started is an `data: {"error": ...}` frame, never
  assistant text, and every stream carries exactly one `[DONE]`.
- **A provider's own content-policy refusal is forwarded, never rewritten or routed around.** Bailian
  answers a request whose image it refuses with 400 `data_inspection_failed` and `[Input image [0]
  data may contain inappropriate content.]` (measured 2026-11-07: six rows on
  `bailian_token_plan/deepseek-v4.1-flash`, 3.5-5.6 s each, the client retrying the same turn). The
  upstream status, `type`, `code` and message reach the client untouched
  (`errorMapping.ts::mapForwardFailure`; pinned by `tests/proxy/error-fidelity.test.ts`), and this
  class is deliberately **not** in the failover exceptions: switching provider would reroute the
  user's bytes around a moderation verdict this gateway is not entitled to overrule, and the next
  candidate receives the same picture. What the gateway *can* decide is which models may see an
  image at all - that is the existing `needsVision` hard filter (`autoRouting.ts::hardFilterFailure`
  drops a candidate whose `vision` is not `'yes'`), which never applies to a request naming one
  model directly.
- `usage` is `null` unless the upstream reported real token counts; it is never fabricated.
- History trimming never empties the history: `TokenLimitStrategy` always keeps the newest
  non-system message, even when that message alone exceeds `maxTokens` (and even when the system
  prompt by itself does). Shipping `messages: []` is not "compression" - the account-channel gateway
  rejects it with `messages must be a non-empty array`, which reads to the client as "you sent no
  messages" rather than "your message was too long" (reproduced live 2026-11-01 at `maxTokens: 8000`:
  24 000 chars 200, 26 000 chars 400). `estimateTokens` here is `ceil(length / 3)`, deliberately not
  the CJK-aware estimator the router uses.
- Built-in providers silently drop `response_format`, `stream_options`, `logit_bias`, `seed`,
  `max_tokens`, `top_p`, `stop`, `frequency_penalty` and `presence_penalty` in
  `proxy/parameterPolicy.ts`, because OpenAI-compatible clients send them by default and a `400`
  would take the whole client offline; only `n > 1` changes the response shape and still returns
  `400 unsupported_parameter`. Custom and aggregate providers keep passing all of them through.
  No endpoint exposes a token-limit field or a truncation signal, so the proxy never fabricates
  one and can never emit `finish_reason:"length"` on its own.
- The output cap arrives under either spelling, and the entry folds them together
  (`utils/outputCap.ts::normalizeOutputCap`, called from `routes/chat.ts` next to the role fold).
  Codex-family clients (DSH, Codex CLI) send **only** `max_completion_tokens` - DSH picks that
  spelling for any baseUrl outside its own host whitelist, which a loopback proxy always is - while
  every downstream builder reads `max_tokens`: the chat-wire whitelist, the anthropic wire's
  `max_tokens`, the responses wire's `max_output_tokens`. Unfolded the cap is not rejected, it is
  silently dropped, so upstream truncates at its own default (4096 on the anthropic wire) and the
  client's only signal is `finish_reason:"length"` - "已达到输出 token 上限", though no allowance
  was ever spent. Account channels never showed the symptom because the pack worker reads both
  spellings itself; that is also why the bug only reproduced on `auto`, whose pool leaves the worker.
  Alias wins when both are sent - same order as the worker and the request log's `maxTokens`.
  The anthropic wire's required `max_tokens` is no longer a code constant either: when neither the
  client nor `provider.modelParameters` supplied a cap, `forwarder.forwardChatCompletion` fills
  `config.defaultMaxOutputTokens` (`utils/outputCap.ts::ensureAnthropicOutputCap`, edited under
  高级设置, `outputCapFallbackOf` accepts positive integers only and falls back to
  `DEFAULT_MAX_OUTPUT_TOKENS` = 4096). The setting is **absent by default** and the renderer keeps
  no copy of that number - a second literal in the UI would save a stale default into the store
  the day the authority changes. Other wires are left uncapped on purpose: no cap there means "the
  upstream decides", which is not a number we invented.
- A `tool_choice:"required"` / forced call that the model did not make is reported on the
  non-stream response as `X-ModelPort-Tool-Violation: required`, and in streaming mode as an
  additive `x_modelport_tool_violation: "required"` field on the finish chunk (clients that ignore
  it see an unchanged stream).
- Every `/v1/*` response carries `X-Request-Id`; it matches the request log row.
- Response headers that carry dynamic text (the `auto` winner in `X-ModelPort-Route` via
  `utils/headerValue.ts::routeHeaderValue`, `X-ModelPort-Aggregate-Chain`) go through
  `toHeaderValue`. Node validates header values as Latin-1 and throws `ERR_INVALID_CHAR`
  (`Invalid character in header content [...]`) on any character above `0xFF`; eight
  account-channel names contain Chinese (`TRAE (字节)`, `Qoder (中国版)`, …) and custom provider
  names are user-typed, so interpolating them raw turned a successful auto route into
  `500 {"type":"internal_error"}`. ASCII-only values pass through unchanged; anything else is
  percent-encoded per UTF-8 byte (so `decodeURIComponent` restores it, and CR/LF can never
  inject a header).
- `/v1/models` advertises **routes and nothing else**: one entry per enabled name in
  `AppConfig.routes`, `owned_by: auto-router`, in the order `store/modelRoutes.ts::enabledModelRoutes`
  sorts. `GET /v1/models/:model` uses that same name domain - a single model or a user alias gets
  `404 model_not_found`, because answering a name on the retrieve endpoint that the list refuses to
  advertise is how a gateway ends up with two contradictory catalogs. Whether a model is enabled
  therefore no longer decides what a client can *list*; it decides whether that model sits in any
  route's candidate pool (`store/modelServing.ts::applyServed` -> `userModelOverrides.excludedModels`,
  read back as the served slice by `store.ts::getEffectiveModels`) and whether a request naming it
  directly is accepted (`loadbalancer.ts::providerSupportsModel` through `isModelRoutable`, and
  `routes/messages.ts::gatewayKnowsModel` on the anthropic entry). A disabled user **alias** is stored
  on the mapping row itself (`ModelMapping.disabled`, declared twice: `shared/types.ts` and
  `main/store/types.ts`), because an alias belongs to no provider catalogue and `excludedModels`
  cannot record it; the gate is `store/modelServing.ts::isMappingActive`, and every read path must go
  through it - the one that forgets serves a name the user turned off. The per-provider and per-alias
  entry loops plus `contextWindowOf` and `aliasMappingKeys` were retired with this change, since no
  other consumer survived them.
- `context_window` on both endpoints is present **only when it can be proved**, never `0` and never a
  guessed default, because clients time their own compaction off this number and an over-stated
  ceiling turns into a hard upstream rejection. Route
  entries (`auto` plus every enabled `AppConfig.routes` name) carry the **smallest window among the
  candidates that route can actually serve** - `autoRouter::advertisedContextFloor(route)` (and
  `advertisedContextFloors(routes)` for the list, one pool walk for all routes) feeding the pure
  `autoRouting.ts::advertisedContextFloorOf`. Rules that keep it truthful: it is a floor, never an
  average (a route can land on any candidate in its own pool, so a number above the smallest one is
  a lie); **only readings that cannot over-promise participate** - upstream-published values, manual
  marks, and the measured lower bound recorded by `probe` (we proved that tier fits, so it can only
  report low) - while a family-rule or standard-catalogue single-point claim may be stale or simply
  too high, so it stays internal. Adopted catalogue values reach the public surface only by being
  re-entered as a manual mark, never by widening this gate; and a route whose candidates
  published none omits the key instead of advertising a guess. The earlier rule - an un-annotated
  candidate counted as `UNANNOTATED_CONTEXT_FLOOR` (64000), the same number the admission filter used
  - was a lie in the other direction and is what broke long agent sessions: Codex reads
  `context_window`, multiplies by 0.95 and sets its compaction point at 64000, so a real pool of
  200K-window models made it rewrite a 45-turn conversation into a hand-off summary at ~260K
  characters and tell the model the earlier turns no longer counted, which is the "no previous task to
  continue / repeated verbosity" the user reported; an un-annotated candidate may still be too small,
  and that case is now paid for with one pre-generation round trip (the context-class 400 switches to
  the next candidate) rather than with a fabricated ceiling; it is computed on **that route's** pool
  after `poolStrategies` and the manual
  include/exclude (candidates those steps drop no longer participate, which is why a route pinned to
  big-window models advertises that window instead of the global worst case; a pool narrowed to one
  model reports that model's own window); transient state (cooldown, quota, daily limit) is
  deliberately not deducted - `collectCandidates` takes `ignoreTransientAvailability` for exactly
  this - because a number that shrinks between requests is worse than a conservative one. An empty
  pool omits the key, which is the same route's own 503 rather than somebody else's window.
- The static floor cannot cover the case it exists for most: a route switching to a smaller model
  mid-conversation. So every routed response also carries `X-ModelPort-Context-Window` -
  `AutoRouteDecision.advertisedContextWindow`, the serving candidate's own window **after the same
  source gate**, set in `routes/chat.ts` and `routes/completions.ts`; the loopback anthropic and
  responses lanes inherit it through `utils/inboundLoopback.ts::copyModelPortHeaders` (prefix rule),
  and it is a header rather than a rewritten body `model` on purpose - clients key caches, pricing and
  their own model tables off that field, so replacing it with the upstream name breaks them and leaks
  channel identity. `decision.contextWindow` sits next to it **ungated** for logs and the UI, where an
  inferred value is useful; wiring the header to that field instead is the regression this line guards.
  A client that ignores custom headers is unaffected - the inbound hard filter still keeps the request
  off candidates that cannot hold it, and that half needs no client cooperation at all.
- Every request row also carries the **fit reading**, not just the outcome: `inputTokensEstimate`,
  `modelContextWindow`, `contextFit` (`fits` / `overflow` / `unknown`) and `contextFitSource`
  (`measured` when the verdict came from an upstream context-class 400 rather than our own estimate),
  produced by `shared/requestContextFit.ts::readRequestContextFit` and attached in
  `routes/chat.ts::contextReadingFor`. "The channel said it was too long" and "we guessed it was too
  long" must be distinguishable after the fact, because the first is a failover reason and the second
  is a bug in the estimate.
- Tool call ids are `call_<requestId>-<n>`. Managed markup that fails to parse is stripped from
  content while the surrounding text is preserved. The anthropic wire maps upstream `tool_use`
  blocks to native OpenAI `tool_calls`.
- `/v1/management/sessions*` is retired and answers 501: there is no server-side session table.

### HTTPS Listener and Certificate Trust

The proxy can run a TLS listener (`httpsPort`, default 8443) beside the HTTP one; both serve the same
Koa app. The presented certificate is either a custom PEM pair (`httpsCertPath` + `httpsKeyPath`,
all-or-nothing) or the managed self-signed one in `~/.modelport/tls/server.crt|server.key`, issued for
397 days, renewed inside the last 7 days and reissued whenever a host the clients actually connect by is
missing from its SAN (`proxy/tls.ts::loadTlsMaterial`).

* **Trust has two consumers, and `TlsStatus.trusted` only answers the first one.**
  `installCertificateTrust()` writes the *OS* store (`certutil -user -addstore Root` on Windows,
  `security add-trusted-cert` on macOS). Chromium/Schannel clients - Claude Desktop, browsers, Windows
  `curl` - read that store. **Node-based clients never do**: Codex CLI, the WorkBuddy/CodeBuddy agent
  and anything built on `node:https` or undici use Node's bundled CA set plus `NODE_EXTRA_CA_CERTS`.
  A green "Trusted" badge therefore does not mean a given client can connect. The settings panel prints
  the copyable `NODE_EXTRA_CA_CERTS=<certPath>` line next to it, and
  `GET /v1/management/tls/ca` hands the same PEM (certificate only, never the key) to a machine that is
  not this one. Measured 2026-11-03: WorkBuddy against `https://<lan-ip>:8443` produced 142 failed model
  calls, every one `DEPTH_ZERO_SELF_SIGNED_CERT`, while the very same certificate sat in
  `CurrentUser\Root` and `curl` on that machine shook hands fine. Diagnosing that from the gateway side
  was impossible - there was nothing to read.
* **A handshake the client refuses is the only client failure that produces no request row.** No route
  runs, so there is no request-log row, no `X-Request-Id`, no attempt list - the user sees "network
  error" and the gateway looks idle. `httpsServer.on('tlsClientError')` feeds
  `proxy/tls.ts::createHandshakeRejectionTracker`, which counts per OpenSSL code, writes one app-log line
  per code per 30s window (that client alone produced 567 identical failures in eight minutes), and
  exposes the numbers as `TlsStatus.handshakeRejections` - in the panel and through
  `GET /v1/management/tls/status`. Counting begins at the listener start and the counter is dropped when
  the listener stops, so a stopped listener never shows a stale "still refusing".
  `isCertificateRejection` is the classifier: a protocol failure (`ERR_SSL_WRONG_VERSION_NUMBER`,
  `EPROTO` - usually an HTTP client aimed at the HTTPS port) must not be worded as a trust problem,
  because the fix is different.
* Never report a client as working on the strength of the trust flag; the honest evidence is a handshake
  that turned into a request row.

## Gateway-Authored Text Reaching the Model

Ruling (2026-11-03, 用户拍板): the gateway writes **no** prompt text into a user's conversation. What is
left below is the residue that survives that ruling because it is not a claim about the user's intent -
a self-describing compression marker and probes that never enter a conversation. Anything else must be
retired, not documented.

**Amendment (2026-11-12, 用户拍板)**: the ruling is lifted for exactly two blocks, `ccr-protocol` and
`say-less-contract`. Both are *protocol* text, not task text: the first describes what this gateway's
own markers mean, the second states an output shape the user selected in settings. Three conditions
are enforced in `src/main/proxy/gatewayText.ts` rather than promised here:

* the block arrives as its **own leading `system` message** - the client's system prompt is never
  edited, appended to, or replaced. The 2026-11-03 `trailing-user-guard` wrote a `user` turn and the
  model echoed it back as its own opening line in 36 of 267 reasoning blocks; a `system` block cannot
  be mistaken for the user's words in the same way, and it is the shape a client can visibly see;
* the text is **byte-identical on every turn of a conversation**, so the prefix cache sees the same
  bytes again. Both blocks are pure functions of their inputs;
* neither block is ever on by default for traffic that does not need it. `ccr-protocol` is present from
  the first turn a conversation is compressed and remembered for the rest of it
  (`gatewayProtocolMemory.ts`), because the block is prepended: if it appeared only on compressing turns
  and vanished on the others, its presence would rewrite the first bytes of the prompt and drop the
  entire cached prefix on every flip. A conversation that never compresses pays zero. `say-less-contract`
  needs an explicit level, only applies to requests that carry `tools`, and is circuit-broken per
  `(provider, model)` by `outputContractGuard.ts` when the target is already producing degraded turns.

Anything beyond these two is still retired by the 2026-11-03 ruling.

Anything the gateway writes into an outbound request is a claim on the user's behalf, and it is
also text the model can echo back into the conversation. Every such site carries a
`GATEWAY-TEXT: <id>` tag at the point of injection, and `tests/proxy/gateway-authored-text.test.ts`
fails if a tagged site is missing from this table or a table row has no tag. Provenance below is
`git log -S` on the literal, not recollection.

| id | what it writes | provenance | why it exists |
| --- | --- | --- | --- |
| `ccr-sentinel` | appends `… N more items <<ccr:hash …_items_offloaded>>` / `[N lines compressed to M. Retrieve more: hash=…]` inside tool results | `9d07417` 2026-10-30, 刘小平 | compression that stays honest about itself: the marker is the retrieval pointer, and re-compressing a payload that already carries one is never correct. |
| `liveness-ping` | `messages:[{role:'user',content:'ping'}]` with `max_tokens:1` | `ddc566a` 2026-10-30, 刘小平 | catalogue liveness probe; never part of a user conversation. Two call sites share the id: `aggregateProviderManager.testModel` (aggregate detail page) and `providers/modelTest.ts` (the Models page "test" button). The latter carries `probe: true`, so it never enters the dispatch ledger, AIMD admission, Bandit or cooldowns. |
| `probe-context` | `buildContextProbePrompt()`: repeats `probe ` to push the input to a target token tier | `2026-11-04` 探测阶梯 | context-window ladder probe; carries `probe: true`, so it never enters a client conversation, never counts toward AIMD/Bandit, and is excluded from success statistics. |
| `probe-output` | `Write the word "ok" repeated on a single line until you are stopped. Do not stop on your own.` | `2026-11-04` 探测阶梯 | output-cap ladder probe: asks the model to keep going so `max_tokens` is the only stop reason; same `probe: true` isolation. |
| `probe-capability` | `Reply with the single word ok.` (tools) / `What color is this pixel? One word.` (vision) | `2026-11-04` 探测阶梯 | capability probe for `tools` / image input acceptance; same `probe: true` isolation. A one-pixel PNG rides the vision request, but the only authored text is the two short prompts above. |
| `ccr-protocol` | a leading `system` block naming `<<ccr:hash>>` / `Retrieve more: hash=` and the retrieval endpoint `GET /v1/ccr/<hash>` | `2026-11-12` 裁定放开 | without it the marker is a pointer the model cannot follow: retrieval used to sit behind the management secret (off by default) and the original bytes were swept after 30 minutes. Injected only when the conversation carries a marker, and again byte-identically on every later turn. |
| `say-less-contract` | a leading `system` block asking for a shorter answer (`concise` / `minimal`) | `2026-11-12` 裁定放开 | output tokens are the expensive side. Default off, opt-in per level, only on requests that carry `tools`, and withdrawn per `(provider, model)` once two degraded turns appear in the newest eight (`outputContractGuard.ts`). |

### Retired, with the evidence that retired it

A retired site keeps its id here — never in the table above, which the gate reconciles against the
live `GATEWAY-TEXT:` tags — so the provenance survives without pretending the code still does it.

* **`trailing-user-guard`** — retired 2026-11-03 under the ruling 本网关不注入任何提示词. It appended a
  **user** turn 「继续执行上一条消息中的任务，直接开始，不要向我确认。」 whenever the outbound sequence ended
  with `role:"tool"`. Provenance: `fb720f9` 2026-11-01, written while chasing the report named in its
  own commit subject ("VS Code agent 第 2 轮装死"), moved into `doForward` by `cb49a5c`, trigger narrowed
  by `c28c6c4` — all 刘小平. It is the reason this section exists: it was the only site added during
  troubleshooting and the only one whose text came back at us. In the 2026-11-03 WorkBuddy session 36 of
  267 reasoning blocks contain the sentence verbatim and 32 open with 「用户要求继续执行…」 — the model
  restates our imperative as its own opening line, the client stores that line, and the next turn opens
  the same way, which lowers the trailing-window dedup ratio the same session was later aborted on.
  Two things to keep straight about the removal:
  * The cost is the shape it papered over — large `system` × trailing tool result → an empty or
    asking-back reply. `7/10` was a **single-point measurement** (one provider, one model, n=10 on
    2026-11-01) against a `0/15` control on the same body with the line appended; it is not a settled
    rate, so do not re-cite it as one. What replaces injection is observation: `streamTrace.repetition`
    degrades and unpins the sticky anchor instead of the gateway speaking for the user.
  * Attribution lesson (still true for any synthetic turn anyone is tempted to add again): a turn the
    gateway writes exists only in the outbound request, so the client cannot show it and grepping
    `requestBody` counts **history**, not injections — once the sentence entered history it appeared in
    every later body, which is how 146 rows were misread as 146 injections. Per-request counters
    (`record`/`take`, the `compression/duplication.ts` shape) are the only honest form.

* **`managed-tool-prompt`** — retired 2026-11-03, the same ruling. It prepended a **system** turn
  (`## Available Tools … you can invoke the following tools …`) and **removed `tools` from the request**,
  then parsed the reply text back into `tool_calls` on both the non-stream and the stream path.
  Provenance: `aee98eb` 2026-03-02 (upstream `xiaoY233`, "Function Calling simulation for non-native
  models"), redesigned as the protocol set by `04e7ad2` 2026-05-08 — an upstream feature, not
  incident-driven. Whole subsystem gone: `src/main/proxy/toolCalling/`, `src/shared/toolCalling.ts`,
  `config.toolCallingConfig` (plus the pre-v2 `toolPromptConfig` migration), `ToolCallingPanel`,
  `POST /v1/management/tool-calling/*` and `tests/tool-calling/`. Tools now travel natively on every
  lane and the only "this model has no tools" handling is routing (`needsTools` → `hardFilterFailure` →
  `missing: ['tools']`), which is what the retired prompt was imitating.
  The parser that prompt fed was left behind in `proxy/stream.ts` and survived the retirement until
  2026-11-08: it buffered any content delta whose trailing text was a prefix of `[function_calls]`
  (`[` alone was enough), forwarded nothing while buffering, and swallowed the upstream
  `finish_reason` frame (`if (!isBufferingToolCall)`), so a prose answer containing a markdown link
  ended the stream with no stop reason — Qoder read that as `code=500` (「系统发生异常」) on every
  session-closing turn while mid-turn tool calls stayed clean. The buffer, the flush-time parse and
  the non-stream parse are gone along with `proxy/utils/toolParser*`; a text marker is now model
  prose like any other, and `tests/proxy/stream-finish-frame.test.ts` pins the finish frame.
  **Registry-scope lesson, kept because it generalises:** this prompt became far broader than its author
  intended without any commit touching its own text. `70ec39b` 2026-11-01 retired the OpenCode runtime,
  which deleted the only member of `providerProfiles`, so the fallback profile (`managedSupport: true`,
  `handlesToolsItself` unset) silently came to cover **every** provider — from then on the March-2026
  prompt was injected on every chat lane except account channels, Anthropic adapters and the Responses
  wire. Retiring one entry from a registry that has a default can flip the scope of a whole subsystem;
  read the fallback, not just the registry, before assuming a mode is narrow.
* **`output-steering`** — retired 2026-11-03, same ruling. It appended a sentinel-wrapped
  (`<modelport_output_shaping>…</modelport_output_shaping>`) **system** block of style instructions in
  three levels, to spend fewer completion tokens. Provenance: `9d07417` 2026-10-30, 刘小平 — ported from
  the compression work's headroom analysis, opt-in and `enabled:false` in the field, so retiring it costs
  no behaviour anyone was getting. The savings it chased are still available on the input side
  (`compression`, live-zone only); what it could not avoid is being a sentence the gateway wrote on the
  user's behalf, in every system prompt, cache-pinned for every install. Whole surface gone:
  `proxy/compression/outputSteering.ts`, `store/outputSteeringConfig.ts`, `config.outputSteering`,
  `OutputSteeringSettings` and its i18n block. The **goal** returned under the 2026-11-12 amendment as
  `say-less-contract`, in a different shape: a leading system block, default off, `tools`-only, and
  circuit-broken by the degradation window. Do not resurrect `output-steering` itself (no
  `outputSteering` config key, no settings panel re-export) - a renamed return of the retired shape is
  the failure this ledger exists to prevent.
* **`context-summary-prompt`** and **`context-summary-marker`** — retired 2026-11-03 as one feature (the
  Summary Compression strategy). Provenance: `8e744ec` 2026-03-31 (upstream). The prompt was the system
  turn of a **second, gateway-initiated model call** on the user's own history; the marker was
  `[Conversation Summary]\n…` pasted back as a `system` message replacing the summarised turns — i.e.
  the gateway both authored prose and made it look like the conversation's own system prompt. `enabled`
  defaulted to false in the field, and the `summaryPrompt` setting let a user type arbitrary text into
  that turn. What survives is deletion-only trimming: `slidingWindow` and `tokenLimit` keep their
  behaviour (including the invariant that trimming never empties history). `normalizeContextManagementConfig`
  drops a stored `strategies.summary` and filters `summary` out of `executionOrder`, so an upgraded
  `data.json` cannot resurrect it; the gate is `tests/proxy/context-summary-retired.test.ts`.

## Data Storage

Application data lives in `~/.modelport/`. The Electron profile directory is pinned to
`<appData>/modelport` by `app.setPath('userData', ...)` in `src/main/index.ts` and must stay pinned:
`safeStorage` seals `store.key` and every credential against that profile, so letting the path follow
`package.json`'s `name` (which is what Electron does by default) makes an existing install unreadable
the moment the package is renamed.

- `data.json` - one electron-store file holding config, providers, accounts, statistics and
  app logs (there is no separate `providers.json` / `accounts.json`). Its `userModelMarks` key is the
  manual capability annotation table (`providerId -> displayName -> hint`), kept out of
  `userModelOverrides` so a model sync cannot erase a user's correction.
- `store.key` - this install's data key, sealed by the OS keystore
- `system-prompts.orphaned.json` - written once by the first start after the prompt library was
  removed: whatever a user had saved is moved here and the `systemPrompts` key is dropped
- `request-logs/` - detailed request logs
- `quota-ledger.json` - aggregate free-quota counters (per provider/account/model, rolling minute
  and 24h windows plus a UTC month) and the caps learned from upstream responses
- `channel-pack/` - the channel pack's own state (its account pool, whatever the upstream pack
  writes under `DSH_CHANNEL_PACK_STATE_DIR`) plus `credentials.json`, which holds the login
  credentials handed to the worker, one encrypted value per account

Credential protection has two layers, both with known limits: the store file is encrypted with a
random per-install key kept as `store.key`, sealed by the OS `safeStorage` (`resolveEncryptionKey()`
in `src/main/store/store.ts`), and individual credentials use `safeStorage` again. If `safeStorage`
is unavailable there is no key to bind to the machine, so the data file is written unencrypted and
only a console warning is logged.

Key migration and its edges: a `data.json` written by a release that still used the compiled-in
`chat2api-fixed-encryption-key-v1` is migrated on first start - read with the legacy key, copied to
`data.json.pre-key-migration.bak`, rewritten under the new key, then verified by comparing the
payload (`src/main/store/keyMigration.ts`). Any failure restores the backup and removes the key file,
so a half-finished migration never replaces real data with an empty store; for the same reason startup
refuses the "corrupted data" recovery path (which moves `data.json` aside) when a key file exists and
the data file predates this run. A missing `data.json` is not treated as a fresh install: startup
looks for `data.corrupted.<ts>.json` / `.pre-key-migration.bak` copies (newest first) and puts the
first readable one back - as-is when it is already under this install's key, re-encrypted when it is
a fixed-key file - so a downgrade-and-upgrade round trip recovers instead of starting empty. Downgrading to a release from before this change cannot read the new
file: it treats it as corrupt and moves it to `data.corrupted.<ts>.json`, so the data is recoverable
but not transparently.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron 33+ |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| Build | Vite + electron-vite |
| Server | Koa |

## Coding Guidelines

### Immutability (CRITICAL)
ALWAYS create new objects, NEVER mutate existing ones. Use `update` functions that return new copies.

### Error Handling
Handle errors comprehensively:
- Validate all user input before processing
- Provide user-friendly error messages in UI-facing code
- Log detailed error context on the server side
- Never silently swallow errors

### Input Validation
Validate at system boundaries (user input, external APIs). Use schema-based validation where available.

### Security
- Validate all API keys before use
- Sanitize all user inputs
- Never trust external data (API responses, user input, file content)
- Rotate any exposed secrets immediately

## macOS Development Note

A workaround is applied for V8 JIT compiler crash on macOS ARM64 (Electron 33 bug):
```typescript
app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')
```
This trades some performance for stability.

## Adding a New Provider

### Overview

Adding a new provider requires modifications across 4 layers: Provider Config, OAuth Authentication, Proxy Adapter, and UI. The following guide covers all necessary steps.

### Core File Modification Checklist

#### 1. Provider Config Layer (Required)

| File | Purpose |
|------|---------|
| `src/main/providers/builtin/<provider>.ts` | Provider configuration definition |
| `src/main/providers/builtin/index.ts` | Register in `builtinProviders` array **and** `builtinProviderMap` |

#### 2. OAuth Authentication Layer (Required)

| File | Purpose |
|------|---------|
| `src/main/oauth/adapters/<provider>.ts` | OAuth adapter implementation |
| `src/main/oauth/adapters/index.ts` | Register in `createAdapter()` and `getSupportedAuthMethods()` |
| `src/main/oauth/types.ts` | Add to `MANUAL_TOKEN_CONFIGS` (optional) |

#### 3. Proxy Adapter Layer (Required)

| File | Purpose |
|------|---------|
| `src/main/proxy/adapters/<provider>.ts` | Proxy adapter implementation |
| `src/main/proxy/adapters/<provider>-stream.ts` | Only if you want a separate stream handler file (no shipped provider does; all keep the handler class inside the adapter) |
| `src/main/proxy/adapters/index.ts` | Export adapter |
| `src/main/proxy/forwarder.ts` | Add `forward<Provider>()` method **and** one entry in the `providerForwarders` registry |

#### 4. UI Layer (Required)

| File | Purpose |
|------|---------|
| `src/renderer/src/i18n/locales/zh-CN.json` | Chinese translations |
| `src/renderer/src/i18n/locales/en-US.json` | English translations |
| `src/renderer/src/components/providers/ProviderCard.tsx` | Add icon mapping |
| `src/assets/providers/<provider>.svg` | Provider icon file |

### Step-by-Step Implementation

#### Step 1: Provider Configuration

```typescript
// src/main/providers/builtin/<provider>.ts
import type { BuiltinProviderConfig } from '../../store/types'

export const providerConfig: BuiltinProviderConfig = {
  id: 'provider-id',
  name: 'Provider Name',
  type: 'builtin',
  authType: 'userToken',  // See AuthType section below
  apiEndpoint: 'https://api.example.com',
  chatPath: '/chat/completions',
  headers: {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Origin': 'https://example.com',
    'Referer': 'https://example.com/',
  },
  enabled: true,
  description: 'Provider description',
  supportedModels: ['Model-1', 'Model-2'],
  modelMappings: {
    'Model-1': 'model-1-id',
    'Model-2': 'model-2-id',
  },
  credentialFields: [
    {
      name: 'token',
      label: 'Token',
      type: 'password',
      required: true,
      placeholder: 'Enter token',
      helpText: 'How to get token',
    },
  ],
  tokenCheckEndpoint: '/api/user',    // Optional
  tokenCheckMethod: 'GET',            // Optional
}

export default providerConfig
```

#### Step 2: Register Provider

```typescript
// src/main/providers/builtin/index.ts
import providerConfig from './provider'

export const builtinProviders: BuiltinProviderConfig[] = [
  // ...existing
  providerConfig,
]

export const builtinProviderMap: Record<string, BuiltinProviderConfig> = {
  // ...existing
  'provider-id': providerConfig,
}

export { providerConfig }
```

**CRITICAL**: `builtinProviders` and `builtinProviderMap` in this file are two separate literals and
both must be updated. `src/main/store/types.ts` re-exports them as `BUILTIN_PROVIDERS`, so it needs
no edit.

#### Step 3: OAuth Adapter

```typescript
// src/main/oauth/adapters/<provider>.ts
import axios from 'axios'
import { BaseOAuthAdapter } from './base'
import { OAuthResult, OAuthOptions, TokenValidationResult, AdapterConfig } from '../types'

const API_BASE = 'https://api.example.com'

export class ProviderAdapter extends BaseOAuthAdapter {
  constructor(config: AdapterConfig) {
    super({
      ...config,
      providerType: 'provider-id',
      authMethods: ['manual'],
      loginUrl: API_BASE,
      apiUrl: API_BASE,
    })
  }

  async startLogin(options: OAuthOptions): Promise<OAuthResult> {
    await shell.openExternal(API_BASE)
    return {
      success: false,
      providerId: options.providerId,
      error: 'Please log in via browser and enter Token manually',
    }
  }

  async validateToken(credentials: Record<string, string>): Promise<TokenValidationResult> {
    const token = credentials.token
    if (!token) return { valid: false, error: 'Token cannot be empty' }

    try {
      const response = await axios.get(`${API_BASE}/api/user`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
        validateStatus: () => true,
      })

      if (response.status !== 200) {
        return { valid: false, error: 'Token is invalid or expired' }
      }

      return {
        valid: true,
        tokenType: 'access',
        accountInfo: {
          userId: response.data.id,
          email: response.data.email,
          name: response.data.name,
        },
      }
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Validation failed' }
    }
  }

  async refreshToken(credentials: Record<string, string>) {
    return null  // Optional
  }
}

export default ProviderAdapter
```

#### Step 4: Register OAuth Adapter

```typescript
// src/main/oauth/adapters/index.ts
export { ProviderAdapter } from './provider'

export function createAdapter(providerType: ProviderType, config: AdapterConfig): BaseOAuthAdapter {
  switch (providerType) {
    // ...existing
    case 'provider-id':
      return new ProviderAdapter(config)
    default:
      throw new Error(`Unsupported provider type: ${providerType}`)
  }
}

export function getSupportedAuthMethods(providerType: ProviderType): string[] {
  switch (providerType) {
    // ...existing
    case 'provider-id':
      return ['manual']
    default:
      return ['manual']
  }
}
```

#### Step 5: Proxy Adapter

```typescript
// src/main/proxy/adapters/<provider>.ts
import axios, { AxiosResponse } from 'axios'
import { Account, Provider } from '../../store/types'

const API_BASE = 'https://api.example.com'

export class ProviderAdapter {
  private provider: Provider
  private account: Account
  private token: string

  constructor(provider: Provider, account: Account) {
    this.provider = provider
    this.account = account
    this.token = account.credentials.token || ''
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<{
    response: AxiosResponse
    sessionId: string
  }> {
    // 1. Get/refresh token
    // 2. Build request
    // 3. Send request
    // 4. Return response
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return true
  }

  static isProviderProvider(provider: Provider): boolean {
    return provider.id === 'provider-id' || provider.apiEndpoint.includes('example.com')
  }
}

export const providerAdapter = { ProviderAdapter }
```

#### Step 6: Stream Handler

```typescript
// src/main/proxy/adapters/<provider>-stream.ts
import { PassThrough } from 'stream'

export class ProviderStreamHandler {
  private model: string
  private sessionId: string
  private isFirstChunk: boolean = true
  private created: number

  constructor(model: string, sessionId: string, onEnd?: () => void) {
    this.model = model
    this.sessionId = sessionId
    this.created = Math.floor(Date.now() / 1000)
  }

  async handleStream(stream: NodeJS.ReadableStream): Promise<NodeJS.ReadableStream> {
    const transStream = new PassThrough()
    
    stream.on('data', (chunk: Buffer) => {
      // Parse SSE data
      // Convert to OpenAI format
      // Write to transStream
    })

    stream.on('end', () => {
      transStream.write('data: [DONE]\n\n')
      transStream.end()
    })

    return transStream
  }

  async handleNonStream(stream: NodeJS.ReadableStream): Promise<any> {
    // Collect all data
    // Return OpenAI format response
  }

  private createChunk(delta: any, finishReason?: string): string {
    return `data: ${JSON.stringify({
      id: this.sessionId,
      model: this.model,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finishReason || null }],
      created: this.created,
    })}\n\n`
  }
}
```

#### Step 7: Register Proxy Adapter

```typescript
// src/main/proxy/adapters/index.ts
export { ProviderAdapter, ProviderStreamHandler, providerAdapter } from './provider'
```

#### Step 8: Add Forwarder Method

```typescript
// src/main/proxy/forwarder.ts
import { ProviderAdapter } from './adapters/provider'
import { ProviderStreamHandler } from './adapters/provider-stream'

// Register the provider in the dispatch table - doForward walks it, there is no if-branch to add:
private readonly providerForwarders: ProviderForwarder[] = [
  // ...existing entries
  {
    name: 'provider-id',
    matches: ProviderAdapter.isProviderProvider,
    forward: (request, account, provider, actualModel, startTime) =>
      this.forwardProvider(request, account, provider, actualModel, startTime),
  },
]

// Add forward method (signature must match the ProviderForwarder forward type):
private async forwardProvider(
  request: ChatCompletionRequest,
  account: Account,
  provider: Provider,
  actualModel: string,
  startTime: number
): Promise<ForwardResult> {
  // Implementation
}
```

#### Step 9: Add UI Translations

```json
// src/renderer/src/i18n/locales/zh-CN.json
{
  "provider-id": {
    "name": "供应商名称",
    "description": "供应商描述",
    "token": "Token",
    "tokenPlaceholder": "请输入 Token",
    "tokenHelp": "从网页版获取 Token",
    "models": {
      "Model-1": "模型 1 描述"
    }
  }
}
```

```json
// src/renderer/src/i18n/locales/en-US.json
{
  "provider-id": {
    "name": "Provider Name",
    "description": "Provider description",
    "token": "Token",
    "tokenPlaceholder": "Enter token",
    "tokenHelp": "Get token from web version",
    "models": {
      "Model-1": "Model 1 description"
    }
  }
}
```

#### Step 10: Add Icon Mapping

```typescript
// src/renderer/src/components/providers/ProviderCard.tsx
import providerIcon from '@/assets/providers/provider.svg'

const providerIcons: Record<string, string> = {
  // ...existing
  'provider-id': providerIcon,
}
```

### AuthType Reference

| Type | Description | Used by | Credential Field |
|------|-------------|-----------|------------------|
| `token` | generic API key | aggregate providers, custom | `apiKey` (aggregate) / `token` (custom) |
| `userToken` | single opaque token | (no shipped provider since the OpenCode runtime retirement) | `token` |
| `cookie` | cookie bundle | custom cookie-based endpoints | provider-defined |

### Web Search Mode Implementation

Three ways to enable web search:

1. **Model Mapping**: Auto-enable via model name
```typescript
const modelLower = request.model.toLowerCase()
if (modelLower.includes('search')) {
  searchEnabled = true
}
```

2. **Custom Parameter**: Via `web_search` parameter
```typescript
if (request.web_search) {
  searchEnabled = true
}
```

3. **Custom Header**: Via request header
```typescript
if (headers['X-Enable-Search']) {
  searchEnabled = true
}
```

### Thinking Mode Implementation

Three ways to enable thinking mode:

1. **Model Mapping**: Auto-enable via model name
```typescript
const modelLower = request.model.toLowerCase()
if (modelLower.includes('r1') || modelLower.includes('think')) {
  thinkingEnabled = true
}
```

2. **Custom Parameter**: Via `reasoning_effort` parameter
```typescript
if (request.reasoning_effort) {
  thinkingEnabled = true
}
```

3. **Custom Header**: Via request header
```typescript
if (headers['X-Enable-Thinking']) {
  thinkingEnabled = true
}
```

### Thinking Content Handling

In stream handler, output thinking content to `reasoning_content` field:

```typescript
if (path === 'thinking') {
  delta.reasoning_content = processedContent
} else {
  delta.content = processedContent
}
```

### Model List Synchronization

**Single source of truth**: the model list lives only in
`src/main/providers/builtin/<provider>.ts` (`supportedModels`). `src/main/store/types.ts` re-exports
it as `BUILTIN_PROVIDERS`, so there is no second array to keep in sync.

### Testing Checklist

- [ ] Provider displays correctly
- [ ] Account can be added
- [ ] Account validation works
- [ ] Streaming chat works
- [ ] Non-streaming chat works
- [ ] Web search mode works
- [ ] Thinking mode works
- [ ] Model mapping works
- [ ] Multi-turn conversation works
- [ ] Session deletion works

## Updating Provider Configuration

Update **one** place: **`src/main/providers/builtin/<provider>.ts`** (model list, description, help
text, endpoint, headers, credential fields).

`initializeDefaultProviders()` in `src/main/store/store.ts` runs on every startup and, for each
builtin provider, force-overwrites `apiEndpoint`, `chatPath`, `supportedModels`, `modelMappings`,
`headers`, `credentialFields` and `description` in the stored record with the values from code. So:

- changes shipped in code reach the UI only after a restart;
- the same fields edited through the UI are discarded on the next startup (`enabled`, `name`,
  `authType` and stored credentials survive, as do per-model on/off choices kept in
  `userModelOverrides`);
- a builtin provider whose id no longer exists in code is deleted from the store at startup.

Example: there is currently no builtin to edit - `builtinProviders` has been empty since the
OpenCode runtime retirement, and `tests/store/provider-sync.test.ts` plus
`tests/providers/provider-endpoint-policy.test.ts` pin that the runtime-backed wiring stayed removed.
Aggregate entries are data, not code: edit `src/main/providers/aggregate/registry.ts` (and the
counts asserted in `tests/aggregate/registry.test.ts`).
