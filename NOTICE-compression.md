# Third-party attribution

## headroom

`src/main/proxy/compression/` ports a subset of
[headroom](https://github.com/headroomlabs-ai/headroom) to TypeScript.

- Copyright: headroomlabs-ai
- License: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
- Upstream revision referenced: `main` @ 2026-10-29

Ported (reimplemented in TypeScript, no upstream code is vendored verbatim):

- live-zone selection and byte-range replacement (`transforms/live_zone.rs`,
  `compression/live_zone_openai.rs`)
- content-type detection cascade (`transforms/content_detector.py`)
- statistical JSON row selection — `SmartCrusher` (`transforms/smart_crusher/`):
  outlier and rare-status detection, 2σ numeric anomalies, change points,
  anchor budget, adaptive retention sizing, and the final budget governor
- adaptive retention sizing (`transforms/adaptive_sizer.py`)
- error-keyword preservation (`signals/keyword_detector.rs`, `error_keywords.rs`)
- CCR marker shapes and the content-addressed store (`crates/headroom-core/src/ccr/`,
  `crusher.rs` marker rendering)

Not ported, deliberately: the Kompress-v2-base ML compressor, tree-sitter
`CodeCompressor`, `HTMLExtractor` (trafilatura), `DiffCompressor`, and the
lossless table compaction path. See `docs/plan/PLAN-token-compression.md` for why.

This attribution covers the ported subset only. Changes made here are our own;
they are not reviewed by or endorsed by the headroom project.
