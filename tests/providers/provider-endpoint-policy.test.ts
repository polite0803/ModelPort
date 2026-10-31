import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validateApiEndpoint } from '../../src/main/providers/endpointPolicy.ts'
import { resolveModelListSource } from '../../src/main/providers/modelListSource.ts'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('endpoint 校验：所有供应商一律要求 http/https', () => {
  const http = validateApiEndpoint('https://api.example.com/v1')
  assert.equal(http.valid, true)
  assert.deepEqual(http.errors, [])

  const rejected = validateApiEndpoint('opencode://local')
  assert.equal(rejected.valid, false)
  assert.ok(rejected.errors.includes('API endpoint must start with http:// or https://'))

  const empty = validateApiEndpoint('   ')
  assert.equal(empty.valid, false)
  assert.ok(empty.errors.includes('API endpoint cannot be empty'))

  const malformed = validateApiEndpoint('not a url')
  assert.equal(malformed.valid, false)
  assert.ok(malformed.errors.includes('Invalid API endpoint format'))
})

test('模型清单来源只有两种：声明了 modelsFetch，或者没有', () => {
  assert.equal(
    resolveModelListSource({ modelsFetch: { url: 'https://x.test/models', reader: 'auto' } }),
    'http',
  )
  assert.equal(resolveModelListSource({}), 'unsupported')
  assert.equal(resolveModelListSource(undefined), 'unsupported')
  assert.equal(resolveModelListSource(null), 'unsupported')
})

test('本机运行时那一档已整体退役，三处接线都不许留下', () => {
  // 判据钉的是「runtimeModels 这个概念没有被偷偷加回来」：豁免、清单分支、
  // 状态检查三处各查一条，任何一处复活都会红。
  const customSource = readFileSync(join(root, 'src/main/providers/custom.ts'), 'utf8')
  const policySource = readFileSync(join(root, 'src/main/providers/endpointPolicy.ts'), 'utf8')
  const catalogSource = readFileSync(join(root, 'src/main/providers/modelCatalog.ts'), 'utf8')
  const checkerSource = readFileSync(join(root, 'src/main/providers/checker.ts'), 'utf8')

  assert.doesNotMatch(customSource, /usesLocalRuntime|isRuntimeBackedProvider/)
  assert.doesNotMatch(policySource, /allowNonHttp/)
  assert.doesNotMatch(catalogSource, /source === 'runtime'/)
  assert.doesNotMatch(checkerSource, /checkRuntimeProvider/)
  // 添加供应商仍然要过 endpoint 校验，这条不能被上面的「豁免已撤」顺手带没。
  assert.match(customSource, /validateApiEndpoint\(data\.apiEndpoint\)/)
})
