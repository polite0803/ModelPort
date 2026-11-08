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
    upstreamIdentity: { declared: 'User-Agent: LobsterAI/0.1.0 · X-LobsterAI-Client-Version: 官方最新版本', risk: 'high' },
    name: 'LobsterAI (有道)',
    vendor: '有道',
    loginKind: 'browser',
    dailyCheckin: true,
    growthTasks: false,
    description: '网页登录后领取每日积分，走有道龙虾的免费模型额度。',
  },
{
    id: 'qoder',
    upstreamIdentity: { declared: 'User-Agent: qoder（动态版本）· COSY 签名（WASM 1.1.49）· 领取时调用官方 runtime-info.exe', risk: 'high' },
    name: 'Qoder',
    vendor: 'Qoder',
    loginKind: 'device-code',
    dailyCheckin: true,
    growthTasks: false,
    description: '设备码登录，账号池按顺序分担请求并共享每日积分。',
},
{
    id: 'qodercn',
    upstreamIdentity: { declared: 'User-Agent: qoder（动态版本）· COSY 签名（WASM 1.1.49）· 领取时调用官方 runtime-info.exe', risk: 'high' },
    name: 'Qoder (中国版)',
    vendor: '阿里',
    loginKind: 'device-code',
    dailyCheckin: true,
    growthTasks: false,
    description: '中国版 Qoder，与海外版同协议、不同产品线。',
},
  {
    id: 'trae',
    upstreamIdentity: { declared: 'User-Agent: Trae/<appVersion> · X-Ide-Version: <appVersion> · X-Ide-Version-Code: <traeVersionCode> · 设备头按宿主实取', risk: 'high' },
    name: 'TRAE (字节)',
    vendor: '字节跳动',
    loginKind: 'browser',
    dailyCheckin: true,
    growthTasks: false,
    description: '浏览器登录 TRAE，用签到积分驱动其内置模型。',
  },
  {
    id: 'cline',
    upstreamIdentity: { declared: 'X-CLIENT-TYPE: cline-sdk（官方 SDK 头）· WorkOS 设备码 OAuth', risk: 'low' },
    name: 'Cline',
    vendor: 'Cline',
    loginKind: 'device-code',
    // 上游没有签到端点（整个 sidecar 扫不到 checkin/campaign），只有订阅额度窗口。
    dailyCheckin: false,
    growthTasks: false,
    description: '设备码授权 Cline，按订阅额度（不是余额）计费；后端没有签到接口。',
    // 上游 Vercel AI Gateway 硬限 tools ≤ 128，超限 400（以流内错误帧浮现，
    // 换家循环拦不到，用户报障 2026-10-30）——auto 选候选时前置跳过。
    maxTools: 128,
  },
  {
    id: 'loomy',
    upstreamIdentity: { declared: '仅 Authorization + token（不发 User-Agent，也没有官方签名）', risk: 'medium' },
    name: 'Loomy (讯飞)',
    vendor: '科大讯飞',
    loginKind: 'browser',
    dailyCheckin: true,
    growthTasks: false,
    description: '网页登录 Loomy，每日首次登录自动发放额度。',
  },
  {
    id: 'raccoon',
    upstreamIdentity: { declared: 'X-Client-Platform: desktop-windows · X-Org-Code（无 User-Agent）', risk: 'medium' },
    name: 'Raccoon (商汤)',
    vendor: '商汤',
    loginKind: 'browser',
    // 每日 300 积分由服务端按日自动发放，没有「领取」这个动作。
    dailyCheckin: false,
    growthTasks: false,
    description: '浏览器登录 Raccoon，多个模型共用一份免费额度；每日积分由服务端自动发放，没有签到接口。',
  },
  {
    id: 'minimax',
    upstreamIdentity: { declared: '仅 Authorization 头（不发客户端身份）· 官方设备码 OAuth', risk: 'low' },
    name: 'MiniMax Code',
    vendor: 'MiniMax',
    loginKind: 'device-code',
    dailyCheckin: true,
    growthTasks: false,
    description: 'OAuth 设备码授权，支持每日签到领取。',
  },
{
    id: 'zcode',
    upstreamIdentity: { declared: 'User-Agent: ZCode（动态版本）· X-ZCode-App-Version · 内置官方身份块', risk: 'high' },
    name: 'ZCode (智谱)',
    vendor: '智谱',
    loginKind: 'browser',
    dailyCheckin: true,
    growthTasks: false,
    description: '浏览器登录 ZCode，按免费套餐余额扣费。',
},
  {
    id: 'gemini',
    upstreamIdentity: { declared: 'antigravity/hub/<官方最新版本>（官方 update 站现取）', risk: 'high' },
    name: 'Gemini Code Assist',
    vendor: 'Google',
    loginKind: 'oauth',
    // 免费线是配额窗口（5 小时 / 周），既没有积分也没有签到。
    dailyCheckin: false,
    growthTasks: false,
    description: '本地回调 OAuth 授权 Google 账号，走 Cloud Code Assist 免费线；按配额窗口计量，后端没有签到接口。',
  },
  {
    id: 'buddy',
    upstreamIdentity: { declared: 'User-Agent: WorkBuddy/<version> WorkBuddy/<version> CLI/<version>（国内客户端形态）· X-IDE-Version: <version> · 版本与国际版同源', risk: 'high' },
    name: 'WorkBuddy (国内版)',
    vendor: '腾讯',
    loginKind: 'browser',
    dailyCheckin: true,
    growthTasks: true,
    description: 'WorkBuddy 国内版（原 CodeBuddy）：浏览器授权，支持每日签到领取免费积分（国际版没有签到接口）。',
  },
  {
    id: 'workbuddy',
    upstreamIdentity: { declared: 'User-Agent: WorkBuddy/<version> · X-IDE-Version: <version> · 按模型族分档（国际线 / 国内线）', risk: 'high' },
    name: 'WorkBuddy (国际版)',
    vendor: '腾讯',
    loginKind: 'browser',
    dailyCheckin: false,
    growthTasks: false,
    description: '浏览器授权 WorkBuddy 国际版账号，共享一份每日额度；后端没有签到接口。',
  },
  {
    id: 'opencode',
    upstreamIdentity: { declared: 'User-Agent: opencode/latest/<version>/cli · 仿官方 project id / session id 形状', risk: 'medium' },
    name: 'OpenCode',
    vendor: 'OpenCode',
    // 这一家不跳浏览器：要么加一条匿名槽（免费车道，无需凭据），要么粘贴 API key。
    loginKind: 'api-key',
    credentialAdd: { withKey: 'opencode.addAccount', anonymous: 'opencode.addAnonymous' },
    // Zen 后端既没有签到端点、也没有余额查询端点（实测 15 个候选路径全 404）：
    // 免费车道按出口 IP 限流，额度只能在官网控制台看。
    dailyCheckin: false,
    growthTasks: false,
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
