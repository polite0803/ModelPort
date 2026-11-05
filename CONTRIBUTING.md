# Contributing to ModelPort

Thanks for taking the time to contribute. This document covers the local workflow, the verification
gate and the rules that are easy to break without noticing.

## Before you start

- Read [README.md](README.md) for the product overview and user-facing build instructions.
- Read [docs/README.md](docs/README.md) for the documentation index, and
  [docs/AGENTS-full.md](docs/AGENTS-full.md) for the subsystem reference.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.
- By participating you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Development setup

Requirements: Node.js 22.18+ (24 recommended, pinned in `.nvmrc`), npm and Git.

```bash
git clone https://github.com/polite0803/ModelPort.git
cd ModelPort
npm ci

npm run dev      # macOS / Linux
npm run dev:win  # Windows (sets the console code page and builds the channel pack)
```

Use `npm ci` rather than `npm install` so the lockfile is not rewritten by accident.

## Verification

The only acceptable proof that a change is complete is the repository gate:

```bash
npm run gate
```

It runs, in order:

1. `npm run build` (source-artifact guard + channel-pack build + `electron-vite build`)
2. `tsc --noEmit -p tsconfig.json` (renderer + shared)
3. `tsc --noEmit -p tsconfig.node.json` (main + preload + shared)
4. the full Node test suite over `tests/**/*.test.ts`, `tests/**/*.test.mjs` and
   `tests/**/*.test.js`

Do not weaken, skip or rewrite tests to get a green run. If a test is genuinely environment-specific,
explain the evidence in the pull request instead of changing the gate.

Two environment caveats, documented in `AGENTS.md`:

- Node must natively strip TypeScript (22.18+ / 23.6+ / 24). An older 22.x fails every `.test.ts`
  with `ERR_UNKNOWN_FILE_EXTENSION`; that is a runtime error, not a test failure.
- Eight test files cannot run in a pipe/spawn-blocking sandbox (`spawn EPERM`) because they start an
  esbuild child process or call `spawnSync('node', …)`. Re-run them in a normal shell.
- Some tests compare source text or fixture paths and can fail on a Windows checkout when the
  working tree uses CRLF or a macOS-only fixture path. Check the test's own assumptions before
  blaming your change.

## Rules that are easy to break

- **Never modify `src/` only to satisfy a test.** Fix the behavior or the test's premise, not the
  assertion.
- **The gateway authors no prompt text.** Do not add a system/user turn, append to the client's
  system prompt or replace message content with prose. See the `GATEWAY-TEXT` rule in
  [AGENTS.md](AGENTS.md).
- **Generated sidecars are generated.** Quota, pricing and capability tables under
  `src/shared/aggregate*.ts` are built from receipts in `docs/data/**`; edit the receipts and re-run
  the builder instead of hand-editing the output.
- **Built-in provider config lives in code.** Runtime changes to builtin `apiEndpoint`, paths,
  model lists, mappings, headers and credential fields are overwritten on startup.
- **Do not commit build output or local scratch.** `dist/`, `dist-shell/`, `out/`, `output/`,
  `dist-nsis-try/`, `*.tsbuildinfo`, logs and local caches are ignored; keep them out of commits.
- **Keep pull requests focused.** Separate refactors from behavior changes, and avoid drive-by
  rewrites of files you do not need to touch.

## Pull requests

1. Fork the repository and create a topic branch from `main`.
2. Make the change and run `npm run gate` locally.
3. Update documentation when behavior or configuration changes. The documentation index is
   [docs/README.md](docs/README.md); user-visible changes are recorded in
   [CHANGELOG.md](CHANGELOG.md) when that file is present.
4. Fill in the pull request template: summary, type of change, linked issue and verification.
5. CI must pass before merge. Do not force-push over review feedback unless a reviewer asks for it.

If you are adding a provider, follow the five-part checklist in
[AGENTS.md](AGENTS.md) and the provider notes in [docs/providers/README.md](docs/providers/README.md).
