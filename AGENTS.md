# AGENTS.md

Guidance for coding agents working in this repository. This file is deliberately short: it holds the
rules that change how you work, plus pointers. The full reference (every subsystem, the failure each
rule came from) lives in [`docs/AGENTS-full.md`](docs/AGENTS-full.md) - read the section you need from
there instead of guessing; per-feature plans and decision records are in
[`docs/plan/`](docs/plan/) and provider-specific notes in [`docs/providers/`](docs/providers/). When
none of them covers the topic, read the code and the comments in the file you are changing.

## Project Overview

ModelPort is an Electron desktop application exposing an OpenAI-compatible API proxy. Three provider
classes ship: a 74-entry / 473-model aggregate catalogue of key-based and key-less endpoints, the
thirteen account channels served by the vendored channel pack, and user-defined custom providers.
Runs on macOS, Windows, Linux.

## Build \& Verification

```bash
npm run dev  /  npm run dev:win      # development
npm run build                        # electron-vite build + source-artifact guard
npm run gate                         # what CI runs: build + tsc x2 + full suite
```

`npm run gate` is the only acceptable proof of "done":

```bash
npm run build
npx tsc --noEmit -p tsconfig.json        # renderer + shared
npx tsc --noEmit -p tsconfig.node.json   # main + preload + shared
node --test "tests/\*\*/\*.test.ts" "tests/\*\*/\*.test.mjs" "tests/\*\*/\*.test.js"
```

Hard rules behind that gate:

* **`electron-vite build` transpiles without type checking.** A green build says nothing about types;
both `tsc` programs must be clean (-0 errors). Never add a `references` / `composite` link between
the two configs - it resolves `@shared/\*` through unbuilt declarations and turns real errors into
`TS6305`.
* **Node must natively strip TypeScript** (22.18+ / 23.6+ / 24; CI pins 24). An older 22.x kills every
`.test.ts` with `ERR\_UNKNOWN\_FILE\_EXTENSION` - a runtime problem, not a test failure.
* **Eight test files cannot run in a pipe/spawn-blocking sandbox** and fail with `spawn EPERM` before
any assertion: `tests/channels/{qoder-plan-gate,qoder-session-payload,workbuddy-port,minimax-tool-call-name}.test.ts`
(esbuild service binary) and
`tests/skills/modelport-{har-tool-fixture,tool-client-replay,provider-model-matrix,management-api}.test.mjs`
(`spawnSync('node', …)` over a pipe). A red there is environmental - re-run in a normal shell before
touching source. Two `tests/skills/` cases also fail on Windows checkouts (macOS `/private/tmp`
fixture path, `\\n`-only regex against CRLF).
* **This checkout carries uncommitted work.** Before blaming your change, check whether the failing
file is one you edited.
* **The packaged asar ships no `node\_modules`** (`build.files` excludes it), so every main-process
runtime dependency must be bundled by rollup. An externalized dependency is a startup crash:
1.4.5 externalized `electron-store` and every install died on `Storage not initialized`.
`tests/build/main-bundle-deps.test.ts` guards it.
* Release packaging: macOS outputs **dmg only** (breaks `electron-updater`), nothing is code-signed or
notarized, and `build.publish` must match the repository you release from.

## Architecture

```
src/
├── main/            # Electron main process
│   ├── index.ts     # entry (pins userData - see Data Storage)
│   ├── ipc/         # main <-> renderer handlers
│   ├── proxy/       # Koa proxy: server, forwarder, loadbalancer, modelMapper,
│   │                #   adapters/, routes/ (chat, completions, models, messages, responses, management/),
│   │                #   toolCalling/, quota/, services/, sessionManager.ts
│   ├── oauth/       # manager, inAppLogin, adapters/
│   ├── channelPack/ # vendored pack host: worker.ts + compat shims + bridge.ts
│   ├── providers/   # builtin/ (one file per provider), aggregate/ (registry+manager),
│   │                #   accountChannels/, custom.ts, modelListSource.ts, modelCatalog.ts
│   ├── store/       # electron-store: store.ts, types.ts, config.ts, keyMigration.ts
│   └── tray/
├── preload/         # context bridge
├── renderer/        # React UI: components, pages, stores (Zustand), i18n (en-US, zh-CN)
└── shared/          # types + pure logic shared by main and renderer
```

Request flow: `server.ts` (auth, singleton) → `routes/chat.ts` → `forwarder.ts` (dispatch through the
`providerForwarders` registry) → `adapters/<provider>.ts` → upstream; `loadbalancer.ts` picks the
account, `modelMapper.ts` resolves model names, `quota/` meters usage.

## Invariants You Must Not Break

Proxy / API contract (`docs/AGENTS-full.md` §Public API Contract for the full list, with the failure
each rule came from):

* **Auth is fail-closed.** With any enabled key, `/v1/\*` always requires it (Bearer or `X-API-Key`,
constant-time compare). With no key the server binds loopback only and `start()` refuses any other
host. No `?api\_key=` support.
* **`usage` is `null`, never fabricated**, when the upstream reported nothing. Same for
`context\_window` on `/v1/models`: omit the key rather than emit `0` or a guess.
* **`/v1/models` advertises routes only** - the list and `GET /v1/models/:model` share that one name
domain. A model's enabled state decides whether it joins any route's candidate pool and whether a
request naming it directly is accepted; it never decides what a client can list. A stopped user
alias is `ModelMapping.disabled` (declared in both `shared/types.ts` and `main/store/types.ts`, read
through `modelServing.ts::isMappingActive` at every use site), not `excludedModels` - an alias
belongs to no provider catalogue.
* **Every stream carries exactly one `\[DONE]`**; a post-stream failure is a `data: {"error": …}` frame,
never assistant text. Silent prefill is covered by `: PING` comments, not fabricated tokens.
Errors keep the upstream status and the upstream `type`/`code`/`param` when standard; fallbacks are
401 `authentication_error`, 403 `permission_error`, 404 `not_found_error`, 429 `rate_limit_error`,
5xx `api_error`. Never rewrite 403 into 401.
* **Failover status policy**: 400 is terminal (capability-mismatch 400s are explicit exceptions);
401-407, **404**, 409-499, 5xx and network errors switch to the next candidate; 408/504/524 may switch
but are never retried against the same target. A 404 means "this channel does not supply that model",
so it switches but earns no cooldown. Client-caused 400/404/422 never penalize an account.
* **History trimming never empties history.** Always keep the newest non-system message;
`messages: \[]` is rejected upstream as "non-empty array required", which the client reads as
"you sent no messages".
* **Output cap arrives as `max\_tokens` or `max\_completion\_tokens`** and is folded by
`utils/outputCap.ts::normalizeOutputCap`. Unfolded, it is silently dropped and the upstream truncates
at its own default.
* **Parameters**: built-in providers silently drop `response\_format`, `stream\_options`, `logit\_bias`,
`seed`, `max\_tokens`, `top\_p`, `stop` and the penalties (`proxy/parameterPolicy.ts`), because clients
send them by default and a 400 takes the client offline; only `n > 1` still returns 400. Custom and
aggregate providers pass everything through.
* **Header values** carrying dynamic text go through `utils/headerValue.ts::toHeaderValue`
(non-ASCII is percent-encoded). Chinese provider names raw in a header mean `ERR\_INVALID\_CHAR` → 500.
* Every `/v1/\*` response carries `X-Request-Id` matching the request-log row.

Data / store:

* Data lives in `\~/.modelport/`; the Electron profile is **pinned** to `<appData>/modelport` by
`app.setPath('userData', …)`. Do not unpin it - `safeStorage` seals `store.key` against that path.
* `data.json` is a single electron-store file (config, providers, accounts, sessions, statistics,
logs). `userModelMarks` (manual capability hints) stays out of `userModelOverrides` so a model sync
cannot erase a user correction.
* Startup `initializeDefaultProviders()` force-overwrites a builtin's `apiEndpoint`, `chatPath`,
`supportedModels`, `modelMappings`, `headers`, `credentialFields` and `description` from code, and
deletes builtins whose id no longer exists. Edit builtin config in
`src/main/providers/builtin/<provider>.ts` only; UI edits to those fields are discarded on restart.
(There is currently no builtin to edit - `builtinProviders` has been empty since the OpenCode runtime
retirement.)

Logging / diagnostics:

* Request rows carry `requestId`, every `attempts` entry (provider/account/status/error code/latency),
  `streamTrace` (first token, total, bytes, end reason, `[DONE]`, ping count, upstream request id),
  `errorType`/`errorCode`/`errorParam`, `upstreamStatus` and `upstreamRequestId`. `errorStack` is
  redacted and truncated, not dropped.
* Error rows have a retention floor (request logs keep the newest 100 errors; app logs keep the newest
  500) so a burst of successful traffic cannot evict the failure being diagnosed.
* `X-ModelPort-Trace: 1` captures request/response bodies for that one request even when global body
  logging is off; the Logs detail dialog can export a diagnostic bundle (row + related app logs +
  sanitized config/version snapshot). Process-level `uncaughtException`/`unhandledRejection` go to the
  app log and to `~/.modelport/logs/crash-fallback.ndjson` before the store is ready.
* Timed log persistence is async and atomic (unique temp + rename); `flushSync()` remains the quit path
  and invalidates stale in-flight snapshots. Worker logs carry `providerId`/`requestId` when available.
* Settings forms must not render editable controls before `appConfig` loads. `ProxyConfigForm` waits for
  the persisted config and then syncs unless the user has unsaved edits; otherwise its default
  127.0.0.1 / HTTPS-off state gets saved back over `proxyHost`/`httpsEnabled`/`httpsSanHosts`.
  `CONFIG_CHANGED` updates both `appConfig` and the form's `proxyConfig` mirror.

Quota / routing:

* Quota caps and pricing are **generated sidecars** (`src/shared/aggregateQuota.ts`,
`aggregatePricing.ts`, `aggregateCapabilities.ts`). Edit the receipts under `docs/data/\*\*` and re-run
the builder script; never hand-edit the output.
* `undocumented` never blocks a candidate ("no published cap" ≠ "no quota"), and a cap that is not in
tokens is never converted.
* Reset times are **derived, never stored**; `smart`/`pace` fall back to `fill-first` order when a
reset cannot be computed, and an exhausted candidate is a last resort, never a forced pick.
* The 24h Bandit score counts an HTTP-200 response with `finish_reason=length` as **degraded** when the
client did not request `max_tokens`; two consecutive degraded responses apply an immediate score
penalty. A client-requested cap is an explicit truncation and is never penalized.
* Per-`(account, model)` AIMD admission: default concurrency 4; 429/timeout/5xx shrink it
multiplicatively (5s cooldown), 5 clean successes grow it by one (30s quiet period). Short-window
EWMA first-token latency plus 429/timeout/degraded rates feed candidate scoring. A locally rejected
admission is a 429 `local_concurrency_limit` that fails over without penalising the account.
* `LoadBalanceStrategy` is declared twice (`src/shared/types.ts`, `src/main/store/types.ts`) plus the
UI maps and both locales - add a value in all of them or it silently cannot be selected.

## Coding Guidelines

* **Immutability is critical**: always return new objects, never mutate existing ones.
* Validate at system boundaries (user input, external APIs); use schema validation where available.
* Validate API keys before use, sanitize user input, never trust external data, rotate exposed secrets.
* UI-facing code returns user-friendly errors; the server side logs the detailed context. Never
silently swallow an error.
* macOS ARM64 needs `app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')` (Electron 33 V8
JIT crash); it trades performance for stability.

## Extending

Adding a provider touches five places (details in `docs/AGENTS-full.md` §Adding a New Provider;
provider-specific notes in `docs/providers/`):

1. `src/main/providers/builtin/<provider>.ts` (or the aggregate registry for data entries)
2. register it in `providers/builtin/index.ts` (`builtinProviders` + `builtinProviderMap`)
3. OAuth adapter in `oauth/adapters/<provider>.ts` + that folder's `index.ts` (two switches)
4. proxy adapter in `proxy/adapters/<provider>.ts` (keep the stream handler in the same file) + export
from `adapters/index.ts`
5. one entry in the `providerForwarders` array in `proxy/forwarder.ts`, plus the UI icon mapping and
i18n entries

`src/main/store/types.ts` needs no edit (it re-exports `builtinProviders`). Provider adapters share no
interface - each `chatCompletion()` returns its own shape, and the forwarder only needs
`is<Provider>Provider(provider)` plus the signature it handles.

## Tech Stack

|Component|Technology|
|-|-|
|Framework|Electron 33+|
|Frontend|React 18 + TypeScript|
|Styling|Tailwind CSS|
|State|Zustand|
|Build|Vite + electron-vite|
|Server|Koa|



