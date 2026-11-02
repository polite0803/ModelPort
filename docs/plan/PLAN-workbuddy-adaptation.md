# WorkBuddy / CodeBuddy 适配清单

> 基线：`Ebony-Vinyl/dsh-our-free-model` **v2.5.1**（commit `3df868aaeaf26af5bf611fc61a909fcc0139d159`，MIT）
> 快照：`docs/upstream/workbuddy-v2.5.1/`（逐字落盘 + SHA256SUMS）
> 结论：可移植，**不需要新依赖**；缺口只有 1 个限流判定函数、1 个余额读取函数和 5 处接线。
> 本仓库的 `AccountPool` / 适配器契约 / `sse` 导出与这个版本几乎一一对应，这是选 v2.5.1 而不是 `master` 的原因。

---

## 1. 为什么锁定 v2.5.1

| | `master`（0.2.1-rc.2） | **v2.5.1** | 本仓库 vendor |
|---|---|---|---|
| `buddy-adapter.ts` | 291 KB | **131 KB** | — |
| 额外依赖 | `model-catalog.ts`(53KB)、`catalog-broadcast.ts`、`session-title.ts`、`native-search-contract.ts`、`openai-gateway/tencent-fingerprint.ts`(36KB) | **无**这些 | — |
| `sse.ts` | 86 KB，多出 DSML 一族导出 | 61 KB | **导出集 29/29 完全一致** |
| `index.ts` | 5 931 行（provider-registry 重构后） | **1 972 行** | 1 680 行 |
| `credits.ts` | 含全套签到 + 余额 | 含 `fetchCreditBalance` | 类型/格式化，无网络 |
| `buddy-growth` / `buddy-compensation` | 有（122 KB / 17 KB） | **无** | — |

`master` 已经把 buddy 迁到新的 provider-registry / model-catalog 架构，移植等于同时升级半个插件；
v2.5.1 是最后一个"依赖形态与本仓库同代"的快照。

---

## 2. 快照清单

| 文件 | 字节 | SHA-256（前 16） | 作用 |
|---|---:|---|---|
| `buddy.ts` | 42 615 | `025e3ef4e9f04acd` | 协议常量、凭据/模型解析、UA、头名（**零 import**） |
| `product.ts` | 22 642 | `6ec3e33d1b378111` | `CODEBUDDY` / `WORKBUDDY` 产品配置、UA 规则、兜底模型 |
| `buddy-oauth.ts` | 24 232 | `f8333adfb6890af0` | 两步登录（state → token → account）、续期、模型目录 |
| `buddy-auth.ts` | 21 198 | `fbbd0d2a3177fb6b` | `BuddyAuth` 服务：登录/续期/池接入/定时刷新 |
| `buddy-adapter.ts` | 131 109 | `81382d0d802d257a` | 推理适配器：流式、工具、图片、思考档、限流/额度错误 |
| `buddy-balance-rank.ts` | 11 986 | `9716220f5882b55b` | 资源包按到期分档（15 天窗口） |
| `buddy-balance-selector.ts` | 17 276 | `b8e76a816c247ff5` | 按余额/到期选号 |
| `openai-gateway/tencent-fingerprint.ts` | 7 590 | `d23dffcd2b2579fa` | 腾讯内容指纹重写（请求保真） |
| `credits.ts`（仅参考） | 34 207 | `3dac076bc8e35618` | 只取 `fetchCreditBalance` 一族 |

`llm-adapter.ts` **没有入快照**：只需要 4 个限流辅助中的 1 个；其余 3 个本地 `rate-limit.ts` 已有。

---

## 3. 依赖对账（v2.5.1 → 本地）

| 上游 import | 本地状态 | 说明 |
|---|---|---|
| `./account-pool.js` | ✅ | `addAccount` / `updateAccount` / `listAccounts` / `getAvailableAccount(provider, modelId, exclude)` / `updateModelRateLimit` / `permanentLocked` 签名全部吻合 |
| `./remote-catalog-gate.js` | ✅ | 同名导出 `RemoteCatalogGate`、`REMOTE_CATALOG_COOLDOWN_MS` |
| `./settings-compat.js` | ✅ | 同名 |
| `./llm-register-compat.js` | ✅ | `registerAdapterIdempotent` 同签名 |
| `./token-ledger.js` | ✅ | `reportLedgerAccount` |
| `./message-shape.js` | ✅ | `normalizeHarnessMessages` |
| `./image-budget.js` | ✅ | `projectRequestImage` |
| `./sse.js` | ✅ | **导出集 29/29 相同**，无需改 |
| `./refresh.js` / `./expiry-sync.js` | ✅ | `BuddyAuth` 只用到既有 `RefreshScheduler` / 对账助手 |
| `./buddy.js`、`./product.js` | ➕ | 本清单新增 |
| `./llm-adapter.js` | ⚠️ | 只缺 `isModelSaturationError`（其余 3 个在本地 `rate-limit.ts`） |
| `./credits.js` | ⚠️ | 只缺 `fetchCreditBalance` |
| `pool.pruneAccountsWithForeignDomain` | ⚠️ 可选 | 仅用于清理旧中国版 WorkBuddy 账号；v1 可跳过 |

**契约验证**：本地适配器方法集 `providerInfo / listAllModels / listModels / resolveModel / prepareCall` 与 `BuddyAdapter` 完全一致；`registerBuddyLlm` 只是 `registerAdapterIdempotent(ctx.llm, [product.id], adapter)`。

---

## 4. 适配工作项

### A1. 源码落盘（v1 只做 WorkBuddy 时）
把快照里的 9 个文件放进 `vendor/channel-pack/src/`（`openai-gateway/tencent-fingerprint.ts` 放对应子目录）。
`product.ts` 同时含 `CODEBUDDY` 与 `WORKBUDDY`：只做国际版时保留两个常量、只注册 `WORKBUDDY`；做 CodeBuddy 时同一份代码再注册一次即可。

### A2. `rate-limit.ts` 补 `isModelSaturationError`
从 v2.5.1 `llm-adapter.ts` 取三处：

- `MODEL_SATURATION_BUSINESS_CODE`（L2149）
- `MODEL_SATURATION_PATTERN`（L2162）
- `isModelSaturationError(status, body)`（L2187）

其余 `RATE_LIMIT_FALLBACK_MS` / `isRateLimited` / `parseRateLimitError` 本地已有，适配器 import 改指向 `./rate-limit.js`（或保留 `llm-adapter` 同名再导出，减少 diff）。

### A3. 新增 `buddy-credits.ts`（不要污染通用 `credits.ts`）
本地 `credits.ts` 刻意只放类型与格式化；余额网络调用单独成文件，从 v2.5.1 `credits.ts` 拷：

- `USER_RESOURCE_PATH`（L51）
- `postJson`（L340，私有）
- `parseCreditPackage`（L500，私有）
- `fetchCreditBalance`（L539，导出）

`buddy-balance-selector.ts` 的 `from './credits.js'` 改为 `from './buddy-credits.js'`（一行）。

### A4. `types.ts`
- 末尾按 v2.5.1 加 `export type { BuddyCredential } from './buddy.js'`。
- `RpcCreditsBalancesResponse.windowDays` 本地已存在（L465/518/1306），无需改。
- v1 不引入 `RpcBuddyGrowth*`（WorkBuddy 国际版没有成长中心）。

### A5. `channel-pack-store.ts` 前缀表
在 `REF_PREFIX_TO_PROVIDER` 追加（v2.5.1 store L349-350）：

```ts
['BUDDY', 'buddy'],
['WORKBUDDY', 'workbuddy'],
```

漏加 = 状态文档重建后账号静默消失（本仓库已复发过 3 次）。

### A6. `channel-pack-rpc.ts` 接线（6 处）
| 位置 | 改动 | v2.5.1 参考 |
|---|---|---|
| `registerChannelPackRpc(...)` 位置参数 | 追加 `buddy`、`workbuddy`（**只能加在末尾**） | L854 / L888 |
| `account.create` | `fetchAuthState` → `decorateLoginUrl` → `runBuddyLoginFlow`；`product` 按 `buddy`/`workbuddy` 选；后台 `scheduleRefresh()` 并写凭据 | L1394-1430 |
| `account.refresh` | `case 'buddy'` / `case 'workbuddy'` → `refreshAccountCredential(entry.credentialRef, pool, entry.id)` | L2028-2032 |
| `credits.balances` | 两个 buddy 回传 `windowDays: buddyExpiringWindowDays()` | L2361 |
| `credits.status` / `claimAll` | `buddy` 走签到；`workbuddy` 明确返回"国际版无签到接口"（不能落到 buddy 分支） | L2774-2790 |
| `provider.status` / `model.list` | 通用（`modelAdapters` 里有条目即可） | — |

### A7. `index.ts` 接线
按 v2.5.1 L551-700 的两段（buddy / workbuddy）移植，落到本仓库 1 680 行的同位置：

1. `const buddy = new BuddyAuth(ctx, { product: CODEBUDDY, fetcher: channelFetch })`
2. `const workbuddy = new BuddyAuth(ctx, { product: WORKBUDDY, fetcher: channelFetch })`
3. `resolveBuddyCredentialByRef`（JSON 解析 + `ctx.credentials.resolve`）
4. `BuddyBalanceSelector` ×2（各自一份余额缓存，绝不能串味）
5. `pickBuddyCredential(...)`（按 `enabled + 模型未受限` 筛 → 分档选号 → 取凭据）
6. `registerBuddyLlm(ctx, { credentialRef, resolveCredential, refresh: createPoolRefresh(pool, 'workbuddy', workbuddy), fetchRemoteModels: () => workbuddy.fetchModels(pool), product, isFreeModel })`
7. `refresh` 目标表追加两项；`modelAdapters` 追加 `buddy`/`workbuddy`
8. 关闭时 `buddy.stop()` / `workbuddy.stop()`
9. 可选：`pool.pruneAccountsWithForeignDomain(WORKBUDDY)`（没有该方法就先跳过）

### A8. `fetcher` 注入（代理支持）
`BuddyAuth` 与 `BuddyAdapter` 都接受 `fetcher` / `fetchImpl`，默认全局 `fetch`。
本仓库的渠道走 `channel-fetch.ts` 才能应用代理设置，因此两处都必须显式传 `channelFetch`；否则代理用户会在 WorkBuddy 上"直连"而不自知。

### A9. 宿主侧（数据驱动，改动小）
- `src/main/providers/accountChannels/catalogue.ts`：加 `workbuddy`（`loginKind: 'browser'`，vendor 写腾讯）；若同时做 CodeBuddy 再加 `buddy`。
- `tests/channels/catalogue.test.ts`：数量 10 → 11（或 12），并断言 id 出现在 pack `index.ts`。
- `AGENTS.md`：渠道数、`loginKind` 列表。
- 不需要改 `manager.ts` / `forwarder.ts` / `Channels.tsx`。

### A10. 文档
- `vendor/channel-pack/NOTICE.md`：新增来源（OFM v2.5.1 commit、MIT）与本地新增文件清单，声明"升级时需重放"。
- 可选：`scripts/check-channel-pack-additions.mjs` 在 vendor 升级时校验这 9 个文件仍在。

---

## 5. 行为差异与风险

| 项 | 事实 | 处理 |
|---|---|---|
| 登录 | 两步轮询：`POST /v2/plugin/auth/state` → 浏览器 → 轮询 token → 轮询 account；5 分钟超时 | 现有 `browser` 渠道 + `login.poll` 天然适配 |
| 国际版无签到 | WorkBuddy 后端没有签到接口，`credits.status` 必须返回"不支持" | A6 的 guard，**不能落 buddy 分支** |
| 额度耗尽的语义 | 402 / 401 / 429 与 `code 6004` 业务码并存 | 适配器已实现；`isModelSaturationError` 是缺口 |
| UA / 指纹 | 按产品/模型族分档的 UA + 内容指纹重写 | `product.ts` + `tencent-fingerprint.ts`，必须原样保留 |
| 余额分档 | 资源包按 `DeductionEndTime` 距今 <15 天分档；WorkBuddy 国际版与国内版字段形状不同 | `buddy-balance-rank.ts` 已按两家分别处理 |
| 账号串味 | 两个产品共用一个 `resolveBuddyCredentialByRef`，但池/选择器/锁各自独立 | A7 的注释已点名，照做 |
| vendor 分叉 | 9 个新文件不在上游 vendor 快照里 | NOTICE + 升级重放检查（A10） |

---

## 6. 里程碑与估算

| 里程碑 | 内容 | 验收 | 人日 |
|---|---|---|---|
| **M1 能登录** | A1–A5 + A6 的 `account.create` / `login.poll` + A7 的 auth 构造 | 构建通过；真实账号登录后 `account.list` 出现条目；重启后仍在 | 3–5 |
| **M2 能对话** | A6 的 `model.list` / `account.refresh`；A7 的适配器注册；A8 | `model.list` 返回目录；流式/非流式、工具调用、图片、思考档全部跑通 | 4–6 |
| **M3 打磨** | `credits.balances` / `claimAll`、余额分档、WorkBuddy 国际版的"无签到"文案 | 渠道页额度/选号/错误文案正确 | 2–3 |
| 测试与文档 | 移植上游单测子集（凭据解析/模型解析/限流判定/登录流程），更新 catalogue/NOTICE/AGENTS | `node --test` + 双 `tsc` + `npm run build` 全绿 | 2 |

**合计 11–16 人日**（不含 CodeBuddy 国内版；同族再加 0.5–1 天）。

---

## 7. 待你决定

1. **范围**：只做 WorkBuddy 国际版（`workbuddy`），还是同时注册 CodeBuddy 国内版（`buddy`）？后者同协议、只多一份 product 常量与一条 catalogue 条目。
2. **额度/选号**：M1/M2 是否先跳过 `BuddyBalanceSelector`（用 `getAvailableAccount` 的顺序即可），把选号放到 M3？
3. **签到**：`buddy`（国内版）有签到、`workbuddy` 没有。是否两个都做，还是只做国际版并明确"不支持签到"？
4. **vendor 维护**：接受这 9 个文件作为本地附加文件（NOTICE + 升级校验），还是借机整体升级 vendor 到 v2.5.1？我建议前者，升级面小。

---

## 8. 下一步（确认后执行）

1. 落 A1–A5（源码 + 两个小函数 + 前缀 + 类型），先让 `tsc` 通过。
2. 接 A6 的登录两分支，M1 验收。
3. 再接 A7/A8，M2 验收。
4. 最后 A9/A10 与测试。
