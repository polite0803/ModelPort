/**
 * The thirteen account channels shipped by the vendored pack.
 *
 * This is metadata only: login flows, account pools, credit claims and model
 * catalogues all come from `vendor/channel-pack` at runtime. The ids here must
 * match the pack's provider ids exactly, because they double as the provider
 * record id and the model namespace (`<id>/<model>`).
 */
import type { ChannelDefinition } from '../../../shared/channels'

export const ACCOUNT_CHANNELS: readonly ChannelDefinition[] = [
  {
    id: 'lobsterai',
    name: 'LobsterAI (有道)',
    vendor: '有道',
    loginKind: 'browser',
    description: '网页登录后领取每日积分，走有道龙虾的免费模型额度。',
  },
  {
    id: 'qoder',
    name: 'Qoder',
    vendor: 'Qoder',
    loginKind: 'device-code',
    description: '设备码登录，账号池按顺序分担请求并共享每日积分。',
  },
  {
    id: 'qodercn',
    name: 'Qoder (中国版)',
    vendor: '阿里',
    loginKind: 'device-code',
    description: '中国版 Qoder，与海外版同协议、不同产品线。',
  },
  {
    id: 'trae',
    name: 'TRAE (字节)',
    vendor: '字节跳动',
    loginKind: 'browser',
    description: '浏览器登录 TRAE，用签到积分驱动其内置模型。',
  },
  {
    id: 'cline',
    name: 'Cline',
    vendor: 'Cline',
    loginKind: 'device-code',
    description: '设备码授权 Cline，按订阅额度（不是余额）计费。',
    // 上游 Vercel AI Gateway 硬限 tools ≤ 128，超限 400（以流内错误帧浮现，
    // 换家循环拦不到，用户报障 2026-10-30）——auto 选候选时前置跳过。
    maxTools: 128,
  },
  {
    id: 'loomy',
    name: 'Loomy (讯飞)',
    vendor: '科大讯飞',
    loginKind: 'browser',
    description: '网页登录 Loomy，每日首次登录自动发放额度。',
  },
  {
    id: 'raccoon',
    name: 'Raccoon (商汤)',
    vendor: '商汤',
    loginKind: 'browser',
    description: '浏览器登录 Raccoon，多个模型共用一份免费额度。',
  },
  {
    id: 'minimax',
    name: 'MiniMax Code',
    vendor: 'MiniMax',
    loginKind: 'device-code',
    description: 'OAuth 设备码授权，支持每日签到领取。',
  },
  {
    id: 'zcode',
    name: 'ZCode (智谱)',
    vendor: '智谱',
    loginKind: 'browser',
    description: '浏览器登录 ZCode，按免费套餐余额扣费。',
  },
  {
    id: 'gemini',
    name: 'Gemini Code Assist',
    vendor: 'Google',
    loginKind: 'oauth',
    description: '本地回调 OAuth 授权 Google 账号，走 Cloud Code Assist 免费线。',
  },
  {
    id: 'buddy',
    name: 'CodeBuddy (腾讯)',
    vendor: '腾讯',
    loginKind: 'browser',
    description: '中国版 CodeBuddy：浏览器授权，支持每日签到领取免费积分（国际版 WorkBuddy 没有签到接口）。',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy (腾讯)',
    vendor: '腾讯',
    loginKind: 'browser',
    description: '浏览器授权 WorkBuddy 国际版账号，共享一份每日额度；后端没有签到接口。',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'OpenCode',
    // 这一家不跳浏览器：要么加一条匿名槽（免费车道，无需凭据），要么粘贴 API key。
    loginKind: 'api-key',
    credentialAdd: { withKey: 'opencode.addAccount', anonymous: 'opencode.addAnonymous' },
    description:
      'OpenCode 免费车道：匿名槽无需凭据即可用，按出口 IP 限流；粘贴 API key 可解锁收费模型。没有每日签到接口。',
  },
]

const CHANNEL_IDS = new Set(ACCOUNT_CHANNELS.map(channel => channel.id))

export function isAccountChannelId(id: string): boolean {
  return CHANNEL_IDS.has(id)
}

export function getChannelDefinition(id: string): ChannelDefinition | undefined {
  return ACCOUNT_CHANNELS.find(channel => channel.id === id)
}

/** Provider-record id for a channel. Same as the pack provider id on purpose. */
export function channelProviderId(id: string): string {
  return id
}

/** Display name for a model exposed by a channel (`<channel>/<model>`). */
export function channelModelName(channelId: string, modelId: string): string {
  return `${channelId}/${modelId}`
}
