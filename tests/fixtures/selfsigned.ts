import { X509Certificate, createPrivateKey } from 'node:crypto'
import { generate } from 'selfsigned'

/**
 * node-forge 偶发产出 ASN.1 padding 非法的密钥/证书（随机、跨平台；2026-11-13
 * CI 实测 error:068000DD illegal padding，同一提交一次红一次绿）。夹具不自检
 * 就会成为 flaky 源：生成后立即解析，坏样重生成。与生产 ensureManagedMaterial
 * 的「坏样即再生」自愈同构。
 */
export function generateParseablePair(
  attributes: Parameters<typeof generate>[0],
  options: Parameters<typeof generate>[1],
): ReturnType<typeof generate> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pair = generate(attributes, options)
    try {
      new X509Certificate(pair.cert)
      createPrivateKey(pair.private)
      return pair
    } catch {
      // 坏样丢弃，下一轮重新生成
    }
  }
  throw new Error('selfsigned failed to produce a parseable pair after 5 attempts')
}