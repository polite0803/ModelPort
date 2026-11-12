# AGENTS.md

Guidance for coding agents working in this repository. This file is deliberately short: it holds the
rules that change how you work, plus pointers. The full reference (every subsystem, the failure each
rule came from) lives in [`docs/AGENTS-full.md`](docs/AGENTS-full.md) - read the section you need from
there instead of guessing. The documentation index is [`docs/README.md`](docs/README.md): design and
decision records live in [`docs/design/`](docs/design/), implementation plans in
[`docs/plan/`](docs/plan/), audit reports in [`docs/audit/`](docs/audit/), and provider-specific
notes in [`docs/providers/`](docs/providers/). When none of them covers the topic, read the code and
the comments in the file you are changing.

## Project Overview

ModelPort is a desktop **console** that runs, installs or connects to an OpenAI-compatible API proxy
gateway (local / WSL / remote). Three provider
classes ship: a 92-entry / 580-model aggregate catalogue of key-based and key-less endpoints, the
fifteen account channels served by the vendored channel pack, and user-defined custom providers.
Runs on macOS, Windows, Linux.

## Build \& Verification

```bash
npm run dev  /  npm run dev:win      # development
npm run build                        # electron-vite build + source-artifact guard
npm run build:daemon                 # headless Node bundle (out/daemon) for non-Electron hosts, e.g. WSL
npm run gate                         # what CI runs: build + build:daemon + tsc x2 + full suite
```

`npm run gate` is the only acceptable proof of "done":

```bash
npm run build
npm run build:daemon                       # out/daemon/modelport-daemon.cjs + its resource tree
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
│   │                #   compression/, quota/, services/
│   ├── oauth/       # manager, inAppLogin, adapters/
│   ├── channelPack/ # vendored pack host: worker.ts + compat shims + bridge.ts
│   ├── providers/   # builtin/ (one file per provider), aggregate/ (registry+manager),
│   │                #   accountChannels/, custom.ts, modelListSource.ts, modelCatalog.ts
│   ├── store/       # conf-backed storage: store.ts, types.ts, config.ts, keyMigration.ts
│   ├── runtime/     # host bindings: host.ts (the only electron-aware seam), electronHost.ts
│   ├── daemon/      # entry.ts - the headless Node host (WSL), no window, no tray, no updater
│   ├── shell/       # Windows-native client: window + tray + address book (loads a remote /ui/)
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
`context\_window` on `/v1/models`: omit the key rather than emit `0` or a guess. The gate there is
**direction of error, not source label** - manual marks, upstream declarations and the `probe`
measured lower bound may be advertised; `catalog` / `family-rule` / third-party tables may not, and an
adopted catalogue value reaches the client only by being re-entered as a manual mark. Per routed
response, `X-ModelPort-Context-Window` carries the serving candidate's gated window so a mid-conversation
switch is visible to clients that read headers; it must read `advertisedContextWindow`, never the ungated
`contextWindow` that logs and the UI use.
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
* **Freeform (`custom`) tools keep their own item type on the Responses lane.** Codex's `apply_patch`
is a freeform tool: raw text argument, `custom_tool_call` / `custom_tool_call_output` items. The
inbound gives it a required string `input` schema (chat has no other contract slot) and the outbound
must answer with `custom_tool_call` + that text - the client dispatches on item `type`, so a
`function_call` there means the write silently never happens. Those items must also be read back out of
history, or the model cannot see its own attempts and re-declares the write every turn.
* **Parallel tool calls collapse into ONE assistant message on the way to chat.** Responses' `input`
carries one `function_call` item per call, and projecting each item into its own assistant message puts
a second assistant between a call and its result. Strict upstreams reject that shape outright -
MiniMax answered `invalid params, tool call result does not follow tool call (2013)` on 2026-11-12 and
the whole request died with the other 31 candidates untried. `responsesInbound.pushToolCall` merges
consecutive call items into the batch's assistant, keeps a reasoning item on that same message instead
of inserting a standalone one, and closes the batch once a result arrives (a call after a text/user
message must not join it). `forwarder` classifies the surviving 2013 as a capability mismatch
(`isToolCallOrderingError`) so a badly-shaped legacy history fails over instead of ending the chain.
* **System-store trust is not "the client can connect".** `installCertificateTrust()` only satisfies
Chromium/Schannel clients; Node-based clients (Codex CLI, the WorkBuddy/CodeBuddy agent) ignore that
store entirely and need `NODE_EXTRA_CA_CERTS` - the same PEM a remote machine can fetch from
`GET /v1/management/tls/ca`. A refused handshake creates no request row, no `X-Request-Id` and no
attempt list, so read `TlsStatus.handshakeRejections` (`GET /v1/management/tls/status`) before
concluding the gateway saw nothing. Details in `docs/AGENTS-full.md` §HTTPS Listener and Certificate
Trust.
* **The gateway authors no prompt text** (裁定 2026-11-03「本网关不注入任何提示词」, amended
2026-11-12). Nothing ModelPort writes may add a system/user turn, append to the client's system prompt,
or replace message content with prose. The 2026-11-12 amendment lifts the ruling for exactly two
*protocol* blocks - `ccr-protocol` (what a `<<ccr:hash>>` marker means and how to fetch the original at
`GET /v1/ccr/<hash>`) and `say-less-contract` (an opt-in output level) - each injected as its own
leading `system` message, byte-identical on every turn, off unless the conversation has been compressed
or the user selected a level. "Off unless" is a *conversation* fact, not a per-turn one: the block sits
at the head of the prompt, so a block that appeared on compressing turns and vanished on the others
would drop the whole cached prefix every time it flipped. `gatewayProtocolMemory.ts` remembers the
conversation once it is introduced. Everything else stays retired. Retired in the 2026-11-03 batch: the managed
tool-call prompt subsystem (`proxy/toolCalling/`, `shared/toolCalling.ts`, `config.toolCallingConfig`,
`ToolCallingPanel`, `/v1/management/tool-calling/*`), the synthetic trailing user turn
(`proxy/trailingUserGuard.ts`, `config.trailingUserGuard`), output verbosity steering in its old form
(`config.outputSteering`; the goal returned as `say-less-contract`, the retired key did not) and the
context Summary strategy (`contextManagement.strategies.summary`). Tools travel natively; "this
candidate has no tools" is a **routing** fact (`autoRouting::buildRequestProfile.needsTools` →
`hardFilterFailure` → `missing:['tools']`), not something to paper over with instructions. Shape
transforms stay allowed - message/tool structure mapping, deletion-only trimming, aggregate parameter
stripping, duplicate-message folding. The live text sites are `ccr-sentinel` (a self-describing
retrieval pointer inside a compressed tool result), `liveness-ping` (a probe that never enters a
conversation), the three capability probes, and the two amended blocks above - each tagged
`GATEWAY-TEXT: <id>` and reconciled two-way with `docs/AGENTS-full.md` §Gateway-Authored Text by
`tests/proxy/gateway-authored-text.test.ts`, which pins the exact live set. Retired config keys are
stripped in `store.ts::normalizeConfig` so the management API can never report a switch nobody reads.
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
* `data.json` is a single conf file (config, providers, accounts, statistics,
logs). `userModelMarks` (manual capability hints) stays out of `userModelOverrides` so a model sync
cannot erase a user correction.
* Startup `initializeDefaultProviders()` force-overwrites a builtin's `apiEndpoint`, `chatPath`,
`supportedModels`, `modelMappings`, `headers`, `credentialFields` and `description` from code, and
deletes builtins whose id no longer exists. Edit builtin config in
`src/main/providers/builtin/<provider>.ts` only; UI edits to those fields are discarded on restart.
(There is currently no builtin to edit - `builtinProviders` has been empty since the OpenCode runtime
retirement.)
* A name counts as a retired provider only when no shipped definition still claims it - read it through
`providers/providerRetirement.ts::isRetiredProviderId` (builtin registry + aggregate catalogue + channel
catalogue), never off `RETIRED_PROVIDER_IDS` alone. Five of its names (`deepseek`, `glm`, `kimi`,
`minimax`, `zai`) are live ids, and a configured API key is an account of that same `providerId`, so the
bare list purged a user's DeepSeek key on every gateway start (fixed 2026-11-11, guarded by
`tests/store/retired-name-collision.test.ts`).

Host boundary (`docs/plan/PLAN-wsl-headless-daemon-and-shell.md`):

* The gateway runs in three hosts: a **windowless Electron process** started by the console (local mode - Electron
because `safeStorage` seals `store.key`), the headless Node daemon (`src/main/daemon/entry.ts`, WSL and friends),
and the retired desktop host kept for development (`--desktop`). All three share
`gateway/bootstrap.ts::bootstrapGateway()`, so a startup step cannot land on one and miss another. Everything
host-specific is reached through `src/main/runtime/host.ts` - version, resource root,
`openExternal`, login-item sync, and the credential sealer. **Nothing under `proxy/`, `providers/`, `store/`,
`scheduler/` or `channelPack/` may import `electron`** (fenced by `tests/build/daemon-bundle.test.ts`, which also
checks the built bundle: esbuild will inline the electron launcher stub and the crash only appears on the target
machine). `store.ts` uses `conf` directly because `electron-store` destructures `{app, ipcMain}` at module top level.
* A `store.key` proves `data.json` was sealed with a machine-bound key. On a host with no OS keystore the plan is
`sealed-unreadable`: `initialize()` throws and the file is left alone. Never route that through the corrupted-data
backup - renaming `data.json` reads to the user as "my providers disappeared".
* Two surfaces reach the gateway without a desktop window. `/v1/management/rpc` (and `/events`) is authenticated by
the management secret, and its callable set is **the handler registry minus two install-level channels**
(`app:installUpdate`, `app:downloadUpdate`) - do not hand-maintain a second list, that is how the two surfaces drift.
`/ui` serves the built renderer on hosts that report a `getWebRoot()` and is exempt from the API-key gate like `/`
and `/health`: the document contains no data, and a key would have to travel in a URL, which the no-`?api_key=`
rule forbids. `/` still returns its JSON index; the UI is `/ui/` (trailing slash - the build emits relative asset
URLs and koa-router needs `strict` to keep `/ui` from looping onto itself).
* Backup import has three entries and **one engine**: the desktop dialog, `--import-backup <path>`,
  and the remote page's browser picker (`POST /v1/management/backup/stage`). All three land on
  `backup/service.ts::stageBackupFile()` - a fourth importer is how the format checks, the sealed-file
  path and the one-shot token start to disagree per host. The upload route generates its own filename
  inside the data directory (the client never names a path), caps the stream while it arrives, and
  deletes the file before responding; export has **no** headless entry and says so in the UI rather
  than pretending to write a file it cannot reach.
* The management secret's lifetime depends on the client, and neither may go plaintext. A browser
  tab keeps it in `sessionStorage` and forgets on close; the console seals it with
  `safeStorage` (DPAPI, current user) into `secrets.json` 0600, one row per gateway origin, and
  only after the gateway accepted it. With no keystore the store **refuses to write** - the UI
  keeps asking, which is the honest failure; a copy of that file under another user or machine
  decrypts to nothing and reports `unreadable`, never `none`. `gateways.json` stays credential-free.
* One product ships one installer per platform plus `dist/modelport-daemon-<ver>-<arch>.tar.gz`
(`scripts/build-daemon.mjs`: bundle + `resources/` + `renderer/` + a systemd unit template). The installer
is a **console** with three gateway modes - local (a windowless gateway this binary starts), WSL (installed
by the console when absent) and remote - and its entry is a thin argv orchestrator: `src/main/index.ts`
dynamic-imports the console (default), `gateway` (`--gateway` / `--init-local`) or the retired desktop host
(`--desktop`, development only). A **static** import between those roles would put a second gateway identity
in the console process - the fence is in `tests/build/shell-entries.test.ts` and `gateway-entry.test.ts`.
Two more rules are load-bearing: the daemon bundle must inline every runtime dependency (the tarball carries
no `node_modules` either - same 1.4.5 failure mode as the asar, and `npm run gate` builds it so the fences
cannot go stale), and **no `latest.yml` is published** by the build: the console updates itself from release assets plus a
sibling `.sha256` (`src/shell/updater.ts`), which is also what makes the unsigned macOS dmg workable.
(Two migration shims, both removable once ≤1.7.5 clients are gone: a generated `latest.yml` /
`latest-linux*.yml` for clients that still use electron-updater, and an identical `ModelPort-Shell-<ver>-<arch>-setup.exe`
alias because the 1.7.5 shell's updater cannot be told the new asset name. The console reads neither.)
* Persistence on a headless host needs a **system-scope** enabled unit: a `systemctl --user` service dies with
the login session that started it, and the WSL distro itself is reclaimed once the last client exits, so the
gateway would silently stop between boots.

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
* **Bodies are governed by three knobs, and only three.** `requestLogConfig.includeBodies` (every
  request), a per-request `X-ModelPort-Trace: 1`, or `requestLogConfig.bodySampleRate` - a *hash of
  `requestId`*, never a fresh coin flip, because a row is written at request start and patched as the
  stream ends while the patch carries no body: the sanitizer keeps what is on the row by reading
  `captureBodies`, which a random draw would flip under its own body. `bodyRetentionDays` (default 7)
  then strips the body and that flag, keeping the row - dashboards, Bandit and the detail dialog read
  rows, and deleting a row to age out its body loses the reading the body was collected for. Sampling
  defaults to 0: storing bodies is a privacy and disk decision that an upgrade must not make for the
  user. This is the corpus source for `scripts/compression-eval.mjs` (`--from-logs`, since `data.json`
  no longer holds the rows).
* Timed log persistence is async and atomic (unique temp + rename); `flushSync()` remains the quit path
  and invalidates stale in-flight snapshots. Worker logs carry `providerId`/`requestId` when available.
* `console.error`/`console.warn` are mirrored to a durable surface by `src/shared/logging/consoleBridge.ts`,
  installed once per host: the gateway sends them to the app log (`gateway/bootstrap.ts`), the console
  appends to `<userData>/logs/console.ndjson` (`src/shell/consoleLogSink.ts`). It lives under `shared/`
  because `src/shell` may not import `src/main` (same reason as `shared/certificateTrust`). **A sink must
  never report its own failure through `console.*`** - the bridge would feed it back into the same sink;
  both sinks write to `process.stderr` instead.
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
* **A protocol-perfect but content-degenerate stream is the second degraded class**
(`shared/streamRepetition.ts`): the trailing-128-line dedup ratio over the re-joined
`content`/`reasoning` deltas, with thresholds in `AppConfig.streamRepetitionGuard` (absent =
shipped defaults, calibrated so the gateway stays looser than a client's own loop guard). The
reading lands on `streamTrace.repetition` as aggregates only, `runChars` is evidence and not a
judgement input, a degraded turn **revokes** the sticky anchor (`autoRouter.revokeSticky`), and
non-streaming responses are deliberately not judged. A `client_abort` still counts as neither
success nor failure - that skip is exactly why this second signal exists.
* **A completed stream that delivers nothing is the third degraded class**
(`shared/streamRepetition.ts::measureStreamEmptyTurn`). The dedup ratio is structurally blind to it:
OpenRouter-style reasoning arrives as `reasoning_details` **objects**, so the reading is `lines: 0` /
`notJudged: too_short` and looks healthy. Judged only when the client offered `tools` and the stream
ended `done`, with zero `content` characters **and** zero `tool_calls` deltas. The reading lands on
`streamTrace.emptyTurn`, counts as degraded for AIMD/Bandit and revokes the sticky anchor - an agent
client ends its turn on such a completion, so without this the session stays pinned to a model that
never acts (2026-11-12 `chatcmpl-mwcghqtq-td1xm6`: 176 KB out, 1108 output tokens, all reasoning).
* **"Announced then stopped" is the fourth degraded class** (same reading, `announcedStop`). It slips
past both earlier gates: the stream has content (so `empty` is false) and is one short line (so the
dedup ratio says `too_short`). Judged only when the client offered `tools`, the stream ended `done`,
there were **zero** `tool_calls` deltas, and the content's last non-whitespace character is `:` or
`：` - a promise of a following action that never came. Revokes the sticky anchor and counts as
degraded, same as the other two. Measured 2026-11-12 05:24 (`chatcmpl-mwcmniyx-797qi1`,
`cline/nvidia/nemotron-3.5-lightning-free`: three consecutive "现在我将修改 X：" turns, 84 output
tokens, zero calls) after every strong candidate in the `codex` route went unpayable - without this
class the anchor never lifts, so the session stays pinned to the model that only talks. The action is
still only "re-rank next turn": no account failure is recorded and no candidate is removed.
* **An upstream output-cap truncation is the fifth degraded class**, and it revokes the anchor too.
`finish_reason=length` when the client sent no `max_tokens`/`max_completion_tokens` already counted as
degraded for AIMD/Bandit, but it did not reach `shouldRevokeStickyAfterStream` - so the session stayed
pinned to the model that truncated. Codex turns that into `response.incomplete (max_output_tokens)`
and ends the task on the spot, so "always the same error" was the anchor, not one bad model. Measured
2026-11-12: Codex sends no cap at all (103/103 rows `maxTokens` null) and the window's only `length`
row is `raccoon/sn-sensenova-6-8-flash-lite`, cut at 3769 completion tokens. The predicate is computed
once at each of the two stream settle sites in `routes/chat.ts` and passed to both the AIMD reading and
`settleSticky`, so the two judgements cannot drift; a cap the client did send stays an explicit
truncation (no revoke, no penalty).
* **A slow first token is the sixth degraded class** (2026-11-12, `isSlowTurnAfterStream`): the stream
completed (`done`) but its `firstTokenMs` was above the pool's p75, computed at selection time and carried
as `AutoRouteDecision.latencyGateMs`. It does not touch the account - it only lifts the anchor so the next
turn re-ranks. This is the turn-level half of the same threshold that stops the hard pin from promoting a
slow model; both read one derivation (see the latency-gate invariant below the stickiness bullet).
* **A degraded reading must reach the Bandit table, or it is decoration.** `autoBandit` aggregates the
request-log rows, and those rows carry `repetition`/`emptyTurn` **nested under `streamTrace`**;
reading only the top-level field (as it did until 2026-11-12) means classes ②③④ never entered the
Beta posterior, so every "200 but did nothing" turn scored as a success. `isDegradedSuccess` now
accepts both shapes, and `tests/proxy/bandit-repetition.test.ts` pins the production shape plus the
outcome the whole feature exists to produce: a free candidate that does the work must rank above one
that only announces the next step.
* Per-`(account, model)` AIMD admission: default concurrency 4; 429/timeout/5xx shrink it
multiplicatively (5s cooldown), 5 clean successes grow it by one (30s quiet period). Short-window
EWMA first-token latency plus 429/timeout/degraded rates feed candidate scoring. A locally rejected
admission is a 429 `local_concurrency_limit` that fails over without penalising the account.
* **A chain exhausted by recoverable failures waits and re-runs once, inside the gateway.** 503 +
`Retry-After` is "try later" at the protocol level, but Codex does not retry an agent turn by itself -
to the user that is a broken task (measured 2026-11-12: 26 of 50 Codex requests died as 503).
`planRecoveryWaitMs` budgets the wait from the **wall clock left over** after the lowered first-round
slice (`FIRST_ATTEMPT_CAP_MS` = 20s; the 90s total is deliberately **not** raised), takes
`min(remaining budget, upstream unlock time, 15s)`, and defaults to a 5s backoff when the upstream
gives no unlock time - which is the case for every aggregate 429. Exactly one recovery round
(`recovery.roundsLeft`), never a rolling retry. Out of scope by design: arrears and
not-subscribed - those do not heal in fifteen seconds, so waiting only holds the client's socket.
The wait runs after every `endAttempt`, so it structurally holds **no AIMD slot**; that is why no
change to the slot's holding period was needed.
* Live account credit is a **gate, never a number**: `shared/aggregateCredit.ts::creditSnapshotExhausted` is
the only judgement (row complete, explicitly not `unlimited`, a number returned, `remaining <= 0`, `asOf`
inside `CREDIT_SNAPSHOT_TTL_MS` = 15 min) and a hit folds `aggregateHeadroom` to the existing `-1`. USD credit,
CNY balance and this app's token ledger are three incomparable count domains - the
`QuotaWindowBlockReason | 'no-credit'` split makes converting one into a token ratio a type error. One click on
the aggregate panel sends one GET per stored key (capped, remainder stated); nothing is polled and opening a
page never asks by itself.
* **A refusal witnessed by a real call is a fourth, non-comparable quota layer** (`shared/aggregateQuotaExhaustion.ts`).
`quotaBlockReason` marks a `(entry, account, model)` when the upstream itself said quota/balance/arrears, then
skips exactly that pair until it expires (`until` from the client-facing `Retry-After`, else
`QUOTA_EXHAUSTION_TTL_MS` = 30 min); the first success clears it, and the detail page has a manual clear. It is
never folded into the documented caps (a static cap), the local ledger (our count), or the money snapshot (a
balance) - this one is a witness, and the UI shows it beside the five-state badge, never merged into it. Rate
limits are deliberately **not** marked (bare 429, `rate limit`, `频率超限`, the local AIMD 429): a mis-mark costs
the pair half an hour. Written once at the three-branch convergence in `routes/chat.ts` via
`proxy/quota/exhaustionMarks.ts`; both directions pinned by `tests/proxy/aggregate-quota-exhaustion.test.ts`.
* Stickiness is a **hard priority by default** (`ModelRoute.stickyHardPin`, absent = enabled, read as
`!== false` so records predating the field keep it). Turning it off per route leaves only the `+0.12` / `+0.06`
score bonus - and because the promotion happens in `autoRouter::select`, an assertion over `rankCandidates`
alone cannot catch a regression in it; the two settings must be tested as a pair (same pool, opposite winners).
* **Latency is a gate, not only a penalty** (2026-11-12, the user's "routing feels an order of magnitude
slower" report). The hard pin is skipped when the candidate that would be promoted is slower than the pool's
**p75 `ewmaFirstTokenMs`** (`autoRouting.ts::poolLatencyGateMs`, no reading = no judgement, fewer than 4
readings = no judgement); the same figure rides on `AutoRouteDecision.latencyGateMs` and the stream settle
paths pass it to `shouldRevokeStickyAfterStream`, so "this completed turn's first token was slower than three
quarters of the pool" revokes the anchor too (sixth degraded class). One derivation, two consumers - never
recompute it in the route file. A pool-relative threshold, not an absolute millisecond constant: measured
direct p50 was 1.9s and routed p50 15.3s, so any fixed number breaks on one side.
* **`auto` is a pool, not a lane** (2026-11-12 strategy change, after the lane model was reported as a dead
end: "客户端一上来就中断了"). `autoRouter::select` partitions the ranked list so one model's accounts are
contiguous and the head model's family comes next, but that partition is **order only**: `forwardFirstReachable`
advances to the next candidate on any failure the status policy allows - including the next **model** - until a
candidate answers or the wall clock (90 s) / `baseCap` (account-fault failures: 5xx, network) runs out. The
retired pieces are `ModelRoute.crossModelFailover`, `AutoRouteDecision.lane`, `anchorLaneToCandidates` and
`RequestLogEntry.auto.lane`; nothing may re-introduce a per-model fence, because the fence is exactly what made
a first-turn failure terminal while dozens of live candidates sat untried (2026-11-12 readings: `chainLength`
37-116, `attempts` 1-2, e.g. an OpenCode 404 and a modelscope `limit_burst_rate` 429). Plain 400 is the one
class the pool treats differently from the named-model chain: on `auto` a bare 400 (not client-aborted, not a
`capabilityMismatch`) switches candidates without an account penalty, capped at
`MAX_REJECTED_REQUEST_SWITCHES` = 2 - one provider refusing a request body does not condemn the pool, but two
refusals in a row more likely mean the request itself is malformed. A client abort is still terminal (it
surfaces as 400 with `request.signal.aborted`). `tests/routes/{proxy-routes-catalog-404,
context-overflow-failover}.test.ts` and `tests/renderer/auto-routing-settings.test.mjs` (retirement negative
controls) are the readable form.
* **Cache-first compression**: `CompressionConfig.cacheFirst` (default on) makes a provider with a documented
prefix cache and a cheap cache read (DeepSeek ≈0.02x, Anthropic 0.1x) skip live-zone compression, because the
next turn resends the original bytes; the saving must beat the cache discount (`1 - c/(1+w)`). A per-provider
`providerOverrides[id]` wins. Capability data lives in `AggregateEntry.promptCache` and is `unknown` unless
evidenced; only the Anthropic adapter writes `cache_control`, and `autoRouting.cacheAffinityMinutes` keeps a
conversation on the same account/model for known-cache providers. Plan and two-round math:
`docs/plan/PLAN-prompt-cache.md`.
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





## Session bootstrap by host (added 2026-11-10, updated 2026-11-11)

This repository is opened in three ways. They share **one checkout** but differ in execution
host and rule set. Identify the session first, then follow only its row - do not mix them.

| Session | Working dir the agent sees | Where commands run | Rules to load at session start |
|-|-|-|-|
| CodeBuddy WSL remote (`vscode-remote://...+ubuntu-24.04`) | `/home/polit/projects/ModelPort` | Linux directly, no SSH wrapper | `/home/polit/.codebuddy/rules/\*.mdc`, `CODEBUDDY.md`, `memory/MEMORY.md` |
| Qoder local workspace on `Z:\ModelPort` | `Z:\ModelPort` | WSL via `ssh -o BatchMode=yes wsl "cd /home/polit/projects/ModelPort && <cmd>"` | `.qoder/rules/00-execution-ssh.md` (`alwaysApply`) |
| WorkBuddy local workspace on `Z:\ModelPort` | `Z:\ModelPort` | per `.workbuddy/` project rules | `.workbuddy/` rules |

`Z:` is a Samba/SMB mapping of WSL `/home/polit/projects`, not a second checkout: no sync,
no copy, no second git worktree. Linux paths such as `/home/polit/.codebuddy/...` are **not
resolvable** from a local `Z:` session - never try to read them there. Conversely, in a
WSL-remote session the shell is already on the Linux host - never wrap commands in `ssh`.
BYOK / third-party models are only available in the two local-workspace rows; the Qoder SSH
workspace mode is deliberately not used.

Local-environment rules shared by all three rows: never copy or clone this checkout to
`C:` or `D:` for a local build (changes would not flow back, and `sdk.dir`, `gradlew` and
native modules are Linux-only); never run builds, tests, adb or a repo-wide search on
`Z:` / SMB. The cross-project entry point is
`/home/polit/projects/scripts/wsl-project.sh` (`list` / `env` / `init` / `check`), and
ModelPort's Qoder SSH templates live in `.qoder/rules/00-execution-ssh.md`.

### CodeBuddy WSL remote only

This file carries the project-level constraints for `/home/polit/projects/ModelPort`.
User-level rules live in `/home/polit/.codebuddy/rules/\*.mdc` and are injected at session
start, but are not re-injected after context compaction. At the start of every conversation,
and again after any compaction or noticeable memory loss, read those `.mdc` files plus
`/home/polit/.codebuddy/CODEBUDDY.md` and `/home/polit/.codebuddy/memory/MEMORY.md`, and
treat them as mandatory global rules. Keep task state in `/home/polit/.codebuddy/memory/`;
never claim to remember a previous turn without reading those files.
