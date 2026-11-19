import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  catalogSlugs,
  claudeDesktopEndpoint,
  clientPaths,
  detectIndent,
  endpointFor,
  isClientId,
  isLoopbackHostname,
  maskSecret,
  planClaudeSettings,
  planCodeBuddySettings,
  planCodexToml,
  planTraeModelList,
  planWorkBuddyModels,
  readTomlString,
  unservedModels,
} from '../../src/shell/clientSyncPlan.ts'
import { KEY_PLACEHOLDER } from '../../src/shared/clientSync.ts'

const ORIGIN = 'https://modelport.example.test'

/**
 * Fixtures are the measured shapes, trimmed. The point of each test is that everything
 * the writer does not name survives byte-for-byte - these configs carry workspace trust,
 * MCP servers and plugin state that a "switch gateway" button must not disturb.
 */
const CODEX_TOML = [
  '# Windows-side Codex client pointed at the ModelPort gateway.',
  'model = "codex-deepseek"',
  'model_provider = "modelport"',
  'model_catalog_json = "modelport-catalog.json"',
  '',
  'sandbox_mode = "danger-full-access"',
  'notify = [ "C:\\\\Users\\\\polit\\\\codex-computer-use.exe", "turn-ended" ]',
  '[desktop]',
  'appearanceTheme = "dark"',
  'runCodexInWindowsSubsystemForLinux = true',
  '',
  '[model_providers.modelport]',
  'name = "ModelPort gateway (WSL)"',
  'base_url = "http://127.0.0.1:8080/v1"',
  'env_key = "MODELPORT_CODEX_API_KEY"',
  'wire_api = "responses"',
  '',
  '[mcp_servers.node_repl]',
  'command = "C:\\\\node_repl.exe"',
  'startup_timeout_sec = 120',
  '',
  '[projects."/home/polit/projects/ModelPort"]',
  'trust_level = "trusted"',
  '',
].join('\n')

test('endpoint shapes are the measured ones, not one guess for all clients', () => {
  assert.equal(endpointFor(ORIGIN, 'v1'), `${ORIGIN}/v1`)
  assert.equal(endpointFor(ORIGIN, 'chat-completions'), `${ORIGIN}/v1/chat/completions`)
  assert.equal(endpointFor(ORIGIN, 'origin'), ORIGIN)
  // A trailing slash in the address book must not produce a double slash.
  assert.equal(endpointFor(`${ORIGIN}/`, 'v1'), `${ORIGIN}/v1`)
})

test('maskSecret keeps enough to recognize a key and never enough to use one', () => {
  const key = `sk-${'a'.repeat(48)}`
  const masked = maskSecret(key)
  assert.ok(!masked.includes('a'.repeat(12)))
  assert.ok(masked.endsWith(key.slice(-8)))
  assert.equal(maskSecret(''), '')
})

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

test('Codex: the legacy env_key shape migrates into the provider table', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['codex-deepseek', 'auto'], writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const lines = result.content.split('\n')
  assert.equal(readTomlString(lines, 'model_providers.custom', 'base_url'), `${ORIGIN}/v1`)
  assert.equal(readTomlString(lines, 'model_providers.custom', 'experimental_bearer_token'), KEY_PLACEHOLDER)
  assert.equal(readTomlString(lines, 'model_providers.custom', 'wire_api'), 'responses')
  // The env-var indirection is gone: leaving it would outrank the token we just wrote.
  assert.equal(readTomlString(lines, 'model_providers.custom', 'env_key'), null)
  assert.equal(readTomlString(lines, null, 'model_provider'), 'custom')
  // Untouched: the catalog file name stays bare, and the legacy table is not ours to delete.
  assert.equal(readTomlString(lines, null, 'model_catalog_json'), 'modelport-catalog.json')
  assert.ok(result.content.includes('[model_providers.modelport]'))
  assert.equal(readTomlString(lines, 'desktop', 'appearanceTheme'), 'dark')
  assert.equal(readTomlString(lines, 'projects."/home/polit/projects/ModelPort"', 'trust_level'), 'trusted')
  assert.ok(result.content.includes('notify = [ "C:\\\\Users\\\\polit\\\\codex-computer-use.exe", "turn-ended" ]'))
  assert.ok(result.content.includes('startup_timeout_sec = 120'))
  // The selected model is served, so it must not move.
  assert.equal(readTomlString(lines, null, 'model'), 'codex-deepseek')
})

test('Codex: a model the target does not serve moves to auto, not to a stale name', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['daily', 'auto'], writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.equal(readTomlString(result.content.split('\n'), null, 'model'), 'auto')
})

test('Codex: without auto the first advertised route is used', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['daily', 'stable'], writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.equal(readTomlString(result.content.split('\n'), null, 'model'), 'daily')
})

test('Codex: an empty route list never rewrites the selection', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: [], writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.equal(readTomlString(result.content.split('\n'), null, 'model'), 'codex-deepseek')
})

test('Codex: re-running on the written file is a no-op', () => {
  const key = `sk-${'b'.repeat(48)}`
  const first = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['codex-deepseek'], writeKey: true, keyPreview: maskSecret(key) })
  assert.equal(first.kind, 'changed')
  if (first.kind !== 'changed') return
  const written = first.content.split(KEY_PLACEHOLDER).join(key)
  const second = planCodexToml(written, { origin: ORIGIN, routeNames: ['codex-deepseek'], writeKey: true, keyPreview: maskSecret(key) })
  assert.equal(second.kind, 'unchanged')
})

test('Codex: no provider table means one is created, not a manual step', () => {
  const result = planCodexToml('model = "gpt-5"\n', { origin: ORIGIN, routeNames: ['auto'], writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const lines = result.content.split('\n')
  assert.equal(readTomlString(lines, 'model_providers.custom', 'base_url'), `${ORIGIN}/v1`)
  assert.equal(readTomlString(lines, null, 'model_provider'), 'custom')
})

test('Codex: without a canonical key the address moves and no token is invented', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['codex-deepseek'], writeKey: false })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.ok(!result.content.includes(KEY_PLACEHOLDER))
  assert.equal(readTomlString(result.content.split('\n'), 'model_providers.custom', 'base_url'), `${ORIGIN}/v1`)
})

test('Codex: CRLF is preserved', () => {
  const crlf = CODEX_TOML.replace(/\n/g, '\r\n')
  const result = planCodexToml(crlf, { origin: ORIGIN, routeNames: ['codex-deepseek'] })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.ok(result.content.includes('\r\n'))
  assert.ok(!/[^\r]\n/.test(result.content))
})

test('catalog slugs are read for the unserved report, never rewritten', () => {
  assert.deepEqual(catalogSlugs('{"models":[{"slug":"auto"},{"slug":"daily"}]}'), ['auto', 'daily'])
  assert.equal(catalogSlugs('{"nope":1}'), null)
})

// ---------------------------------------------------------------------------
// WorkBuddy
// ---------------------------------------------------------------------------

const WORKBUDDY_MODELS = JSON.stringify(
  [
    { id: 'daily', name: 'daily', vendor: 'Custom', url: 'http://127.0.0.1:8080/v1', apiKey: 'sk-old', supportsToolCall: true },
    {
      id: 'deepseek-flash',
      name: 'DeepSeek-V4.1-Flash',
      vendor: 'DeepSeek',
      url: 'https://api.deepseek.com/chat/completions',
      apiKey: 'sk-direct',
      maxOutputTokens: 384000,
    },
  ],
  null,
  2,
)

test('WorkBuddy: only Custom rows move; the direct DeepSeek row is untouched', () => {
  const result = planWorkBuddyModels(WORKBUDDY_MODELS, { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  assert.equal(parsed[0].url, `${ORIGIN}/v1`)
  assert.equal(parsed[0].apiKey, KEY_PLACEHOLDER)
  assert.equal(parsed[0].supportsToolCall, true)
  assert.equal(parsed[1].url, 'https://api.deepseek.com/chat/completions')
  assert.equal(parsed[1].apiKey, 'sk-direct')
  assert.equal(parsed[1].maxOutputTokens, 384000)
})

test('WorkBuddy: no Custom row is "no-entry"', () => {
  const result = planWorkBuddyModels('[{"id":"x","vendor":"DeepSeek"}]', { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'no-entry')
})

test('WorkBuddy: with routes the Custom rows are rebuilt to exactly those routes', () => {
  const routes = [
    { name: 'auto', displayName: 'auto', contextWindow: 200000 },
    { name: 'performance', displayName: 'performance', contextWindow: 131072 },
  ]
  const result = planWorkBuddyModels(WORKBUDDY_MODELS, { origin: ORIGIN, writeKey: true, routes })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  const custom = parsed.filter((row: any) => row.vendor === 'Custom')
  assert.equal(custom.length, routes.length)
  assert.deepEqual(custom.map((row: any) => row.id), ['auto', 'performance'])
  for (const row of custom) {
    assert.equal(row.url, `${ORIGIN}/v1`)
    assert.equal(row.apiKey, KEY_PLACEHOLDER)
    assert.equal(row.supportsToolCall, true) // capability copied from the existing Custom row
  }
  // The direct DeepSeek row is never touched.
  const direct = parsed.find((row: any) => row.vendor === 'DeepSeek')
  assert.equal(direct.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(direct.apiKey, 'sk-direct')
})

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

test('Claude: a missing settings.json is created with the bare origin', () => {
  const result = planClaudeSettings(null, { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  // Claude's SDK appends /v1/messages itself; a /v1 suffix here would double it.
  assert.equal(parsed.env.ANTHROPIC_BASE_URL, ORIGIN)
  assert.equal(parsed.env.ANTHROPIC_AUTH_TOKEN, KEY_PLACEHOLDER)
})

test('Claude: unrelated env keys and settings survive', () => {
  const raw = JSON.stringify({ env: { FOO: 'bar', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080' }, permissions: { allow: ['Bash'] } }, null, 2)
  const result = planClaudeSettings(raw, { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  assert.equal(parsed.env.FOO, 'bar')
  assert.deepEqual(parsed.permissions, { allow: ['Bash'] })
  assert.equal(parsed.env.ANTHROPIC_BASE_URL, ORIGIN)
})

test('Claude: no model name is invented - the gateway maps inbound names itself', () => {
  const result = planClaudeSettings(null, { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.ok(!result.content.includes('ANTHROPIC_MODEL'))
})

// ---------------------------------------------------------------------------
// CodeBuddy CN
// ---------------------------------------------------------------------------

const CODEBUDDY_SETTINGS = JSON.stringify(
  {
    'codingcopilot.enableInlineChat': true,
    'oaicopilot.baseUrl': 'https://ark.cn-beijing.volces.com/api/coding/v3',
    'oaicopilot.models': [{ id: 'ark-code-latest', owned_by: 'volcengine', context_length: 256000, vision: false }],
    'oaicopilot.retry': { enabled: true, max_attempts: 5, interval_ms: 2000 },
    locale: 'zh-cn',
  },
  null,
  2,
)

test('CodeBuddy CN: baseUrl moves, models and retry policy stay', () => {
  const result = planCodeBuddySettings(CODEBUDDY_SETTINGS, { origin: ORIGIN, writeKey: false })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  assert.equal(parsed['oaicopilot.baseUrl'], `${ORIGIN}/v1`)
  assert.deepEqual(parsed['oaicopilot.models'], [{ id: 'ark-code-latest', owned_by: 'volcengine', context_length: 256000, vision: false }])
  assert.deepEqual(parsed['oaicopilot.retry'], { enabled: true, max_attempts: 5, interval_ms: 2000 })
  assert.equal(parsed.locale, 'zh-cn')
  // The key is in encrypted storage, so no placeholder may appear here.
  assert.ok(!result.content.includes(KEY_PLACEHOLDER))
})

test('CodeBuddy CN: no oaicopilot.baseUrl is "no-entry"', () => {
  assert.equal(planCodeBuddySettings('{"locale":"zh-cn"}', { origin: ORIGIN, writeKey: false }).kind, 'no-entry')
})

test('CodeBuddy CN: with routes the model list is rebuilt from the gateway routes', () => {
  const routes = [
    { name: 'auto', displayName: 'auto', contextWindow: 200000 },
    { name: 'stable', displayName: 'stable', contextWindow: 131072 },
  ]
  const result = planCodeBuddySettings(CODEBUDDY_SETTINGS, { origin: ORIGIN, writeKey: false, routes })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  assert.equal(parsed['oaicopilot.baseUrl'], `${ORIGIN}/v1`)
  const models = parsed['oaicopilot.models']
  assert.equal(models.length, routes.length)
  assert.deepEqual(models.map((model: any) => model.id), ['auto', 'stable'])
  assert.equal(models[0].context_length, 200000)
  assert.equal(models[1].context_length, 131072)
  assert.equal(models[0].owned_by, 'volcengine') // template field carried over
  // Unrelated settings survive; the key is never emitted (it is in encrypted storage).
  assert.deepEqual(parsed['oaicopilot.retry'], { enabled: true, max_attempts: 5, interval_ms: 2000 })
  assert.equal(parsed.locale, 'zh-cn')
  assert.ok(!result.content.includes(KEY_PLACEHOLDER))
})

// ---------------------------------------------------------------------------
// TRAE
// ---------------------------------------------------------------------------

const TRAE_CUSTOM = {
  name: 'custom_openai_compatible//daily',
  display_name: '日常',
  provider: 'custom_openai_compatible',
  ak: 'UqUgwu-encrypted-108-chars',
  sk: '',
  base_url: 'http://192.168.0.239:8080/v1/chat/completions',
  custom_model_id: '3186135298',
  is_custom_base_url: true,
  auth_type: 0,
  status: true,
  selectable: true,
}
const TRAE_DIRECT = {
  name: 'deepseek//deepseek-flash',
  display_name: 'DeepSeek-flash',
  provider: 'deepseek',
  ak: 'direct-encrypted',
  base_url: 'https://api.deepseek.com',
  custom_model_id: '3193546370',
  is_custom_base_url: false,
}
const TRAE_MAP = JSON.stringify({
  solo_agent: [TRAE_DIRECT, TRAE_CUSTOM],
  agent: [TRAE_CUSTOM],
  assistant: [TRAE_CUSTOM],
  builder: [{ name: 'preset', provider: 'trae' }],
  notAnArray: 'keep me',
})

test('TRAE: every agent label is repointed, not just the first', () => {
  const result = planTraeModelList(TRAE_MAP, { origin: ORIGIN, writeKey: false })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  const url = `${ORIGIN}/v1/chat/completions`
  assert.equal(parsed.solo_agent[1].base_url, url)
  assert.equal(parsed.agent[0].base_url, url)
  assert.equal(parsed.assistant[0].base_url, url)
  // One change row per model, not one per label - a dozen identical rows bury the fact.
  assert.deepEqual(result.changes.map(change => change.label), ['日常'])
})

test('TRAE: ak, name and custom_model_id survive, so the selection survives', () => {
  const result = planTraeModelList(TRAE_MAP, { origin: ORIGIN, writeKey: false })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const entry = JSON.parse(result.content).assistant[0]
  assert.equal(entry.ak, TRAE_CUSTOM.ak)
  assert.equal(entry.name, TRAE_CUSTOM.name)
  assert.equal(entry.custom_model_id, TRAE_CUSTOM.custom_model_id)
  assert.equal(entry.is_custom_base_url, true)
  assert.ok(!result.content.includes(KEY_PLACEHOLDER))
})

test('TRAE: the direct DeepSeek model and non-array members are untouched', () => {
  const result = planTraeModelList(TRAE_MAP, { origin: ORIGIN, writeKey: false })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  assert.deepEqual(parsed.solo_agent[0], TRAE_DIRECT)
  assert.deepEqual(parsed.builder, [{ name: 'preset', provider: 'trae' }])
  assert.equal(parsed.notAnArray, 'keep me')
})

test('TRAE: re-running is a no-op', () => {
  const first = planTraeModelList(TRAE_MAP, { origin: ORIGIN, writeKey: false })
  assert.equal(first.kind, 'changed')
  if (first.kind !== 'changed') return
  assert.equal(planTraeModelList(first.content, { origin: ORIGIN, writeKey: false }).kind, 'unchanged')
})

test('TRAE: a map with no custom model is "no-entry"', () => {
  const result = planTraeModelList('{"agent":[{"provider":"trae"}]}', { origin: ORIGIN, writeKey: false })
  assert.equal(result.kind, 'no-entry')
})

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

test('unservedModels reports the gap instead of renaming anything', () => {
  assert.deepEqual(unservedModels(['daily', 'ark-code-latest', 'daily'], ['daily', 'auto']), ['ark-code-latest'])
  // No route list means the gateway did not answer: that is not "everything is unserved".
  assert.deepEqual(unservedModels(['daily'], []), [])
})

test('detectIndent matches the file instead of reformatting it', () => {
  assert.equal(detectIndent('{\n    "a": 1\n}'), '    ')
  assert.equal(detectIndent('{\n  "a": 1\n}'), '  ')
  assert.equal(detectIndent('{"a":1}'), '  ')
})

test('clientPaths honours CLAUDE_CONFIG_DIR and falls back to ~/.claude', () => {
  // Expectations are built with the same `join` the module uses: the separator is the
  // host's, and a test that hardcodes `\` would only pass on Windows.
  const home = join('C:', 'Users', 'polit')
  const appData = join(home, 'AppData', 'Roaming')
  const fallback = clientPaths(home, appData, undefined)
  assert.equal(fallback.claudeSettings, join(home, '.claude', 'settings.json'))
  const override = join('D:', 'claude-config')
  assert.equal(clientPaths(home, appData, override).claudeSettings, join(override, 'settings.json'))
  // A blank override is not a directory: it must fall back, not resolve to /settings.json.
  assert.equal(clientPaths(home, appData, '   ').claudeSettings, join(home, '.claude', 'settings.json'))
  assert.equal(fallback.traeCn, join(appData, 'Trae CN', 'User', 'globalStorage', 'state.vscdb'))
  assert.equal(fallback.codeBuddyCn, join(appData, 'CodeBuddy CN', 'User', 'settings.json'))
  assert.equal(fallback.codexConfig, join(home, '.codex', 'config.toml'))
})

test('only known client ids are accepted from the page', () => {
  assert.equal(isClientId('codex'), true)
  assert.equal(isClientId('trae-cn'), true)
  assert.equal(isClientId('../../etc/passwd'), false)
  assert.equal(isClientId(''), false)
})

test('no planner ever emits a plaintext key', () => {
  const outputs = [
    planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['auto'] }),
    planWorkBuddyModels(WORKBUDDY_MODELS, { origin: ORIGIN, writeKey: true }),
    planClaudeSettings(null, { origin: ORIGIN, writeKey: true }),
  ]
  for (const output of outputs) {
    if (output.kind !== 'changed') continue
    // The only key-shaped token allowed in a plan is the placeholder itself.
    assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(output.content))
  }
})

// ---------------------------------------------------------------------------
// Claude Desktop endpoint: https, or http only on loopback
// ---------------------------------------------------------------------------

test('loopback hostnames are the ones Desktop still accepts over http', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true)
  assert.equal(isLoopbackHostname('127.0.0.53'), true)
  assert.equal(isLoopbackHostname('localhost'), true)
  assert.equal(isLoopbackHostname('LOCALHOST'), true)
  assert.equal(isLoopbackHostname('::1'), true)
  assert.equal(isLoopbackHostname('[::1]'), true)
  assert.equal(isLoopbackHostname('192.168.0.235'), false)
  assert.equal(isLoopbackHostname('gw.example.test'), false)
})

test('claudeDesktopEndpoint keeps https and loopback http, uses the entry value for the rest', () => {
  assert.deepEqual(claudeDesktopEndpoint('https://gw.example.test:8443', null), { url: 'https://gw.example.test:8443' })
  assert.deepEqual(claudeDesktopEndpoint('https://modelport.bgnone.cn', null), { url: 'https://modelport.bgnone.cn' })
  assert.deepEqual(claudeDesktopEndpoint('http://127.0.0.1:8080', null), { url: 'http://127.0.0.1:8080' })
  assert.deepEqual(claudeDesktopEndpoint('http://localhost:8080', null), { url: 'http://localhost:8080' })
  assert.deepEqual(claudeDesktopEndpoint('http://192.168.0.235:18080', 'https://192.168.0.235:8443'), { url: 'https://192.168.0.235:8443' })
  assert.deepEqual(claudeDesktopEndpoint('http://192.168.0.235:18080', 'https://modelport.bgnone.cn'), { url: 'https://modelport.bgnone.cn' })
})

test('claudeDesktopEndpoint blocks a non-loopback http origin with no stored entry value', () => {
  const result = claudeDesktopEndpoint('http://192.168.0.235:18080', null)
  assert.ok('blocked' in result)
  assert.match(result.blocked, /https/)
  assert.match(result.blocked, /网关条目/, 'the way out is filling the entry, not the gateway settings')
  const invalid = claudeDesktopEndpoint('not a url', null)
  assert.ok('blocked' in invalid)
  // A stored value that is not https cannot satisfy the client either: block, never emit.
  const badValue = claudeDesktopEndpoint('http://192.168.0.235:18080', 'http://192.168.0.235:8443')
  assert.ok('blocked' in badValue)
})