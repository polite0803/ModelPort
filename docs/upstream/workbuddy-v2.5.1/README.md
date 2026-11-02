# Upstream WorkBuddy snapshot (v2.5.1)

Provenance: `Ebony-Vinyl/dsh-our-free-model` tag `v2.5.1`, commit `3df868aaeaf26af5bf611fc61a909fcc0139d159`, MIT.
Staged verbatim from `vendor/channel-pack/src/` for adaptation planning
(`docs/PLAN-workbuddy-adaptation.md`); not imported by the build.

Why this tag rather than `master`: `master`'s `buddy-adapter.ts` is ~291 KB and
depends on `model-catalog.ts` / `catalog-broadcast.ts` / `session-title.ts` /
`native-search-contract.ts` / `openai-gateway/tencent-fingerprint.ts` (a much newer
tree). v2.5.1 is the last snapshot whose dependency set matches this repository's
vendored pack almost one-for-one (`account-pool`, `remote-catalog-gate`,
`settings-compat`, `sse` exports, `llm-register-compat`, `token-ledger`,
`message-shape`, `image-budget` all present locally with the same export set).

## Files

| File | Bytes | SHA-256 |
|---|---|---|
| `buddy.ts` | 42615 | `025e3ef4e9f04acda1960b47ae6d9fb2bbf92b1ecd6da1b0ed941d0ed1f2ee84` |
| `product.ts` | 22642 | `6ec3e33d1b378111b92fe65ed0edc04945bd136040ae1fcc411e1b9b86fa6d96` |
| `buddy-oauth.ts` | 24232 | `f8333adfb6890af02717e87fe0f7901636de8d191e1116d03e313249df82a103` |
| `buddy-auth.ts` | 21198 | `fbbd0d2a3177fb6bb717de9757265084e3cfbfd594b369dd14d15e27d35211c1` |
| `buddy-adapter.ts` | 131109 | `81382d0d802d257a1b9ae25330d8db4e9c08c649b6191ec9816f5f3def34232c` |
| `buddy-balance-rank.ts` | 11986 | `9716220f5882b55b13f699dd7253510d8a369c82fae4d7bdf47561ee19035fb1` |
| `buddy-balance-selector.ts` | 17276 | `b8e76a816c247ff52079fa9ff401c5aca21b082ecdac67b95cd081c498a642b5` |
| `openai-gateway/tencent-fingerprint.ts` | 7590 | `d23dffcd2b2579fad4f8ce71b64236bf2b6abb83092328a4ee75f670d74f4595` |
| `credits.ts` | 34207 | `3dac076bc8e3561813eef2f5f3a3436aa3efa38bd8e9d3d7282ecf7eb956bd5a` |

`credits.ts` is staged only for `fetchCreditBalance` (+ its `parseCreditPackage`
helper); this repository already has its own `credits.ts` whose other exports are
used by every shipped channel. `llm-adapter.ts` is **not** staged: only four
rate-limit helpers are needed, and the plan names their source lines.
