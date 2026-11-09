/**
 * TRAE 签到设备号（2026-11-09 用户报障「自动领取积分完全失效」的根因）。
 *
 * 实测结论：上游只认官方客户端 `storage.json` 里登记过的 16 位号
 * （键名 `iCubeAuthInfo://icube-dc:<16 位>`）；自己生成的 32-hex 一律回 9074
 * （文案却写「签到人数过多」）。本用例锁死发现侧的解析与校验，以及
 * `credits.traeDevices` / `credits.setTraeDevice` 两个 RPC 的存在形状。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  extractTraeDeviceIds,
  isTraeDeviceId,
  traeStorageCandidates,
} from '../../vendor/channel-pack/src/trae-device.ts'

const ROOT = process.cwd()

test('isTraeDeviceId 只认 16 位纯数字', () => {
  assert.equal(isTraeDeviceId('2235123456787879'), true)
  assert.equal(isTraeDeviceId('590812345678341'), false, '15 位是老账号 uid 的形态')
  assert.equal(isTraeDeviceId('0c32dbf8fd6c0f847526d94b58c2f6a2'), false, '32-hex 是占位值，上游回 9074')
  assert.equal(isTraeDeviceId('22351234567878a9'), false)
  assert.equal(isTraeDeviceId(' 2235123456787879'), false)
  assert.equal(isTraeDeviceId(''), false)
  assert.equal(isTraeDeviceId(2235123456787879 as unknown), false)
  assert.equal(isTraeDeviceId(undefined), false)
})

test('extractTraeDeviceIds 从 storage.json 的键名里取号', () => {
  const raw = JSON.stringify({
    'iCubeAuthInfo://icube-dc:2235123456787879': 'dGMFEAAA-encrypted',
    'iCubeAuthInfo://icube-dc:1835123456784697': 'dGMFEAAA-encrypted',
    // 非设备键、以及设备号的非 16 位变体都不能被收进来。
    'iCubeAuthInfo://icube-user': 'x',
    'iCubeAuthInfo://icube-dc:12345': 'x',
    'theme': 'dark',
  })
  const found = extractTraeDeviceIds(raw, '/fake/storage.json')
  assert.deepEqual(
    found.map((entry) => entry.deviceId),
    ['2235123456787879', '1835123456784697'],
  )
  assert.ok(found.every((entry) => entry.source === '/fake/storage.json'))
})

test('extractTraeDeviceIds 对坏输入返回空表，不抛异常', () => {
  assert.deepEqual(extractTraeDeviceIds('not json', 's'), [])
  assert.deepEqual(extractTraeDeviceIds('[]', 's'), [])
  assert.deepEqual(extractTraeDeviceIds('null', 's'), [])
  assert.deepEqual(extractTraeDeviceIds('{}', 's'), [])
})

test('traeStorageCandidates 按平台给出官方客户端 storage.json 路径', () => {
  const win = traeStorageCandidates('win32', { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' })
  assert.equal(win.length, 1)
  assert.match(win[0], /Trae CN/)
  assert.match(win[0], /storage\.json$/)

  const mac = traeStorageCandidates('darwin', {})
  assert.match(mac[0], /Trae CN/)
  assert.match(mac[0], /storage\.json$/)

  const linux = traeStorageCandidates('linux', {})
  assert.match(linux[0], /\.config/)
  assert.match(linux[0], /storage\.json$/)

  // 没有 APPDATA 的 Windows 环境不能造出一条 `undefined/Trae CN` 的假路径。
  assert.deepEqual(traeStorageCandidates('win32', {}), [])
})

test('RPC 层注册了设备号的读取与写入，且写入前按 16 位校验', () => {
  const rpc = readFileSync(join(ROOT, 'vendor', 'channel-pack', 'src', 'channel-pack-rpc.ts'), 'utf8')
  assert.match(rpc, /case 'credits\.traeDevices'/)
  assert.match(rpc, /case 'credits\.setTraeDevice'/)
  assert.match(rpc, /isTraeDeviceId\(/, '写入口必须复用同一个校验函数')
  assert.match(rpc, /device_id: req\.deviceId/, '写入落点必须是凭据的 device_id（签到头读的就是它）')
})