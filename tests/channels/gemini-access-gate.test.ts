import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GEMINI_ACCESS_GATE_ERROR_CODE,
  classifyGeminiAccessGate,
  geminiAccessGateMessage,
} from '../../vendor/channel-pack/src/gemini-access-gate.ts'

/** 上游实测/官方文档里的错误体原文（措辞逐字取自有出处的报文，见判据函数注释）。 */
const LOCATION_BODY =
  '{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}'
/** 同一个地区闸门的**第二种**形态：403 + reason UNSUPPORTED_LOCATION（antigravity-cli #1268）。 */
const LOCATION_403_BODY =
  '{"error":{"code":403,"message":"Permission denied.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"UNSUPPORTED_LOCATION","domain":"cloudaicompanion.googleapis.com","metadata":{"error_number":"1008"}}]}}'
/** 个人版资格句（antigravity-cli #1016）：同时带「资格」与「地区」措辞，病因是地区。 */
const ELIGIBILITY_LOCATION_BODY =
  '{"error":{"code":400,"message":"Your current account is not eligible for Gemini Code Assist for individuals because it is not currently available in your location.","status":"FAILED_PRECONDITION"}}'
const RETIRED_BODY =
  '{"error":{"code":403,"message":"This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products.","status":"PERMISSION_DENIED"}}'
const ENTITLEMENT_BODY =
  '{"error":{"code":403,"message":"You do not have a valid license of this product. Please contact your administrator.","status":"PERMISSION_DENIED","details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"SUBSCRIPTION_REQUIRED","domain":"cloudaicompanion.googleapis.com","metadata":{"error_number":"1001"}}]}}'
/** 停服措辞 + 许可措辞同时出现时，停服必须赢（换许可救不回已停服的客户身份）。 */
const RETIRED_AND_LICENSE_BODY =
  '{"error":{"code":403,"message":"This client is no longer supported for Gemini Code Assist for individuals. You do not have a valid license of this product.","status":"PERMISSION_DENIED"}}'

test('命中三条闸门：地区（两种状态码）、停服、无许可，各自归到自己的那条', () => {
  // `classifyGeminiAccessGate` 只喂错误体，判据本身是字符串匹配（不是状态码）。
  assert.equal(classifyGeminiAccessGate(400, LOCATION_BODY), 'location_unsupported')
  assert.equal(classifyGeminiAccessGate(403, LOCATION_403_BODY), 'location_unsupported')
  assert.equal(classifyGeminiAccessGate(400, ELIGIBILITY_LOCATION_BODY), 'location_unsupported')
  assert.equal(classifyGeminiAccessGate(403, RETIRED_BODY), 'lane_retired')
  assert.equal(classifyGeminiAccessGate(403, ENTITLEMENT_BODY), 'entitlement')
})

test('停服措辞优先于许可措辞（两条同时命中时不能串台）', () => {
  assert.equal(classifyGeminiAccessGate(403, RETIRED_AND_LICENSE_BODY), 'lane_retired')
})

test('组织锁（named user + Standard 订阅）算许可闸门', () => {
  const namedUser =
    '{"error":{"code":403,"message":"You must be a named user on your organization\'s Gemini Code Assist Standard edition subscription.","status":"PERMISSION_DENIED"}}'
  assert.equal(classifyGeminiAccessGate(403, namedUser), 'entitlement')
})

test('闸门文案带出可行动信息，且上游原文始终附在后面', () => {
  const location = geminiAccessGateMessage('location_unsupported', LOCATION_BODY)
  assert.match(location, /受支持地区|代理出口/)
  assert.ok(location.includes(LOCATION_BODY), '上游原文必须原样附在文案里')

  const retired = geminiAccessGateMessage('lane_retired', RETIRED_BODY)
  assert.match(retired, /2026-06-18|停服/)
  assert.match(retired, /Antigravity/)

  const entitlement = geminiAccessGateMessage('entitlement', ENTITLEMENT_BODY)
  assert.match(entitlement, /Standard|Enterprise/)

  // 三条都归不可重试的 PERMISSION_DENIED（`SERVER` 会白重试）。
  assert.equal(GEMINI_ACCESS_GATE_ERROR_CODE, 'PERMISSION_DENIED')
})

test('地区判据赢在停服之前（两条措辞同时出现时不会串台）', () => {
  const both = LOCATION_BODY + ' This client is no longer supported'
  assert.equal(classifyGeminiAccessGate(400, both), 'location_unsupported')
})

/* ---------- 负控：每条都只应该**不**命中，保留原有的自愈路径 ---------- */

test('额度类 400/429 不算闸门（另有 QUOTA_EXCEEDED 通道，且会按自然日重置）', () => {
  assert.equal(
    classifyGeminiAccessGate(400, '{"error":{"message":"Quota exceeded for quota metric."}}'),
    undefined,
  )
  assert.equal(
    classifyGeminiAccessGate(429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Resource has been exhausted"}}'),
    undefined,
  )
})

test('裸 403（无许可措辞）不算闸门：令牌/scope 问题仍要走续期与换号自愈', () => {
  assert.equal(classifyGeminiAccessGate(403, '{"error":{"message":"insufficient OAuth2 scope"}}'), undefined)
  assert.equal(classifyGeminiAccessGate(403, ''), undefined)
})

test('裸 404「模型不在准入表」不算闸门：多账号池里换号可能真的能命中', () => {
  assert.equal(
    classifyGeminiAccessGate(404, '{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}'),
    undefined,
  )
  // 「not supported」的泛词**不得**被地区判据吃掉。
  assert.equal(classifyGeminiAccessGate(404, '{"error":{"message":"this model is not supported"}}'), undefined)
})

test('签名被拒的 400 不算闸门：那条要去签重试是自己就能愈合的', () => {
  assert.equal(
    classifyGeminiAccessGate(400, '{"error":{"message":"Invalid value at contents.parts.thought_signature"}}'),
    undefined,
  )
})

test('服务端会话累计超 1M 的 400 不算闸门：那条要升代换 sessionId', () => {
  assert.equal(
    classifyGeminiAccessGate(
      400,
      '{"error":{"message":"The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."}}',
    ),
    undefined,
  )
})
