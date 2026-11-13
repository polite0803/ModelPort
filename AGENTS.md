# AGENTS.md

Short rulebook: what changes how you work, plus pointers. Full reference:
[`docs/AGENTS-full.md`](docs/AGENTS-full.md) - read the section you need. Index:
[`docs/README.md`](docs/README.md). When docs and code disagree, code wins and the doc is updated in
the same change. Keep this file under 200 lines: new detail goes into the full reference.

ModelPort: a desktop console for an OpenAI-compatible proxy gateway (local / WSL / remote) - 92
aggregate entries / 580 models, 15 account channels, custom providers.

## Build and gate

`npm run gate` is the only acceptable proof of "done": `npm run build` + `npm run build:daemon` +
`tsc --noEmit` on `tsconfig.json` and `tsconfig.node.json` + the full `node --test` suite.
`npm run dev` / `npm run dev:win` for development.

- `electron-vite build` transpiles without type checking; both tsc programs must be 0 errors.
  Never add a `references`/`composite` link between the two configs (real errors become TS6305).
- Node must natively strip TS (22.18+ / 24; CI pins 24); older 22.x is `ERR_UNKNOWN_FILE_EXTENSION`.
- Eight spawn-based tests fail with `spawn EPERM` inside a pipe sandbox (4 under `tests/channels/`,
  4 `tests/skills/modelport-*`); two `tests/skills/` cases also fail on Windows checkouts. Rerun in
  a normal shell before touching source.
- The asar and the daemon tarball ship **no `node_modules`**: every main-process runtime dependency
  must be bundled by rollup (`tests/build/main-bundle-deps.test.ts`). Externalizing one is a
  startup crash.
- Release: macOS is **dmg only**, nothing is signed or notarized, and `build.publish` must match the
  repository you release from. The checkout may carry uncommitted work: check whether the failing
  file is one you edited.

## Architecture

`src/main/` (index.ts pins userData; ipc/, proxy/, oauth/, channelPack/, providers/, store/,
runtime/, daemon/, shell/, gateway/, scheduler/), `src/preload/`, `src/renderer/` (React),
`src/shared/`. Flow: `server.ts` → `routes/chat.ts` → `forwarder.ts` (`providerForwarders`
registry) → `adapters/<provider>.ts` → upstream; `loadbalancer.ts` picks the account,
`modelMapper.ts` resolves names, `quota/` meters usage.

## Proxy / API invariants

- **Auth is fail-closed.** Any enabled key → `/v1/*` always requires it (Bearer or `X-API-Key`,
  constant-time compare). No key → loopback bind only and `start()` refuses other hosts. No
  `?api_key=`.
- **`usage` is `null`, never fabricated.** Same for `/v1/models` `context_window`: omit the key
  rather than emit `0` or a guess. The gate is *direction of error*, not source label: manual marks,
  upstream declarations and the `probe` lower bound may be advertised; `catalog`, `family-rule` and
  third-party tables may not - a catalogue value reaches clients only as a manual mark.
  `X-ModelPort-Context-Window` must read `advertisedContextWindow`, never the ungated
  `contextWindow` that logs and the UI use.
- **`/v1/models` advertises routes only.** The list and `GET /v1/models/:model` share one name
  domain. Enabled state decides route-pool membership and whether a named request is accepted,
  never what a client can list. A stopped alias is `ModelMapping.disabled` (declared in both
  `types.ts`, read through `modelServing.ts::isMappingActive` at every use site), not
  `excludedModels`.
- **Every stream carries exactly one `[DONE]`.** A post-stream failure is a `data: {"error": …}`
  frame, never assistant text; prefill is `: PING` comments, not fabricated tokens. Errors keep
  the upstream status and `type`/`code`/`param`; fallbacks are 401 `authentication_error`, 403
  `permission_error`, 404 `not_found_error`, 429 `rate_limit_error`, 5xx `api_error`. **Never
  rewrite 403 into 401.**
- **Freeform (`custom`) tools keep their item type on the Responses lane.** Codex `apply_patch` is
  freeform: raw text, `custom_tool_call` / `custom_tool_call_output`, with a required string
  `input`. Outbound must answer `custom_tool_call` (a `function_call` silently drops the write),
  and those items must be read back from history. **Parallel tool calls collapse into one assistant
  message** on the chat leg: `pushToolCall` merges consecutive calls, keeps reasoning on that
  message, closes the batch at the first result. Strict upstreams reject the split shape (MiniMax
  2013), which `isToolCallOrderingError` turns into a failover.
- **System-store trust is not "the client can connect".** `installCertificateTrust()` satisfies
  Chromium/Schannel only; Node clients (Codex CLI, WorkBuddy/CodeBuddy) need `NODE_EXTRA_CA_CERTS`
  - the PEM from `GET /v1/management/tls/ca`. A refused handshake writes no row and no
  `X-Request-Id`: read `handshakeRejections` before concluding the gateway saw nothing.
- **The gateway authors no prompt text** (ruling 2026-11-03, amended 2026-11-12). Only two protocol
  blocks are exceptions: `ccr-protocol` (marker meaning + `GET /v1/ccr/<hash>`) and
  `say-less-contract` (opt-in output level). Each is its own leading `system` message,
  byte-identical every turn, off unless the *conversation* was compressed or a level was chosen
  (`gatewayProtocolMemory.ts` remembers it, so it cannot flip and drop the cached prefix).
  Everything else stays retired. Tools travel natively: "no tools" is a routing fact (`needsTools`
  → `missing:['tools']`), never a prompt; shape transforms stay allowed. Every live site is tagged
  `GATEWAY-TEXT: <id>` and reconciled two-way with `docs/AGENTS-full.md` by
  `tests/proxy/gateway-authored-text.test.ts`; retired config keys are stripped in `normalizeConfig`.
- **Failover status policy.** 400 is terminal (capability-mismatch 400s excepted); 401-407, 404,
  409-499, 5xx and network errors switch; 408/504/524 switch but are never retried against the same
  target. 404 switches with no cooldown; client-caused 400/404/422 never penalize an account. A pack
  machine code that says the request itself cannot be served (`INVALID_REQUEST` /
  `UNSUPPORTED_CONTENT` / `MISSING_CREDENTIAL` / `AUTH`, `isDeterministicChannelRejection`) also stops
  in-place retries even when the pack wrapped it in a 502; switching stays allowed.
- **A silent single-candidate channel fails fast.** Two consecutive first-block timeouts (504 carrying
  `FIRST_BLOCK_TIMEOUT_CODE`) with no success in 10 min arm a 60 s → 5 min window per
  `(account, model)`; the named path then answers 503 `first_block_silent_skip` + `Retry-After`
  without dispatching, and a success (or a channel pool/credential change) clears it. Slow-but-alive
  channels (a success between the 504s) never trip - "slow" is not the predicate, "never succeeds" is.
- **History trimming never empties history.** Always keep the newest non-system message;
  `messages: []` is rejected upstream as "non-empty array required". **Output cap** arrives as
  `max_tokens` or `max_completion_tokens`, folded by `normalizeOutputCap` (alias wins).
- **Parameters.** Built-in providers silently drop `response_format`, `stream_options`, `logit_bias`,
  `seed`, `max_tokens`, `top_p`, `stop` and the penalties (`parameterPolicy.ts`); only `n > 1`
  returns 400, and custom / aggregate pass everything through. **Dynamic header values** go through
  `toHeaderValue` (non-ASCII percent-encoded); a raw provider name means `ERR_INVALID_CHAR` → 500.
- **Every `/v1/*` response carries `X-Request-Id`** matching its request-log row.

## Routing, degradation, quota

- **A turn serves one model** (`ModelRoute.modelScope`, default `single`; `family` = same
  `modelFamilyKey`; `pool` = the pre-A cross-model failover, still selectable). Trimming happens in
  `autoRouter.select()` *after* the soft pin and the circuit reorder, so a user pick or a degraded
  model changes the head of that turn; from there only accounts of that one model are tried, and the
  wall clock is 40 s (`AUTO_SINGLE_SCOPE_BUDGET_MS`) rather than 90 s. `minTier` is a route **floor**
  (`applyMinTier`, after the name pin, before pool strategies and manual includes: neither can bring
  a model back), distinct from the `strong-tier` / `balanced-tier` equality strategies; an empty
  result reports `missing: ['min_tier']`, and the preview status is `below-tier`. Cross-model switching is a
  **between-turn** act, never a mid-conversation one: context understanding, tool protocol and the
  prefix cache do not survive it, and a client that loses them mid-turn reads it as a crash. `pool`
  keeps the partition-as-order semantics (`forwardFirstReachable` advances to the next model on any
  allowed failure until the 90 s clock / `baseCap` runs out) - that is what the tier is for. Never
  re-introduce a per-model fence inside `pool`; never widen `single` back into one. A bare 400
  switches without an account penalty, capped at `MAX_REJECTED_REQUEST_SWITCHES` = 2; a client abort
  is terminal.
- **An empty pool names its cause.** Config pruning and capability mismatch stay 503
  `no_available_model` + `details.missing`; a pool emptied only by self-resetting state (quota window,
  exhaustion mark, daily limit) is 429 `model_temporarily_unavailable` + `Retry-After`
  (`transientUnavailable`). Cooldown never empties the pool (the soonest-waking group is kept, so the
  client sees the real upstream 429); `todayUsed` is day-keyed (`dailyUsageOf`) - never read raw.
- **Soft pin > `preferredModel` > sticky.** `ModelPin` lives in memory only (route or session scope,
  30 min; tray-issued pins default to `TRAY_PIN_MINUTES` = 10 and the menu says they affect every
  client of that route), and a pin is **not** vetoed by the model circuit: user intent outranks an
  automated ticket, and the menu still marks that model as circuited. A pin naming a model absent
  from the pool is decision-time `pinStale`, split by lifetime: a **soft pin** is retired and the
  turn fails fast (503 `pin_stale`, zero candidates - serving the ordinary order instead was 3x 504
  because the client kept talking to a model that never ran); **`preferredModel`** is not deleted by
  the selector (only `routes:unpin` revokes config) - it serves the ordinary order and reports
  `pinStale.action: 'ignored'`. Both also report `pinMiss`; the menu carries `pin.stale`. A **soft pin** is
  retired only when the name is absent from the pre-rank pool (`rankInputs`): all-cooling accounts give
  `pinCooling` (429 + `Retry-After`, pin kept), a capability/contract miss gives `pinBlocked` (503 naming
  what is missing) - both return zero candidates and keep the pin. `reason` is
  computed **before** the `single` scope trim (`pin` / `only` / `cache-affinity` / `sticky` /
  `score`) - post-trim every single-scope row reads `only`. `preferredModel` is the persistent form (`until: 0`, no countdown), written by
  `routes:switch` with `persist: true` (the console's 「长期」; config write + broadcast, soft pin
  cleared so the menu reads "一直"). A **mapping alias named like a route never takes effect** - route
  names win in `findModelRoute`, so the mapping panel refuses such a key and flags existing rows. The **model circuit**
  (`(route, model)` → 5 min, memory only) is tripped by `modelQualityDegradation` - the five classes
  where the model itself failed to finish the job (② repetition, ③ empty turn, ④ announced stop, ⑦
  prose-only fallback stop, ⑧ synthesized incomplete step) - and by nothing else: ⑤ upstream
  truncation and ⑥ slow first token lift the anchor for one turn without condemning the model.
  A trip demotes it to the tail instead of deleting it, switches itself off when every model is
  circuited, and is cleared by the first success in `rememberRoute`.
- **The switching surface is one menu, three wires.** `routes:menu` / `routes:switch` /
  `routes:unpin` are served by `autoRouter.routeMenu()` / `switchModel()` / `clearPin()`. The tray
  never calls them: the shell does not hold the management secret, so it asks the page
  (`shell:route-menu-request`), the page runs the RPC and publishes `shell:route-menu`, and clicks
  come back as `shell:route-command` intents - both gate on
  `event.sender === window.webContents`. `switchModel` refuses session scope when the caller is the
  tray. Three absences stay distinct in the menu: no snapshot yet, read failed, no enabled routes.
  `preview()` is short-cached (15 s, 64 entries, key = resolved pool) and returns a `structuredClone`
  both ways - one menu open measured p50 4.7 s / p90 10.2 s of full-pool scans.
- **Eight degraded classes** revoke the sticky anchor; ②③④ also count for AIMD/Bandit: ①
  unrequested `finish_reason=length`; ② the trailing-128-line dedup ratio (`repetition`); ③ tools
  offered, `done`, zero content **and** zero tool calls (`emptyTurn.empty`); ④ the same but content
  ends with `:`/`：` (`announcedStop`); ⑤ upstream truncation at the settle path (a cap the client
  sent is explicit and never penalised); ⑥ `firstTokenMs` above the latency-gate p75 when `done`; ⑦ a
  fallback-served (`auto.attempts > 1`) prose-only stop. ⑥⑦ lift only the anchor - no AIMD,
  Bandit or account penalty. ⑧ the **synthesized incomplete step**: seven conditions that are not an
  output cap (tool-arg JSON truncated, empty required args, unnamed call dropped, stream cut, tools
  never announced, prose cut by a stop string, reasoning loop) used to collapse into
  `{kind:'max-tokens'}` in the channel pack, so clients read `incomplete/max_output_tokens`. They now
  carry their cause and project as a 502 `incomplete_step` error frame; genuine `length` stays
  unlabeled. ⑧ revokes the anchor and votes the model circuit, and never shrinks AIMD (the account
  answered - the model did not finish). A degraded reading must reach the Bandit table: rows carry it
  **nested under `streamTrace`** (`isDegradedSuccess` accepts both).
- **Stickiness** is a hard pin by default (`stickyHardPin`, absent = on, read as `!== false`);
  turning it off leaves only the +0.12/+0.06 score bonus. **Latency is a gate**: skip the promotion
  when the would-be-promoted candidate exceeds the pool's p75 `ewmaFirstTokenMs`
  (`poolLatencyGateMs`; under 4 readings = no judgement), and pass that same `latencyGateMs` to
  the settle path. "Pool" here means the **scope**: under `single` it is the head model's accounts,
  under a pin the pinned model's accounts - never the whole ranked list, which would judge a model
  by a race it does not run in.
- **AIMD** per `(account, model)`: concurrency 4, clamped to 2..16; 429/timeout/5xx shrink it
  multiplicatively (30 s between drops, so one outage wave drops once); 5 clean successes +1 after
  30 s quiet. A local rejection is 429 `local_concurrency_limit`, failing over without penalizing
  the account. **Exhausted chain**: exactly one internal wait (`planRecoveryWaitMs`) =
  `min(remaining clock, upstream unlock, 15 s)`, default 5 s, after `endAttempt` (so it holds no
  AIMD slot); arrears / not-subscribed are out, and so is anything `permanentRefusalCooldownMs`
  classifies - re-walking a permanent refusal only pays it twice. **Cooldown tiers**: account 15 s →
  2 min, per `(account, model)` 429 60 s → 10 min, credential 5 → 30 min, plus two terminal tiers
  maxed with the exponential and with upstream `Retry-After`: 6 h for payment/subscription refusals
  and 1 h for quota-window exhaustion (`free_usage_limit`, daily limit, all channels throttled). The
  classifier is narrow on purpose and never matches a bare 429 / "rate limit" / "for your
  subscription tier".
- **Live credit is a gate, never a number**: `creditSnapshotExhausted` is the only judgement; USD
  credit, CNY balance and the token ledger never convert, one click = one GET per key and nothing
  polls. **A witnessed quota refusal** is a fourth, non-comparable layer
  (`aggregateQuotaExhaustion.ts`): mark that `(entry, account, model)` until `Retry-After` or
  30 min, cleared by the first success. Bare 429 / rate limits are never marked.
- **Quota caps and pricing are generated sidecars** (`shared/aggregate*.ts`): edit receipts under
  `docs/data/**`, rerun the builder, never hand-edit output. `undocumented` never blocks; non-token
  caps never convert; reset times are derived; `smart`/`pace` fall back to `fill-first`.
  **Cache-first compression** (`cacheFirst`, default on) skips live-zone compression when a cheap
  documented prefix cache exists and the saving beats `1 - c/(1+w)`. `LoadBalanceStrategy` is
  declared twice (`shared/types.ts`, `main/store/types.ts`) plus UI maps and both locales.

## Data and store

- Data lives in `~/.modelport/`; Electron `userData` is pinned to `<appData>/modelport`
  (`safeStorage` seals `store.key` against it - do not unpin). `data.json` is one conf file
  (config, providers, accounts, statistics, logs); `userModelMarks` stays out of
  `userModelOverrides` so a sync cannot erase a correction. **A name is retired only when no shipped
  definition claims it** (`isRetiredProviderId`: builtin + aggregate + channel), never
  `RETIRED_PROVIDER_IDS` alone - five of its names are live and a key is an account of that id.
- Startup force-overwrites builtin `apiEndpoint`/`chatPath`/`supportedModels`/`modelMappings`/
  `headers`/`credentialFields`/`description` from code and deletes unknown builtin ids: edit
  `providers/builtin/<provider>.ts` only (`builtinProviders` is currently empty).

## Host boundary

- Three hosts share `bootstrapGateway()`: windowless Electron (local), headless Node daemon
  (`daemon/entry.ts`, WSL), and the retired `--desktop` dev host. Host-specific work goes through
  `runtime/host.ts`. **Nothing under `proxy/`, `providers/`, `store/`, `scheduler/` or
  `channelPack/` may import `electron`** (`tests/build/daemon-bundle.test.ts`).
- `store.key` on a keystore-less host is `sealed-unreadable`: `initialize()` throws and leaves the
  file alone, never routed through the corrupted-data backup. `/v1/management/rpc` (+ `/events`)
  is the handler registry minus `app:installUpdate`/`app:downloadUpdate` - never a second list.
  `/ui/` serves the built renderer (public bytes, trailing slash) where `getWebRoot()` exists.
- Backup import has three entries (dialog, `--import-backup`, `POST .../backup/stage`) and one
  engine (`stageBackupFile`); export writes through the save dialog on desktop and returns the
  payload for a browser download on headless hosts (`delivery: 'payload'`). Management secret: browser
  `sessionStorage`, or `secrets.json` 0600 per origin sealed by the console - which refuses to write
  with no keystore (`gateways.json` stays credential-free).
- One installer per platform plus `dist/modelport-daemon-<ver>-<arch>.tar.gz` and a Docker image
  tarball (`modelport-daemon-<ver>-docker-<arch>.tar.gz`, `docker load` ready); the console is a thin
  argv orchestrator (dynamic imports only - `tests/build/shell-entries.test.ts`), no `latest.yml` is
  published (updates use release assets + `.sha256`), and headless persistence needs a
  **system-scope** unit (`systemctl --user` dies with the login session). The update check reads
  `releases.atom` and derives asset URLs from the tag (`releaseFromTag`) - never the anonymous REST
  API, whose 60-per-hour-per-IP quota turns a spent budget into a bare 403 on every check.

## Logging

- Request rows carry `requestId`, `attempts[]`, `streamTrace` (first token, total, bytes, end
  reason, `[DONE]`, pings, upstream id), `errorType`/`Code`/`Param`, `upstreamStatus`/id; retention
  floors are 100 error request rows and 500 error app logs, **bounded by `logRetentionDays`** - an
  unbounded floor turns the floor into the reading. Log-panel counters come from
  `statistics.dailyStats`, never by counting retained rows.
- Bodies have exactly three knobs: `includeBodies`, a per-request `X-ModelPort-Trace: 1`, and
  `bodySampleRate` (a hash of `requestId`, never a coin flip); `bodyRetentionDays` (7) strips the
  body and `captureBodies` but keeps the row, and sampling defaults to 0.
- Timed log writes are async and atomic; `flushSync()` is the quit path. `console.*` is mirrored by
  `consoleBridge.ts`; a sink must never report its failure through `console.*` (use
  `process.stderr`). Settings forms must not render editable controls before `appConfig` loads
  (`ProxyConfigForm`).

## Extending

A provider touches five places (details: `docs/AGENTS-full.md` §Adding a New Provider):
`providers/builtin/<provider>.ts` (or the aggregate registry) → register in
`providers/builtin/index.ts` → `oauth/adapters/<provider>.ts` + that folder's `index.ts` → proxy
adapter in `proxy/adapters/<provider>.ts` (stream handler in the same file) + `adapters/index.ts`
→ one entry in `forwarder.ts`'s `providerForwarders`, plus the icon mapping and i18n.

## Sessions

One checkout, three ways in; identify the row, then do not mix them. CodeBuddy WSL remote
(Linux paths directly): load `~/.codebuddy/rules/*.mdc`, `CODEBUDDY.md`, `memory/MEMORY.md`. Qoder
local (`Z:\ModelPort`): run via `ssh ... wsl "cd /home/polit/projects/ModelPort && <cmd>"` and load
`.qoder/rules/00-execution-ssh.md`. WorkBuddy local: per `.workbuddy/` rules.

`Z:` is SMB of WSL `/home/polit/projects` - same checkout, no copy. Never build, test or search on
`Z:`; never read `~/.codebuddy/...` from a `Z:` session. Entry: `scripts/wsl-project.sh`.

## Pointers

Coding: return new objects, never mutate; validate at the boundaries, never trust external data,
rotate exposed secrets; the UI gets friendly errors while the server logs detail; never swallow an
error. macOS ARM64 keeps `app.commandLine.appendSwitch('js-flags', '--jitless --no-opt')`. Detail in
`docs/AGENTS-full.md` (§Public API Contract, §Auto Routing, §Pool failover, §Degenerate Stream
Detection, §Gateway-Authored Text, §Aggregate Provider Catalogue, §Aggregate Free-Quota Layer,
§Account Channels, §HTTPS Listener and Certificate Trust, §Data Storage, §Adding a New Provider);
designs / plans / audits / manuals: `docs/README.md`.
