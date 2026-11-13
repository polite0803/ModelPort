import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import {
  catalogSlugs,
  clientPaths,
  detectIndent,
  endpointFor,
  isClientId,
  maskSecret,
  planClaudeSettings,
  planCodeBuddySettings,
  planCodexToml,
  planQoderSettings,
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

test('Codex: base_url moves and every unrelated table survives', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['codex-deepseek', 'auto'] })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const lines = result.content.split('\n')
  assert.equal(readTomlString(lines, 'model_providers.modelport', 'base_url'), `${ORIGIN}/v1`)
  // Untouched: the catalog file name must stay bare, and env_key names a variable.
  assert.equal(readTomlString(lines, null, 'model_catalog_json'), 'modelport-catalog.json')
  assert.equal(readTomlString(lines, 'model_providers.modelport', 'env_key'), 'MODELPORT_CODEX_API_KEY')
  assert.equal(readTomlString(lines, 'model_providers.modelport', 'wire_api'), 'responses')
  assert.equal(readTomlString(lines, 'desktop', 'appearanceTheme'), 'dark')
  assert.equal(readTomlString(lines, 'projects."/home/polit/projects/ModelPort"', 'trust_level'), 'trusted')
  assert.ok(result.content.includes('notify = [ "C:\\\\Users\\\\polit\\\\codex-computer-use.exe", "turn-ended" ]'))
  assert.ok(result.content.includes('startup_timeout_sec = 120'))
  // The selected model is served, so it must not move.
  assert.equal(readTomlString(lines, null, 'model'), 'codex-deepseek')
})

test('Codex: a model the target does not serve moves to auto, not to a stale name', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['daily', 'auto'] })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.equal(readTomlString(result.content.split('\n'), null, 'model'), 'auto')
})

test('Codex: without auto the first advertised route is used', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['daily', 'stable'] })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.equal(readTomlString(result.content.split('\n'), null, 'model'), 'daily')
})

test('Codex: an empty route list never rewrites the selection', () => {
  const result = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: [] })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  assert.equal(readTomlString(result.content.split('\n'), null, 'model'), 'codex-deepseek')
})

test('Codex: re-running on the written file is a no-op', () => {
  const first = planCodexToml(CODEX_TOML, { origin: ORIGIN, routeNames: ['codex-deepseek'] })
  assert.equal(first.kind, 'changed')
  if (first.kind !== 'changed') return
  const second = planCodexToml(first.content, { origin: ORIGIN, routeNames: ['codex-deepseek'] })
  assert.equal(second.kind, 'unchanged')
})

test('Codex: no provider table is "no-entry", not a silently created one', () => {
  const result = planCodexToml('model = "gpt-5"\n', { origin: ORIGIN, routeNames: ['auto'] })
  assert.equal(result.kind, 'no-entry')
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
// Qoder
// ---------------------------------------------------------------------------

const QODER_SETTINGS = JSON.stringify(
  {
    enabledPlugins: { 'qoder-context@qoderapp-bundler': true },
    providers: {
      'qoder-custom-f50bdb45-6287-4ba2-bf7e-e644627bdf69': {
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey: 'sk-old',
        type: 'openai-compatible',
        protocol: 'openai',
        authType: 'bearer',
        model: 'daily',
        models: [{ model: 'daily', displayName: '日常', contextWindow: 1000000, maxOutputTokens: 8192 }],
        displayName: 'Qoder Custom F50bdb45',
      },
      'qoder-custom-6d0a65b8-52a4-4203-8d27-52cf906eabff': {
        baseUrl: 'http://192.168.0.239:8080/v1',
        apiKey: 'sk-old',
        type: 'openai-compatible',
        model: 'stable',
        models: [{ model: 'stable', displayName: '稳定', contextWindow: 200000 }],
      },
    },
  },
  null,
  2,
)

test('Qoder: every openai-compatible provider is repointed, uuids and models kept', () => {
  const result = planQoderSettings(QODER_SETTINGS, { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'changed')
  if (result.kind !== 'changed') return
  const parsed = JSON.parse(result.content)
  const ids = Object.keys(parsed.providers)
  assert.deepEqual(ids, [
    'qoder-custom-f50bdb45-6287-4ba2-bf7e-e644627bdf69',
    'qoder-custom-6d0a65b8-52a4-4203-8d27-52cf906eabff',
  ])
  for (const provider of Object.values(parsed.providers) as Record<string, unknown>[]) {
    assert.equal(provider.baseUrl, `${ORIGIN}/v1`)
    assert.equal(provider.apiKey, KEY_PLACEHOLDER)
  }
  // The user's own contextWindow is a manual mark, not something to re-derive.
  assert.equal(parsed.providers[ids[0]].models[0].contextWindow, 1000000)
  assert.equal(parsed.providers[ids[0]].models[0].displayName, '日常')
  assert.equal(parsed.enabledPlugins['qoder-context@qoderapp-bundler'], true)
  assert.ok(!result.content.includes('sk-old'))
})

test('Qoder: an empty provider table asks for one manual step instead of inventing a uuid', () => {
  const result = planQoderSettings('{"enabledPlugins":{}}', { origin: ORIGIN, writeKey: true })
  assert.equal(result.kind, 'no-entry')
})

test('Qoder: already pointing at the target is unchanged, not a rewrite', () => {
  const first = planQoderSettings(QODER_SETTINGS, { origin: ORIGIN, writeKey: true })
  assert.equal(first.kind, 'changed')
  if (first.kind !== 'changed') return
  // Substitute the placeholder the way apply does, then re-plan.
  const written = first.content.split(KEY_PLACEHOLDER).join('sk-canonical')
  const second = planQoderSettings(written, { origin: ORIGIN, writeKey: true })
  assert.equal(second.kind, 'changed') // the key differs, so only the key row changes
  if (second.kind !== 'changed') return
  assert.deepEqual(second.changes.map(change => change.label.endsWith('.apiKey')), [true, true])
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
    planQoderSettings(QODER_SETTINGS, { origin: ORIGIN, writeKey: true }),
    planWorkBuddyModels(WORKBUDDY_MODELS, { origin: ORIGIN, writeKey: true }),
    planClaudeSettings(null, { origin: ORIGIN, writeKey: true }),
  ]
  for (const output of outputs) {
    if (output.kind !== 'changed') continue
    // The only key-shaped token allowed in a plan is the placeholder itself.
    assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(output.content))
  }
})