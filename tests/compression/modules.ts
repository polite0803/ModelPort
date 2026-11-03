/**
 * Shared import surface for the compression tests.
 *
 * Every source file in `src/main/proxy/compression/` uses explicit `.ts`
 * extensions on its relative imports (both tsconfigs set
 * `allowImportingTsExtensions`), so `node --test` can import the shipped code
 * directly instead of bundling it first.
 */

export {
  pickLiveZone,
  readLiveZoneText,
  replaceLiveZoneText,
} from '../../src/main/proxy/compression/liveZone.ts'
export {
  ROW_SENTINEL_KEY,
  JSON_HASH_LENGTH,
  BLOCK_HASH_LENGTH,
  makeRowSentinel,
  makeItemSentinel,
  makeLogMarker,
  makeSearchMarker,
  isCcrSentinel,
  stripCcrSentinels,
  isAlreadyCompressed,
} from '../../src/main/proxy/compression/ccr/markers.ts'
export {
  crushJsonArray,
  analyzeCrushability,
} from '../../src/main/proxy/compression/compressors/smartCrusher.ts'
export { compressLog } from '../../src/main/proxy/compression/compressors/logCompressor.ts'
export { compressSearch } from '../../src/main/proxy/compression/compressors/searchCompressor.ts'
export { acceptCompression } from '../../src/main/proxy/compression/policy.ts'
export { detectContentType } from '../../src/main/proxy/compression/detector.ts'
export {
  computeOptimalK,
  countUniqueSimhash,
} from '../../src/main/proxy/compression/signals/adaptiveSizer.ts'
export {
  hasErrorKeyword,
  classifyKeyword,
} from '../../src/main/proxy/compression/signals/errorKeywords.ts'
export {
  applyCompression,
  recordCompressionReport,
  takeCompressionReport,
} from '../../src/main/proxy/compression/index.ts'
