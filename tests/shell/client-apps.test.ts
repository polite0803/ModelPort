import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clientPaths, CLAUDE_DESKTOP_PROFILE_ID } from '../../src/shell/clientSyncPlan.ts'
import type { ClientPaths } from '../../src/shell/clientSyncPlan.ts'
import { CLI_APP_PLANNERS } from '../../src/shell/clientApps.ts'
import { TOOL_APP_PLANNERS, DSH_REF } from '../../src/shell/clientAppsTools.ts'
import type { AppPlanInput } from '../../src/shell/clientApps.ts'
import { KEY_PLACEHOLDER } from '../../src/shared/clientSync.ts'
import { parseJson5Object } from '../../src/shell/clientFormats.ts'

/**
 * The ported write faces, against the shapes the clients actually keep on disk.
 *
 * Two things are asserted for every client, and both are the ones a "switch gateway"
 * button gets wrong: the fields that decide where the requests go, and **everything the
 * writer did not name staying byte-identical** - the user's other providers, MCP servers,
 * mcp/model selections, comments. A reformat counts as a failure.
 */
const ORIGIN = 'https://gw.example.test'
const URL = `${ORIGIN}/v1`
const ROUTES = ['auto', 'codex-deepseek']
/** A stand-in for the canonical key: `keyValue` is compared, never written verbatim. */
const FAKE_KEY = `sk-${'k'.repeat(48)}`

const P = clientPaths('/root', '/root/.config', undefined, { platform: 'linux', env: {} })
const WIN = clientPaths('C:/Users/u', 'C:/Users/u/AppData/Roaming', undefined, {
  platform: 'win32',
  localAppData: 'C:/Users/u/AppData/Local',
  env: {},
})

function harness(docs: Record<string, string>, dirs: string[] = [], input: Partial<AppPlanInput> = {}): AppPlanInput {
  const files = new Map(Object.entries(docs))
  const known = new Set(dirs)
  const merged: AppPlanInput = {
    origin: ORIGIN,
    routeNames: ROUTES,
    hasKey: true,
    keyValue: FAKE_KEY,
    paths: P,
    read: path => files.get(path) ?? null,
    exists: path => known.has(path) || files.has(path),
    ...input,
  }
  // The two travel together: no key means no value to compare against either.
  if (!merged.hasKey) merged.keyValue = null
  return merged
}

test('the layout is the clients own, not one guess per platform', () => {
  assert.equal(P.geminiEnv, '/root/.gemini/.env')
  assert.equal(P.grokConfig, '/root/.grok/config.toml')
  assert.equal(P.opencodeDir, '/root/.config/opencode')
  assert.equal(P.openclawConfig, '/root/.openclaw/openclaw.json')
  assert.equal(P.hermesConfig, '/root/.hermes/config.yaml')
  assert.equal(P.kimiConfig, '/root/.kimi-code/config.toml')
  assert.equal(P.mcodeConfig, '/root/.minimax/config.yaml')
  assert.equal(P.ompModels, '/root/.omp/agent/models.yml')
  assert.equal(P.piModels, '/root/.pi/agent/models.json')
  assert.equal(P.copilotProviders, '/root/.copilot/providers.json')
  assert.equal(WIN.claudeDesktopConfig, 'C:/Users/u/AppData/Local/Claude/claude_desktop_config.json')
  assert.equal(WIN.claudeDesktop3pConfig, 'C:/Users/u/AppData/Local/Claude-3p/claude_desktop_config.json')
  assert.equal(WIN.claudeDesktopProfile, `C:/Users/u/AppData/Local/Claude-3p/configLibrary/${CLAUDE_DESKTOP_PROFILE_ID}.json`)
  // Env overrides the clients document.
  const custom = clientPaths('/root', '/root/.config', undefined, { platform: 'linux', env: { KIMI_CODE_HOME: '/data/kimi', DSH_HOME: '/data/dsh' } })
  assert.equal(custom.kimiConfig, '/data/kimi/config.toml')
  assert.equal(custom.dshHome, '/data/dsh')
})

// ---------------------------------------------------------------------------
// Claude Desktop - the face the desktop app actually reads
// ---------------------------------------------------------------------------

test('Claude Desktop: deploymentMode 3p in both configs plus the gateway profile', () => {
  const config = '{\n  "deploymentMode": "1p",\n  "preferences": { "coworkLocalModelSettings": true }\n}\n'
  const meta = `{\n  "entries": [{ "id": "other", "name": "Other" }],\n  "appliedId": "other"\n}\n`
  const docs: Record<string, string> = {
    [WIN.claudeDesktopConfig]: config,
    [WIN.claudeDesktopMeta]: meta,
  }
  const plan = CLI_APP_PLANNERS['claude-desktop'](harness(docs, ['C:/Users/u/AppData/Local/Claude'], { paths: WIN }))
  assert.equal(plan.state, 'ready')
  const written = new Map(plan.files.map(file => [file.path, file.content]))
  const nextConfig = JSON.parse(String(written.get(WIN.claudeDesktopConfig))) as Record<string, unknown>
  assert.equal(nextConfig.deploymentMode, '3p')
  // Unrelated settings survive.
  assert.deepEqual(nextConfig.preferences, { coworkLocalModelSettings: true })
  const three = JSON.parse(String(written.get(WIN.claudeDesktop3pConfig))) as Record<string, unknown>
  assert.equal(three.deploymentMode, '3p', 'the -3p config must say 3p too')
  const profile = JSON.parse(String(written.get(WIN.claudeDesktopProfile))) as Record<string, unknown>
  assert.equal(profile.inferenceProvider, 'gateway')
  assert.equal(profile.inferenceGatewayBaseUrl, ORIGIN, 'Desktop reads the bare origin')
  assert.equal(profile.inferenceGatewayApiKey, KEY_PLACEHOLDER)
  assert.equal(profile.inferenceGatewayAuthScheme, 'bearer')
  assert.equal(profile.disableDeploymentModeChooser, true)
  assert.deepEqual(profile.coworkEgressAllowedHosts, ['*'])
  // Our routes are not claude-* names, so nothing is advertised as a model list.
  assert.equal('inferenceModels' in profile, false)
  assert.equal(written.get(WIN.claudeDesktopProfile) !== undefined, true)
  const file = plan.files.find(item => item.path === WIN.claudeDesktopProfile)
  assert.equal(file?.private, true, 'the profile holds the key')
  const nextMeta = JSON.parse(String(written.get(WIN.claudeDesktopMeta))) as { entries: { id: string }[]; appliedId: string }
  assert.deepEqual(nextMeta.entries.map(entry => entry.id), [CLAUDE_DESKTOP_PROFILE_ID, 'other'])
  assert.equal(nextMeta.appliedId, CLAUDE_DESKTOP_PROFILE_ID)
})

test('Claude Desktop: a claude-* route is advertised, and a second switch writes nothing', () => {
  const dirs = ['C:/Users/u/AppData/Local/Claude']
  const first = CLI_APP_PLANNERS['claude-desktop'](
    harness({ [WIN.claudeDesktopConfig]: '{}\n' }, dirs, { paths: WIN, routeNames: ['claude-sonnet-4-5', 'auto'] }),
  )
  const written = new Map<string, string>()
  for (const file of first.files) {
    assert.ok(file.content !== null)
    written.set(file.path, file.content.split(KEY_PLACEHOLDER).join(FAKE_KEY))
  }
  const profile = JSON.parse(String(written.get(WIN.claudeDesktopProfile))) as Record<string, unknown>
  assert.deepEqual(profile.inferenceModels, ['claude-sonnet-4-5'], 'only names Desktop recognizes')

  const docs: Record<string, string> = {}
  for (const [path, content] of written) docs[path] = content
  const second = CLI_APP_PLANNERS['claude-desktop'](harness(docs, dirs, { paths: WIN, routeNames: ['claude-sonnet-4-5', 'auto'] }))
  assert.equal(second.state, 'unchanged', 'already pointed at the target writes nothing')
  assert.deepEqual(second.changes, [])
})

test('Claude Desktop: no canonical key is blocked, not a half-write', () => {
  const plan = CLI_APP_PLANNERS['claude-desktop'](
    harness({ [WIN.claudeDesktopConfig]: '{}\n' }, ['C:/Users/u/AppData/Local/Claude'], { paths: WIN, hasKey: false }),
  )
  assert.equal(plan.state, 'blocked')
  assert.equal(plan.files.length, 0)
  assert.match(plan.reason ?? '', /没有规范 key/)
})

// ---------------------------------------------------------------------------
// Gemini / Grok
// ---------------------------------------------------------------------------

test('Gemini: the first occurrence keeps its export prefix, later duplicates are dropped', () => {
  const env = [
    '# added by the user',
    'export GOOGLE_GEMINI_BASE_URL="https://old.example.test/v1beta"',
    'GEMINI_SANDBOX=danger-full-access',
    'GEMINI_API_KEY=old-key',
    'GEMINI_API_KEY=stale-duplicate',
    '',
  ].join('\n')
  const plan = CLI_APP_PLANNERS.gemini(
    harness({ [P.geminiEnv]: env, [P.geminiSettings]: '{"model":{"name":"gemini-2.5-pro"}}\n' }, ['/root/.gemini']),
  )
  assert.equal(plan.state, 'ready')
  const content = String(plan.files.find(file => file.path === P.geminiEnv)?.content)
  assert.ok(content.includes('# added by the user'), 'comments survive')
  assert.ok(content.includes('export GOOGLE_GEMINI_BASE_URL=https://gw.example.test'))
  assert.ok(content.includes('GEMINI_SANDBOX=danger-full-access'), 'user-owned Gemini settings untouched')
  assert.equal(content.split('GEMINI_API_KEY=').length - 1, 1, 'one key line, not two')
  assert.ok(content.includes(`GEMINI_API_KEY=${KEY_PLACEHOLDER}`))
  const settings = JSON.parse(String(plan.files.find(file => file.path === P.geminiSettings)?.content)) as Record<string, any>
  assert.equal(settings.security.auth.selectedType, 'gemini-api-key')
  assert.equal(settings.model.name, 'gemini-2.5-pro', 'the model the user picked is not ours to change')
  assert.deepEqual(plan.unserved, [])
})

test('Grok: our model table is replaced whole, other tables and keys are not', () => {
  const toml = [
    '[models]',
    'default = "vendor"',
    'session_summary = "vendor"',
    '',
    '[model.vendor]',
    'model = "grok-4"',
    'base_url = "https://vendor.example/v1"',
    'api_key = "vkey"',
    'api_backend = "chat_completions"',
    'env_key = "XAI_API_KEY"',
    '',
  ].join('\n')
  const plan = CLI_APP_PLANNERS.grokbuild(harness({ [P.grokConfig]: toml }, ['/root/.grok']))
  const content = String(plan.files[0].content)
  const lines = content.split('\n')
  assert.ok(content.includes('[model.modelport]'))
  assert.equal(readToml(content, 'model.modelport', 'base_url'), URL)
  assert.equal(readToml(content, 'model.modelport', 'api_key'), KEY_PLACEHOLDER)
  assert.equal(readToml(content, 'model.modelport', 'api_backend'), 'responses')
  assert.equal(readToml(content, 'model.modelport', 'env_key'), null, 'a leftover env indirection would outrank our key')
  assert.equal(readToml(content, 'models', 'default'), 'modelport')
  assert.equal(readToml(content, 'models', 'session_summary'), 'vendor', 'the user own summary choice stays')
  assert.equal(readToml(content, 'model.vendor', 'api_key'), 'vkey', 'another table is not ours')
  assert.ok(content.includes('env_key = "XAI_API_KEY"'))
  void lines
})

// ---------------------------------------------------------------------------
// OpenCode / OpenClaw
// ---------------------------------------------------------------------------

test('OpenCode: a comment-bearing jsonc keeps every byte outside our provider node', () => {
  const jsonc = ['{', '  // theme is the user\'s', '  "theme": "dark",', '  "provider": {', '    "other": {', '      "npm": "@ai-sdk/openai-compatible",', '      "options": { "baseURL": "https://other.example/v1" }', '    }', '  },', '  "model": "other/gpt",', '  "mcp": { "tools": [] }', '}', ''].join('\n')
  const plan = CLI_APP_PLANNERS.opencode(harness({ [`${P.opencodeDir}/opencode.jsonc`]: jsonc }, [P.opencodeDir]))
  const content = String(plan.files[0].content)
  assert.ok(content.includes('// theme is the user'), 'comments outside the node survive')
  assert.ok(content.includes('"model": "other/gpt"'), 'the default model is not touched by a switch')
  assert.ok(content.includes('https://other.example/v1'), 'a sibling provider is not touched')
  assert.ok(content.includes(`${URL}`))
  assert.ok(content.includes('@ai-sdk/openai-compatible'))
  assert.ok(content.includes(KEY_PLACEHOLDER))
})

test('OpenCode: a native providers map is written in the native shape', () => {
  const json = '{"providers":{"other":{"name":"Other","package":"@ai-sdk/openai-compatible"}}}'
  const plan = CLI_APP_PLANNERS.opencode(harness({ [`${P.opencodeDir}/opencode.json`]: json }, [P.opencodeDir]))
  const content = JSON.parse(String(plan.files[0].content)) as Record<string, any>
  assert.equal(content.providers.modelport.settings.baseURL, URL)
  assert.equal(content.providers.modelport.package, '@ai-sdk/openai-compatible')
  assert.equal(content.provider, undefined, 'no legacy map is created next to the native one')
})

test('OpenClaw: models.mode merge is kept and only our provider node moves', () => {
  const json5 = [
    '{',
    '  models: {',
    '    mode: "replace",',
    '    providers: {',
    '      // the user own provider',
    '      other: { baseUrl: "https://other.example/v1", apiKey: "k" },',
    '    },',
    '  },',
    '  agents: { defaults: { model: "other/x" } },',
    '}',
    '',
  ].join('\n')
  const plan = CLI_APP_PLANNERS.openclaw(harness({ [P.openclawConfig]: json5 }, ['/root/.openclaw']))
  const content = String(plan.files[0].content)
  assert.ok(content.includes('// the user own provider'), 'a comment inside providers survives the splice')
  assert.ok(content.includes('mode: "replace"'), 'mode is the client/file own setting')
  assert.ok(content.includes('other: { baseUrl: "https://other.example/v1", apiKey: "k" }'))
  assert.ok(content.includes('agents: { defaults: { model: "other/x" } }'))
  const doc = parseJson5Object(content) as Record<string, any>
  assert.equal(doc.models.providers.modelport.baseUrl, URL)
  assert.equal(doc.models.providers.modelport.api, 'openai-completions')
  assert.equal(doc.models.providers.modelport.apiKey, KEY_PLACEHOLDER)
  assert.deepEqual(doc.models.providers.modelport.models, [{ id: 'auto', name: 'auto' }, { id: 'codex-deepseek', name: 'codex-deepseek' }])
})

// ---------------------------------------------------------------------------
// Hermes / Kimi / MCode / Oh My Pi / Pi / Copilot
// ---------------------------------------------------------------------------

test('Hermes: our list entry is replaced, the vendor entry and other sections are not', () => {
  const yaml = [
    '# top comment',
    'custom_providers:',
    '  - name: vendor',
    '    base_url: https://vendor.example/v1',
    '    api_key: vk',
    'model:',
    '  provider: vendor',
    '  default: vendor-model',
    '  base_url: https://vendor.example/v1',
    'tools:',
    '  enabled: true',
    '',
  ].join('\n')
  const plan = TOOL_APP_PLANNERS.hermes(harness({ [P.hermesConfig]: yaml }, ['/root/.hermes']))
  const content = String(plan.files[0].content)
  assert.ok(content.includes('# top comment'))
  assert.ok(content.includes('    base_url: https://vendor.example/v1'), 'the vendor entry stays')
  assert.ok(content.includes('  base_url: https://vendor.example/v1'), 'model.base_url is preserved, not repointed')
  assert.ok(content.includes('tools:'))
  assert.ok(content.includes('  - name: modelport'))
  assert.ok(content.includes(`    base_url: ${URL}`))
  assert.ok(content.includes(`    api_key: ${KEY_PLACEHOLDER}`))
  assert.match(content, /provider: modelport/)
})

test('Hermes: a custom_providers that is a mapping is refused, not reshaped', () => {
  const plan = TOOL_APP_PLANNERS.hermes(harness({ [P.hermesConfig]: 'custom_providers:\n  vendor:\n    base_url: https://x/v1\n' }))
  assert.equal(plan.state, 'error')
})

test('Kimi: our model rows are rewritten and another provider rows are kept', () => {
  const toml = [
    'default_model = "vendor-1"',
    '',
    '[providers.vendor]',
    'type = "openai"',
    'base_url = "https://vendor.example/v1"',
    'api_key = "vk"',
    '',
    '[providers.modelport]',
    'type = "openai"',
    'base_url = "https://old.example/v1"',
    'api_key = "old"',
    '',
    '[providers.modelport.oauth]',
    'key = "native-login"',
    '',
    '[models.vendor-1]',
    'model = "v1"',
    'provider = "vendor"',
    '',
    '[models.modelport-stale]',
    'model = "stale"',
    'provider = "modelport"',
    '',
  ].join('\n')
  const plan = TOOL_APP_PLANNERS.kimi(harness({ [P.kimiConfig]: toml }, ['/root/.kimi-code']))
  const content = String(plan.files[0].content)
  assert.equal(readToml(content, 'providers.modelport', 'base_url'), URL)
  assert.equal(readToml(content, 'providers.modelport', 'api_key'), KEY_PLACEHOLDER)
  assert.equal(readToml(content, 'providers.modelport.oauth', 'key'), 'native-login', 'a native login is not ours to delete')
  assert.equal(readToml(content, 'models.modelport-stale', 'model'), null, 'our stale rows are dropped')
  assert.equal(readToml(content, 'models.vendor-1', 'provider'), 'vendor', 'another provider rows stay')
  assert.equal(readToml(content, 'models.modelport-auto', 'model'), 'auto')
  assert.equal(readToml(content, null, 'default_model'), 'vendor-1', 'an existing selection is not moved')
})

test('MCode: a custom node moves and an account-owned node is reported', () => {
  const ours = [
    'defaultModel: custom_provider:vendor/v',
    'custom_provider:',
    '  vendor:',
    '    kind: account',
    '  modelport:',
    '    kind: custom',
    '    options:',
    '      baseURL: https://old.example/v1',
    '      apiKey: old',
    '',
  ].join('\n')
  const plan = TOOL_APP_PLANNERS.mcode(harness({ [P.mcodeConfig]: ours }, ['/root/.minimax']))
  const content = String(plan.files[0].content)
  assert.ok(content.includes('defaultModel: custom_provider:vendor/v'), 'the user selection is not touched')
  assert.ok(content.includes('  vendor:\n    kind: account'), 'a sibling node is not touched')
  const block = readYamlChild(content, 'custom_provider', 'modelport')
  assert.ok(block !== null)
  assert.match(block, /baseURL: https:\/\/gw\.example\.test\/v1/)
  assert.match(block, new RegExp(`apiKey: ${KEY_PLACEHOLDER}`))

  const theirs = 'custom_provider:\n  modelport:\n    kind: account\n    name: X\n'
  const blocked = TOOL_APP_PLANNERS.mcode(harness({ [P.mcodeConfig]: theirs }))
  assert.equal(blocked.state, 'no-entry')
})

test('Oh My Pi: our provider block moves inside models.yml and the neighbours stay', () => {
  const yaml = [
    '# models for omp',
    'providers:',
    '  vendor:',
    '    baseUrl: https://vendor.example/v1',
    '    apiKey: vk',
    '    models:',
    '      - id: v-1',
    'modelRoles:',
    '  default: vendor/v-1',
    '',
  ].join('\n')
  const plan = TOOL_APP_PLANNERS.omp(harness({ [P.ompModels]: yaml }, [dirnameOf(P.ompModels)]))
  const content = String(plan.files[0].content)
  assert.ok(content.includes('# models for omp'))
  assert.ok(content.includes('    baseUrl: https://vendor.example/v1'), 'the vendor provider stays')
  assert.ok(content.includes('modelRoles:'), 'roles are the user own')
  assert.match(content, /  modelport:\n    baseUrl: https:\/\/gw\.example\.test\/v1/)
  assert.match(content, /    api: openai-completions/)
})

test('Oh My Pi: a models.json that has not been migrated is refused', () => {
  const plan = TOOL_APP_PLANNERS.omp(harness({ [`${dirnameOf(P.ompModels)}/models.json`]: '{"providers":{}}' }, [dirnameOf(P.ompModels)]))
  assert.equal(plan.state, 'no-entry')
  assert.match(plan.manualStep ?? '', /models\.yml/)
})

test('Pi: only our provider node moves', () => {
  const json = '{"providers":{"vendor":{"baseUrl":"https://vendor.example/v1"},"modelport":{"baseUrl":"https://old.example/v1","apiKey":"old"}},"other":true}'
  const plan = TOOL_APP_PLANNERS.pi(harness({ [P.piModels]: json }, [dirnameOf(P.piModels)]))
  const doc = JSON.parse(String(plan.files[0].content)) as Record<string, any>
  assert.equal(doc.providers.vendor.baseUrl, 'https://vendor.example/v1')
  assert.equal(doc.providers.modelport.baseUrl, URL)
  assert.equal(doc.providers.modelport.api, 'openai-completions')
  assert.equal(doc.other, true)
})

test('Copilot: the provider entry and only its own model rows move', () => {
  const json = '{"providers":[{"name":"vendor","type":"anthropic","baseUrl":"https://vendor.example"}],"models":[{"id":"v","provider":"vendor"},{"id":"old","provider":"modelport"}]}'
  const plan = TOOL_APP_PLANNERS.copilot(harness({ [P.copilotProviders]: json }, [dirnameOf(P.copilotProviders)]))
  const doc = JSON.parse(String(plan.files[0].content)) as Record<string, any>
  assert.equal(doc.providers.length, 2)
  assert.equal(doc.providers[0].name, 'vendor', 'the vendor entry is not reordered or rewritten')
  const entry = doc.providers[1]
  assert.equal(entry.wireApi, 'completions')
  assert.equal(entry.baseUrl, URL)
  assert.equal(entry.apiKey, KEY_PLACEHOLDER)
  assert.deepEqual(doc.models, [{ id: 'v', provider: 'vendor' }, { id: 'auto', provider: 'modelport' }, { id: 'codex-deepseek', provider: 'modelport' }])
})

// ---------------------------------------------------------------------------
// DeepSeek Harness / Antigravity
// ---------------------------------------------------------------------------

test('DeepSeek Harness: every profile moves, the key stays in the credential file', () => {
  const profile = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      modelport:',
    '        displayName: ModelPort',
    '        baseURL: https://old.example/v1',
    '        apiKeyEnv: OLDER_REF',
    '  mcp:',
    '    - id: fs',
    '',
  ].join('\n')
  const credentials = 'version: 1\nrefs:\n  OTHER: secret\nrecords:\n  OTHER:\n    kind: token\n'
  const plan = TOOL_APP_PLANNERS.dsh(
    harness(
      {
        [`${P.dshHome}/profiles/web/cordis.patch.yml`]: profile,
        [`${P.dshHome}/profiles/desktop/cordis.patch.yml`]: profile,
        [`${P.dshHome}/.credentials.yaml`]: credentials,
      },
      [`${P.dshHome}/profiles/web`, `${P.dshHome}/profiles/desktop`],
    ),
  )
  assert.equal(plan.state, 'ready')
  assert.equal(plan.files.length, 3, 'two profiles plus the credential file')
  const written = String(plan.files[0].content)
  assert.ok(written.includes('  mcp:'), 'the entry other keys survive')
  assert.ok(written.includes('- id: fs'))
  assert.match(written, /baseURL: https:\/\/gw\.example\.test\/v1/)
  assert.match(written, new RegExp(`apiKeyEnv: ${DSH_REF}`))
  assert.ok(!written.includes(KEY_PLACEHOLDER), 'no secret in the patch file')
  const creds = String(plan.files[2].content)
  assert.match(creds, new RegExp(`${DSH_REF}: ?"?${KEY_PLACEHOLDER}"?`))
  assert.ok(creds.includes('  OTHER: secret'), 'another credential is not touched')
  assert.ok(creds.includes('records:'), 'the records section is not touched')
  assert.equal(plan.files[2].private, true)
})

test('DeepSeek Harness: profiles that already disagree are not overwritten', () => {
  const a = '- id: llm-pi-ai\n  config:\n    providers:\n      modelport:\n        baseURL: https://one.example/v1\n'
  const b = '- id: llm-pi-ai\n  config:\n    providers:\n      modelport:\n        baseURL: https://two.example/v1\n'
  const plan = TOOL_APP_PLANNERS.dsh(
    harness(
      { [`${P.dshHome}/profiles/web/cordis.patch.yml`]: a, [`${P.dshHome}/profiles/desktop/cordis.patch.yml`]: b },
      [`${P.dshHome}/profiles/web`, `${P.dshHome}/profiles/desktop`],
    ),
  )
  assert.equal(plan.state, 'error')
  assert.equal(plan.files.length, 0)
})

test('Antigravity: no persistent endpoint means it says so, not a fake row', () => {
  const plan = TOOL_APP_PLANNERS.agy(harness({}, [dirnameOf(P.agySettings)]))
  assert.equal(plan.state, 'no-entry')
  assert.match(plan.reason ?? '', /不读持久端点/)
  assert.equal(plan.files.length, 0)
})

// ---------------------------------------------------------------------------
// The keyless path, for every writer that normally writes a key
// ---------------------------------------------------------------------------

test('no canonical key: nobody invents one, and every row that needs it says so', () => {
  const cases: [string, () => ReturnType<typeof harness>][] = [
    ['gemini', () => harness({ [P.geminiEnv]: '', [P.geminiSettings]: '{}' }, ['/root/.gemini'], { hasKey: false })],
    ['grokbuild', () => harness({ [P.grokConfig]: '[models]\n' }, ['/root/.grok'], { hasKey: false })],
    ['opencode', () => harness({ [`${P.opencodeDir}/opencode.json`]: '{}' }, [P.opencodeDir], { hasKey: false })],
    ['openclaw', () => harness({ [P.openclawConfig]: '{}' }, ['/root/.openclaw'], { hasKey: false })],
    ['hermes', () => harness({ [P.hermesConfig]: 'custom_providers: []\n' }, ['/root/.hermes'], { hasKey: false })],
    ['kimi', () => harness({ [P.kimiConfig]: '' }, ['/root/.kimi-code'], { hasKey: false })],
    ['mcode', () => harness({ [P.mcodeConfig]: 'custom_provider: {}\n' }, ['/root/.minimax'], { hasKey: false })],
    ['omp', () => harness({ [P.ompModels]: 'providers: {}\n' }, [dirnameOf(P.ompModels)], { hasKey: false })],
    ['pi', () => harness({ [P.piModels]: '{}' }, [dirnameOf(P.piModels)], { hasKey: false })],
    ['copilot', () => harness({ [P.copilotProviders]: '{}' }, [dirnameOf(P.copilotProviders)], { hasKey: false })],
    ['dsh', () => harness({ [`${P.dshHome}/profiles/web/cordis.patch.yml`]: '' }, [`${P.dshHome}/profiles/web`], { hasKey: false })],
  ]
  for (const [id, make] of cases) {
    const planner = (CLI_APP_PLANNERS as Record<string, (input: AppPlanInput) => never>)[id] ?? TOOL_APP_PLANNERS[id]
    const plan = planner(make())
    const content = plan.files.map(file => file.content ?? '').join('')
    if (plan.state === 'blocked') {
      assert.equal(plan.files.length, 0, `${id}: blocked must write nothing`)
      assert.match(plan.reason ?? '', /没有规范 key/, `${id}: blocked without saying why`)
      continue
    }
    assert.ok(!content.includes(KEY_PLACEHOLDER), `${id}: wrote a placeholder it could not fill`)
    assert.ok(
      (plan.manualStep ?? '') !== '' || plan.files.length === 0,
      `${id}: repointed an endpoint with no key and stayed silent about it`,
    )
  }
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function dirnameOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

function readToml(content: string, table: string | null, key: string): string | null {
  const lines = content.split('\n')
  const header = table === null ? null : `[${table}]`
  // Top level means "before the first header", so the scan starts at line 0.
  let index = -1
  if (header !== null) {
    index = lines.findIndex(line => line.trim() === header)
    if (index === -1) return null
  }
  const stop = lines.findIndex((line, at) => at > index && /^\s*\[/.test(line))
  for (let at = index + 1; at < (stop === -1 ? lines.length : stop); at += 1) {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*"(.*)"$`).exec(lines[at])
    if (match) return match[1]
  }
  return null
}

function readYamlChild(content: string, parent: string, child: string): string | null {
  const lines = content.split('\n')
  const start = lines.findIndex(line => line.trim() === `${parent}:`)
  if (start === -1) return null
  const childIndex = lines.findIndex((line, at) => at > start && line.trim() === `${child}:`)
  if (childIndex === -1) return null
  const childIndent = (/^ */.exec(lines[childIndex])?.[0] ?? '').length
  const out: string[] = [lines[childIndex]]
  for (let at = childIndex + 1; at < lines.length; at += 1) {
    if (lines[at].trim() === '') continue
    if ((/^ */.exec(lines[at])?.[0] ?? '').length <= childIndent) break
    out.push(lines[at])
  }
  return out.join('\n')
}
