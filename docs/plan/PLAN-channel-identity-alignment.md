# 账号渠道客户端身份对齐计划（v2）

> 成文：2026-11-05 ｜ 状态：**B1–B4 完成；B5 部分（手动刷新就位，自动暂停待产品决策）**
> ｜ 2026-11-05 复核：主聊天路径已闭环，**发现 5 处残余缺口**（见 §2.1）｜ 目标版本：v1.6.2
>
> 目标只有一句话：**改实际发出的身份头，让它和官方现役客户端一致；并且这个一致
> 是随时间自动维持的，不是一次性写死的常量。**
>
> 非目标：不改 `upstreamIdentity.risk` 标签来"降低风险"（那只是 UI 文案），
> 不伪造登录态，不绕过付费墙。

---

## 1. 为什么必须是「时间特性」

上游判定「是不是官方客户端」看的不是"你有没有 UA"，而是：

- UA / `X-*-Version` 的**版本号是否落在官方现役区间**；
- 版本号与其它头（`X-Ide-Version-Code`、`X-OS-Version`、`X-Device-Type`）**是否自洽**；
- 同一账号的历史请求版本**是否突然倒退或长期停滞**。

官方客户端一升级，旧版本号就从"合法"变成"可疑"。所以对齐不是一个静态布尔值，
而是一个**带 TTL 的状态**：

```
identity = { value, source, checkedAt, expiresAt }
```

请求永远用「当前已知最新值」发包；值过期时**不阻塞请求**，用旧值先发，同时后台
刷新，刷新到新值后下一笔请求即生效。这就是"客户端升级后网关能及时更新 UA 版本标记"。

---

## 2. 现状审计（实际发出的头 vs 官方身份）

| # | 渠道 | 实际发包位置 | 当前实际值 | 问题 |
|---|------|--------------|------------|------|
| 1 | `lobsterai` | `lobsterai.ts` `lobsteraiChatHeaders` | UA `LobsterAI/0.1.0`；`X-LobsterAI-Client-Version` 动态取（fallback `2026.9.4`） | UA 版本与 clientVersion 不同源，UA 写死 `0.1.0` |
| 2 | `qoder` | `qoder.ts:314`、`qoder-auth.ts:371` | 硬编码 `qoder/1.0.0` | 两处硬编码，无来源、无 TTL |
| 3 | `qodercn` | 同 qoder | 同上 | 同上 |
| 4 | `trae` | `trae-product.ts:311-323`、`trae.ts:203-219` | UA `Trae/0.1.52`、`X-Ide-Version 0.1.52`、`X-Ide-Version-Code 20260811`、`X-Device-Type macos`、`X-OS-Version macOS 15.7.4`、`X-Device-Brand Apple` | **Windows 也发 macOS/Apple 身份**；版本停在 2026-08-11 |
| 5 | `cline` | `cline-product.ts:251` | `X-CLIENT-TYPE: cline-sdk` | 对齐；无版本可漂移 |
| 6 | `loomy` | `loomy.ts:221` `loomyChatHeaders` | 只发 `Accept`/`Content-Type`/`Authorization`/`token`，**无 UA** | 目录却声明有 UA；实际身份缺失 |
| 7 | `raccoon` | `raccoon.ts:257-274` | `X-Client-Platform`、`X-Org-Code`；无 UA | 基本对齐；`clientVersion v1.0.35` 无来源 |
| 8 | `minimax` | `minimax.ts:133/150` | 仅 `Authorization` + `Content-Type`/`Accept` | 对齐；上游不校验身份 |
| 9 | `zcode` | `zcode-upstream.ts:87-91`、`zcode-transport.ts:214` | `credential.app_version ?? fallback`；fallback **3.14.3 / 3.14.4 两个值** | 双 fallback 漂移 |
| 10 | `gemini` | `gemini-identity.ts:133/152` | 默认走 hub UA（更新站 manifest → fallback `2.24.0`）；`4.3.0` 只在 `DSH_GEMINI_LEGACY_IDENTITY_HEADERS=1` 的旧头回退态使用 | 同 | **无矛盾**：两套身份互斥，默认路径自洽；legacy 4.3.0 是显式开关 |
| 11 | `buddy` | `buddy.ts:89`、`product.ts:275-280` | `CodeBuddyIDE/1.106.1`、CLI `2.137.1` | **改名未跟**：CodeBuddy（腾讯）已更名 WorkBuddy（国内版），客户端 UA 应为国内客户端形态，版本与国际版同源 |
| 12 | `workbuddy` | `product.ts:70-71,389-406` | `WorkBuddy/5.5.2 WorkBuddy AI/5.5.2 CLI/5.5.2` | 实际值与目录声明（CodeBuddyIDE）不符；版本写死 |
| 13 | `opencode` | `opencode.ts:127-170` | 本机 `opencode --version` → v2 形状 UA | **已具备时间特性，作为模板** |

### 修复记录（2026-11-05）

> **更名事实（用户裁定，2026-11-05）**：CodeBuddy（腾讯）已更名为 **WorkBuddy（国内版）**，
> WorkBuddy（腾讯）即 **WorkBuddy（国际版）**。两条渠道是同一产品的两个区域发行，
> 客户端、更新源、版本体系完全同源；目录显示名迁移（含历史模型名迁移）已由
> `tests/shared/channel-rename.test.ts` 钉住，本表只覆盖**线上身份头**。

| 渠道 | 修复前 | 修复后 |
|------|--------|--------|
| `buddy`（WorkBuddy 国内版） | `CodeBuddyIDE/1.106.1`（改名前抓的 VS Code 基线）→ 中途误改 `4.12.3`（另一条 IDE 产品线） | **国内客户端形态** `WorkBuddy/<v> WorkBuddy/<v> CLI/<v>`，版本与国际版同源（官方 `/v2/update`，本机 5.9.3）；`attributionName` 同步 `WorkBuddy` |
| `workbuddy`（WorkBuddy 国际版） | 写死 `5.5.2` | 官方 `/v2/update` 接口（6h）→ 本机 `genieVersion` → fallback 5.9.3 |
| `qoder`/`qodercn` | 两处硬编码 `1.0.0` | 官方 `latest.yml`（6h）→ 本机 `.qoder-versions` 最大目录 → fallback 0.5.3 |
| `zcode` | 双 fallback 3.14.3/3.14.4；平台头写死 win32/windows | 统一 fallback；`X-Platform`/`X-Os-Category` 按 `process.platform` 实取 |
| `trae` | 写死 `0.1.52`/`20260811`/macOS/Apple | 读本机 `product.json` 的 `appVersion`（3.4.15）/`traeVersionCode`（20250325）/'version'（1.107.1）；设备头按宿主实取，Windows 不再发 macOS/Apple |
| `loomy` | 目录声明有 UA + 签名（实际没有） | 声明改为「仅 Authorization + token」，与实际一致 |
| `gemini` | 复核后无矛盾 | 不改 |

### 结论

- 需要改**实际头**的：`workbuddy`、`loomy`、`trae`、`qoder`/`qodercn`、`lobsterai`、
  `zcode`、`raccoon`、`buddy`；`gemini` 复核后默认路径自洽，不动。
- 已经正确的：`opencode`（动态版本）、`cline`/`minimax`（无版本身份）。
- `catalogue.declared` 必须从「手写说明」变成「从实际值派生」，否则下一次还会漂。

---

## 2.1 复核发现的残余缺口（2026-11-05 逐发包点核查）

> 核查方法：grep 每个渠道**所有**发包点（不只主聊天路径），比对它们是否走
> `client-identity.ts` 的动态取值链。结论：**主聊天路径 6 条渠道已闭环**，
> 但下列 5 处仍写死或半接入。

| # | 缺口 | 位置 | 现象 | 影响面 |
|---|------|------|------|--------|
| G1 | **buddy / workbuddy 登录与积分路径未走动态链** | `buddy-oauth.ts:151/196/266/319/374`、`buddy-credits.ts:290`、`buddy.ts:237` | 这些点发 `'User-Agent': product.userAgent` —— 静态字面量（国内版 `WorkBuddy/5.9.3 ...`、国际版 `WorkBuddy/5.5.2 ...`）。只有 `buddy-adapter.ts:1842` 的聊天路径经 `resolveUserAgent()` 替换了版本号 | 官方客户端升级后，**登录（auth/state、token 轮询）与每日签到仍发旧版本号**；上游若按 UA 版本判活，这两条路径会先失效，而聊天路径正常 —— 表现为「能聊天但签到失败」，排查成本高 |
| G2 | **zcode 登录路径写死 3.14.3** | `zcode-login.ts:166`（`options.appVersion ?? '3.14.3'`）、`zcode-login.ts:253`（默认参数 `'3.14.3'`） | 未引用 `ZCODE_APP_VERSION_FALLBACK` 常量，与 `zcode.ts:148` 的统一定义脱节 | 改 fallback 时登录路径不跟着改，两处漂移复发（B1 修过一次同型问题） |
| G3 | **trae 无官方版本源** | `client-identity.ts:228` `traeClientIdentity()` | 只读本机 `product.json`（`appVersion`/`traeVersionCode`/`version`），**无 `official` 分支**。官方更新站接口未确认 | 未装 Trae 的机器恒定发 fallback `3.4.15 / 20250325 / 1.107.1`；官方发新版后不会跟随 |
| G3b | **trae `plugin_version` 未动态化** | `trae-oauth.ts:111`（`plugin_version: product.pluginVersion`）、`trae-product.ts:321`（`'2.3.62834'`） | 登录 URL 的 `plugin_version` 写死。同文件 `x_app_version` 已走 `traeClientIdentity().appVersion`，两者不同源 | 官方改 plugin 版本号后，登录 URL 带旧号。注意 `plugin_version` 按注释是「插件版本号，非 IDE 版本号」，**不能**直接用 appVersion 顶替 —— 需单独确认官方插件版本源 |
| G4 | **workbuddy 三个静态版本字段未被动态值替换** | `product.ts:412/413/416`（`clientVersion: '5.5.2'`、`cliVersion: '5.5.2'`、`pluginVersion: '5.5.2'`） | `resolveUserAgent()` 用 `base.split(product.clientVersion).join(version)` 做版本替换 —— 它依赖常量 `clientVersion` 作为**被替换的旧值**。若官方版本变化（如 5.5.2 → 5.9.3），`split('5.5.2')` 命中不到 UA 里的旧值（UA 串是 `WorkBuddy/5.5.2 ...`，能命中；但国内版常量已是 5.9.3 而 UA 也是 5.9.3，替换成同值，等于**替换失效即恒等**） | 逻辑脆弱：替换靠字符串匹配旧常量，不是结构化字段。国际版 UA 字面量 `5.5.2` 与 `WORKBUDDY_UA_CN`/`INTL` 硬耦合，官方升到 6.x 时会露出旧号 |
| G5 | **目录声明与实际值脱节** | `src/main/providers/accountChannels/catalogue.ts:23/32`（`User-Agent: qoder/1.0.0`）、`:91`（`User-Agent: ZCode/3.14.3`） | qoder 实际发 `qoder/<动态版本>`（0.5.3），声明仍写 `qoder/1.0.0`；zcode 声明写死 `3.14.3` | UI 上「声明的身份」与「实际发包的身份」不符。B4 的 UI tooltip 已显示实际生效值，但卡片主文案仍误导 |

### 修复优先级建议

1. **G1**（最高）：登录与积分是用户可见的功能，UA 版本号落后会直接导致签到失败。
2. **G5**：纯文案，但影响用户对「身份是否对齐」的判断，且改动零风险。
3. **G2**：消除已修过一次的同型漂移。
4. **G4**：把版本替换从「字符串匹配旧常量」改成「结构化模板」。
5. **G3 / G3b**：依赖官方接口探测结论，可最后做。

### 修复记录（2026-11-05 收口）

> G1/G2/G4/G5 已全部落地并通过门禁；G3/G3b 维持「待确认」（官方源探测无果，见 §8）。

| # | 状态 | 修复方式 |
|---|------|----------|
| G1 | ✅ **已完成** | ① `product.ts`：`CODEBUDDY.userAgent` / `WORKBUDDY.userAgent` 改为 **getter**，每次访问按 `client-identity` 取值链渲染当前版本（`buddyUserAgent(form, version)`）；② `buddy.ts`：**删除模块级常量 `BUDDY_USER_AGENT`**（IIFE 只在加载时求值一次，长驻进程会僵化），`credentialRequestHeaders` 改发 `CODEBUDDY.userAgent`；③ 7 处调用点（buddy-oauth×5、buddy-credits×1、buddy.ts×1）零改动自动生效。测试：`client-identity.test.ts` 断言 getter 形态 + 两文件 UA 必须取自 `product.userAgent` |
| G2 | ✅ **已完成** | `zcode-login.ts:166/253` 两处 `'3.14.3'` 改引 `ZCODE_APP_VERSION_FALLBACK` |
| G3 | ⏸ **待确认** | trae 无公开版本接口（`api.trae.cn` / `api.trae.com.cn` / `www.trae.cn` 均未发现 update 端点），维持本机 product.json + fallback；接入点已留好（`traeClientIdentity()` 加 `official` 分支即可） |
| G3b | ⏸ **待确认** | `plugin_version` 是「插件版本号，非 IDE 版本号」，无官方来源可查；真机抓包确认前保持 `'2.3.62834'`（发错值比发旧值更危险） |
| G4 | ✅ **已完成** | `WORKBUDDY_UA_INTL/CN` 改为 `{v}` 占位模板；`resolveUserAgent()` 优先 `replaceAll('{v}', version)` 结构化渲染，`split(旧常量).join()` 降级为兼容回退。不再依赖旧版本号字符串命中 |
| G5 | ✅ **已完成** | `catalogue.ts` 的 qoder/qodercn/zcode 声明改为「动态版本」表述；`upstream-identity.test.ts` 断言同步（zcode 不再断言 3.14.3，改断言「动态版本」，保留 doesNotMatch 3.14.4） |

**修复过程中的两个教训**：

- **模块级 IIFE 常量 ≠ 动态**：第一版 G1 把 `BUDDY_USER_AGENT` 改成 `(() => ...)()`，
  只在模块加载时求值一次 —— 官方升级后长驻进程仍发旧值，等于没修。已改为 getter
  （每次属性访问都渲染）。教训：**「动态」的判据是「每次发包时求值」，不是「不是字面量」**。
- **sed 改代码必须补 import**：sed 替换字符串把 `codebuddyClientVersion()` 写进
  buddy.ts 却漏了 import，tsc 两套都绿（为何绿待查，疑似 vendor 路径未覆盖），
  被 esbuild bundle 测试（`workbuddy-port.test.ts`）在模块求值期抓出 ReferenceError。
  **绿构建不等于绿运行**，与记忆里「死组件坏 import 无引用文件不进 bundle」同族。

---

## 3. 架构：一个带 TTL 的身份存储，所有头从它取值

### 3.1 数据模型

新增 `vendor/channel-pack/src/client-identity.ts`（worker 内运行，不能放宿主 `src/`，
因为渠道包是 `virtual:channel-pack` 独立 bundle）：

```ts
export type ClientVersionSource =
  | 'env'            // MODELPORT_<CHANNEL>_VERSION
  | 'official'       // 官方更新接口 / 清单（6h TTL）
  | 'local-install'  // 本机官方客户端安装目录（mtime 变化即重读）
  | 'fallback'       // 代码常量，最后兜底

export interface ClientVersionInfo {
  version: string
  source: ClientVersionSource
  checkedAt: number
}
```

### 3.2 取值链（每个渠道同一套优先级）

```
env 覆盖
  → 官方更新接口 / 官方清单（主来源，6h 刷新）
  → 本机安装的 product.json / .qoder-versions（官网不可达时兜底）
  → fallback 常量（标记 source=fallback）
```

**官方优先，本机兜底**：上游校验的是「官方现役客户端」，不是「用户装的那一版」。
用户本机装旧版时，仍应按官网最新版发 UA；只有官网取不到（断网/被墙）时才退回本机
版本。这样「客户端升级后网关及时更新版本标记」不依赖用户是否装了新版。

### 3.3 时间维度

| 机制 | 规则（已实现） |
|------|------|
| 官方 TTL | 6h；到期后仍先用旧值，后台刷新成功再替换 |
| 请求路径 | 只读内存值；**绝不 await 网络** |
| 启动刷新 | worker 加载 `client-identity.ts` 时立即刷新一次（`unref` 定时器，不拖住进程） |
| 定时刷新 | 每 6h 一次，全部走 `Promise.allSettled`，单家失败不影响其它家 |
| 本机兜底 | 官方不可达时读 `product.json` / `.qoder-versions`；60s stat 节流、mtime 变化即重读 |
| 落盘 | `~/.modelport/identity-cache.json`（或 `MODELPORT_HOME`），启动先加载，避免首请求用 fallback |
| 版本漂移 | 刷新到的新值与旧值不同 → 直接替换内存值，下一笔请求生效（日志事件仍待补） |
| 风控联动 | **未实现**：`channel_risk_control` → `markSuspect` 立即刷新（B5） |

### 3.4 头部改造方式（关键）

不要在每个适配器里继续写 `product.userAgent`。统一改成：

```ts
const identity = identityStore.current('trae')
const headers = {
  'User-Agent': identity.userAgent ?? product.userAgent,
  'X-Ide-Version': identity.version ?? product.ideVersion,
  'X-Ide-Version-Code': identity.headers['X-Ide-Version-Code'],
  'X-Device-Type': deviceType(),          // 按 process.platform 实取
  'X-OS-Version': osVersion(),            // 按 os.release() 实取
  'X-Device-Brand': deviceBrand(),        // 按平台实取
}
```

`identityStore.current()` 是同步的、O(1)、永不抛错；网络刷新只发生在后台。

---

## 4. 逐渠道实际头改造清单

| 渠道 | 要改的头 | 取值来源 | 具体落点 |
|------|----------|----------|----------|
| `buddy`（WorkBuddy 国内版） ✅ | `User-Agent`（国内客户端形态）、`X-IDE-Version` | 与国际版**同源**：官方 `/v2/update`（6h）→ 本机 `product.json` → fallback | `buddy.ts` 的 `BUDDY_USER_AGENT`；`buddy-adapter.ts` 的 `X-IDE-Version`；`product.ts` 的 `CODEBUDDY` |
| `workbuddy` ✅ | `User-Agent`（国际线/国内线两档）、`X-IDE-Version`、`pluginVersion` | 官方 `/v2/update`（6h）→ 本机 `product.json` → fallback | `product.ts` 的 `WORKBUDDY`；`resolveUserAgent()` 按模型族返回 |
| `trae` ✅ | UA、`X-Ide-Version`、`X-Ide-Version-Code`、`X-Device-Type`、`X-OS-Version`、`X-Device-Brand` | 本机 `product.json`（`appVersion`/`traeVersionCode`/`version`）；设备三项按宿主实取 | `trae.ts` 的 SOLO/签到/OAuth 头、`trae-auth.ts`、`trae-oauth.ts` |
| `qoder` / `qodercn` ✅ | `User-Agent: qoder/<version>` | 官方 `latest.yml`（6h）→ 本机 `.qoder-versions` → fallback | `qoder.ts`、`qoder-auth.ts` 收敛到 `qoderClientVersion()` |
| `lobsterai` | `User-Agent: LobsterAI/<version>` | 已有 `resolveClientVersion()`（官方接口）→ fallback | `lobsterai.ts` 的 `lobsteraiChatHeaders` / `lobsteraiModelsHeaders` |
| `zcode` ✅ | `User-Agent: ZCode/<ver>`、`X-ZCode-App-Version` | 凭据 `app_version` → 统一 fallback | `zcode-upstream.ts`、`zcode-transport.ts`、`zcode.ts` |
| `gemini` | 不改：更新站 manifest 已是动态来源，fallback `2.24.0` 自洽；legacy 4.3.0 仅显式开关 | — | `gemini-identity.ts` 保持 |
| `raccoon` | `X-Client-Platform`、`X-Client-Version`（若有） | 本机安装 → 官方清单 → fallback | `raccoon.ts:257-274`、`raccoon-product.ts:340-342` |
| `loomy` | 先确认官方客户端是否发 UA；若发则补，若不发则保持无 UA | 抓包/本机客户端 | `loomy.ts:221` `loomyChatHeaders` |
| `opencode` | 保持现状 | 本机 `opencode --version` | `opencode.ts:148`（作为模板，不重写） |
| `cline` / `minimax` | 不改 | — | — |

---

## 5. 实施批次

### B1（已完成，2026-11-05）
- `zcode`：双 fallback 统一为 `ZCODE_APP_VERSION_FALLBACK`；`X-Platform` /
  `X-Os-Category` 按 `process.platform` 实取（不再写死 win32/windows）。
- `workbuddy`：目录声明改为 `WorkBuddy/<version>`，不再写成 CodeBuddyIDE。
- `loomy`：目录声明改为「仅 Authorization + token，不发 UA」，与实际头一致。
- `gemini`：复核后默认路径自洽（legacy 4.3.0 是显式开关），**不改**。
- 测试：`tests/channels/zcode-identity-headers.test.ts`、
  `tests/channels/upstream-identity.test.ts` 新增声明断言。

### B2（已完成：官方抓取 + 定时刷新，2026-11-05）
- 新增 `vendor/channel-pack/src/client-identity.ts`，取值链
  **env → 官方接口（6h）→ 本机安装（mtime 兜底）→ fallback**。
- 官方来源（2026-11-05 实测可用）：
  - WorkBuddy（国内版 buddy / 国际版 workbuddy 同一产品族）：
    `https://copilot.tencent.com/v2/update?platform=workbuddy-win32-<arch>-user&version=<当前>`
    → `productVersion` 如 `5.9.3.42398134`，normalize 成 `5.9.3`；204 = 已最新。
    ~~CodeBuddy IDE release-notes 页（4.12.x）~~ 是另一条产品线，已停止使用。
  - Qoder CN：`https://static.qoder.com.cn/qoder-app/releases/latest.yml` → `version: 0.5.3`。
  - Qoder 国际：`https://static.qoder.com/qoder-app/releases/latest.yml`（不可达时退回本机/常量）。
- 定时：模块加载立即刷新一次，之后每 6h；`unref()` 不拖住 worker；失败保留旧值。
- 落盘：`~/.modelport/identity-cache.json`（`MODELPORT_HOME` 可覆盖），启动先加载。
- 本机兜底：WorkBuddy `product.json` 的 `genieVersion`、CodeBuddy `product.json` 的
  `version`、Qoder `.qoder-versions` 最大目录、Trae `product.json` 的
  `appVersion`/`traeVersionCode`/`version`；60s stat 节流 + mtime 变化即重读。
- 已接入：`product.ts` 的 WorkBuddy/CodeBuddy UA、`buddy-adapter.ts` 的
  `X-IDE-Version`、`buddy-oauth.ts` 的登录 `version` 参数、`qoder.ts` /
  `qoder-auth.ts` 的 `qoder/<version>` UA、`trae.ts` 的全套 SOLO/签到/OAuth 头。
- **尚未做**：`markSuspect()` 风控联动、管理 API / UI 展示来源与核对时间。

### B3（已完成：2 渠道核实为「无需修改」+ 6 渠道接入，2026-11-05）
- 已接动态身份：`workbuddy`、`buddy`（国内版）、`qoder`、`qodercn`、`zcode`、`trae`。
- 核实后**无需修改**（原待接项销案）：
  - `lobsterai`：UA `LobsterAI/0.1.0` 是官方客户端 Go 源码原文
    （`client.go:21 clientUA`，`lobsterai-product.ts:98` 注释明确「刻意不跟真版本」），
    官方自己就是「静态 UA + 动态版本头」——照抄即对齐，接动态版本反而会偏离官方形态。
  - `raccoon`：`v1.0.35` 是真实客户端抓包值；官网与 `xiaohuanxiong.com` desktop API
    均未发现公开版本接口（探测 8 个候选路径全 404），无官方源可接，保持抓包值。
- 每接一个渠道加一条头快照测试。

### B4（已完成，2026-11-05）
- worker：`client-identity.ts::clientIdentitySnapshot()` 汇总五条动态渠道
  （workbuddy/buddy/qoder/qodercn/trae）的「下一笔请求实际会发」的身份
  （version/source/checkedAt/detail）。
- RPC：`identity.snapshot`（只读）与 `identity.refresh`（强制重拉官方源，见 B5）。
- 宿主：`accountChannelManager.identitySnapshot()`（失败返回空表不抛错）。
- 管理 API：`GET /v1/management/channels/identity`、
  `POST /v1/management/channels/identity/refresh`（`routes/management/identity.ts`）。
- UI：渠道页身份徽标 tooltip 追加「当前生效 v<ver>（来源，核对于 MM-DD HH:mm）」，
  快照读不到时退回纯声明文案；i18n 两语言包同步（`channels.identityLive.*`）。
- **未做**：`identity.version_changed` 漂移日志事件（刷新到新值时打点）。

### B5（部分完成，2026-11-05）
- 已就位：`identity.refresh` RPC + 管理接口手动强制刷新（风控命中后可人工立刻
  验证「刷新后身份是否跟上」）。
- **未做（需要产品决策）**：`channel_risk_control` → 自动 `markSuspect` → 自动刷新
  → 连续 2 次自动暂停渠道。自动暂停是用户可见的激进行为（上游抖动也可能误触发），
  接线点在宿主 failover/errorMapping 层（`isChannelRiskControlFailure`），实现前
  先确认：自动暂停 vs 仅提示。

---

## 6. 验收判据

1. 每个渠道的请求头都有单一来源，`identity-cache.json` 能查到 `value/source/checkedAt`。
2. 官方客户端升级后，**不重启网关**，下一笔请求的 UA 版本标记在 TTL 内更新；
   日志出现 `identity.version_changed`。
3. `trae` 在 Windows 上发出的设备三项与宿主一致。
4. `workbuddy` 声明 = 实际；`loomy` 不再声明不存在的 UA；`zcode` 只有一个 fallback。
5. 上游返回新版本号导致 403 时，网关能通过 `markSuspect` 触发刷新，而不是一直撞旧值
   （B4/B5 待实现）。
6. `npm run gate` 全绿。

---

## 7. 风险与回滚

| 风险 | 处置 |
|------|------|
| 本机没装官方客户端，读不到 `product.json` | 走更新清单 → cache → fallback；UI 标 `source=fallback` |
| 猜错版本触发 403 | env 钉子即时回滚；新值先灰度 24h |
| 自动刷新拖慢启动 | 刷新全部 `void` 异步，`apply()` 不等待；缓存缺失也不阻塞 |
| vendor 升级覆盖补丁 | 改动集中在新文件 + 少量调用点，升级时按测试补齐 |
| 用户已被封号 | 身份对齐不会解封；UI 明确提示需重新登录/换号 |

---

## 8. 已确认 / 待确认

**已确认（2026-11-05 实测）**：

- `workbuddy`：官方接口 `https://copilot.tencent.com/v2/update?platform=workbuddy-win32-x64-user&version=5.5.2`
  → `productVersion: 5.9.3.42398134`；本机 `product.json` 的 `genieVersion` 同为 5.9.3。
- `qodercn`：官方 `latest.yml` → `version: 0.5.3`；本机 `.qoder-versions` 最高目录同为 0.5.3。
- `workbuddy` / `buddy`：**同一产品族**（2026-11-05 更名：CodeBuddy（腾讯）→
  WorkBuddy（国内版））。官方接口
  `https://copilot.tencent.com/v2/update?platform=workbuddy-win32-x64-user&version=5.5.2`
  → `productVersion: 5.9.3.42398134`；本机国内版 `product.json` 的 `genieVersion`
  同为 5.9.3。两条渠道的版本号都从这条链取。
  ~~CodeBuddy IDE release notes 的 4.12.x~~ 是**另一条产品线**，与国内版客户端
  不同体系，已停止作为版本来源（中途误接，已回退）。
- `trae`：本机 Trae CN `product.json` 三套版本各司其职：
  `appVersion 3.4.15`（→ `X-Ide-Version` / UA）、`traeVersionCode 20250325`
  （→ `X-Ide-Version-Code`）、`version 1.107.1`（VS Code 基线，→ market 头
  `VSCode <ver>`）；官方 `getCommonParams` 映射证实设备头来自运行时
  `os_name` / `os_version` / `device_model`。

**待确认**：

- `qoder` 国际版现役版本（`static.qoder.com` 当前网络 502）
- `zcode` 现役 `app_version` 与官方更新接口
- `raccoon` 现役 `clientVersion` 与官方更新接口
- `loomy` 官方客户端是否发 UA（抓包）
- `trae` 的 Windows 设备头精确取值（`device_model` 需真机抓包；当前 Windows 缺省**不发** `X-Device-Brand`，比发错值安全）
- **trae 无官方版本源**（仅读本机 product.json，无 `official` 分支；确认过后才可接入动态版本源）
- **trae `plugin_version` 版本源未确认**（`plugin_version` 按注释是「插件版本号，非 IDE 版本号」，不能用 `appVersion` 顶替，需单独确认官方插件版本源）
