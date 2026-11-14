# PLAN：客户端访问路径数据收归壳侧（地址簿条目承载，切换不再问网关）

> 成文：2026-11-14 ｜ 状态：**已批准（整批授权），执行中** ｜ 执行宿主：SSH → WSL（构建/测试/git）
>
> 拍板记录（2026-11-14，用户「整批授权」＋我按裁定合推）：**D6＝P1＋P2 一次做完，收尾只跑一次全量 gate**；
> **D2＝https 条目自动用其 url，http 条目表单手填＋「从网关探测」一次性建议（存条目；https 条目探测被守卫拒绝，避免拼错端口）**；
> **D4＝以客户端实际握手证书为准（net.fetch 走 Chromium 信任栈＝与 Claude Desktop 同判据），网关自身 CA 端点退出信任取证**。
>
> 上游：`PLAN-client-config-switch.md`（已落地）＋ 当日 Claude Desktop https 修复（门禁 2663/2663，**未提交**）。
> 本 PLAN 是对那次修复的**设计返工**：当时用 `readGatewayHttpsOrigin` 去问网关拿 httpsPort，正是本文要撤掉的路径盲推导。
>
> 设计裁定（用户 2026-11-14 原话）：**「采用两种方式访问这同一个网关时，要区分两个方式的不同就必须将这些数据写在 shell 侧而不是网关侧」**。
>
> 一句话：网关是**访问路径无关**的——它只知道自己监听 8443，不知道自己是"被 IP 直连"还是"被域名经 Cloudflare 代理"。
> 客户端真正要用的访问数据（https 端点、看到哪张证书、要不要装信任）是**地址簿条目**的属性，必须存在壳侧，不能在切换时去问网关。

---

## 0. 本轮实测事实（全部只读）

| 项 | 读数 |
|---|---|
| 235 两条入口 | IP `https://192.168.0.235:8443`（网关自签 `CN=ModelPort`）；域名 `https://modelport.bgnone.cn`（Cloudflare 边缘 **Let's Encrypt** `*.bgnone.cn`，公共可信） |
| 域名确通到网关 | `/v1/models` 回 401（fail-closed 鉴权），`server: cloudflare`；DNS 解析到 Cloudflare IPv6 |
| 235 网关配置 | `httpsEnabled=true / httpsPort=8443 / httpsSanHosts=["192.168.0.235"]`，`httpsCertPath/KeyPath=null`（自动自签，无自定义证书） |
| 本机已装 CA | `CurrentUser\Root` 一张 `CN=ModelPort`（SHA-1 `39C4D03A…`），与 235 现出示（`9897D48D…`）、WSL（`DEFF62C9…`）**都不符**＝旧证书 |
| 条目结构 | `GatewayEntry` 仅 `id/name/url/kind/manageWsl/wslDistro`（[addressBook.ts](../../src/shell/addressBook.ts)），**无任何客户端端点/证书字段** |
| readBook 白名单 | [addressBook.ts:81](../../src/shell/addressBook.ts) 重建条目只保留上述字段 ⇒ **新字段必须同批改 `readBook` 与 `upsertEntry`，否则读盘即丢** |

---

## 1. 普查：哪些参数有同样问题

**判据**：该数据是否"随访问路径变"，且当前"从网关侧取/推导"。两者都中＝同病。

| # | 参数 / 消费点 | 现状 | 判定 |
|---|---|---|---|
| **P1** | 客户端 https 端点 `readGatewayHttpsOrigin` [clientSyncRpc.ts:65](../../src/shell/clientSyncRpc.ts) | 问网关 `config:get` 拿 httpsPort，拼 `https://<条目hostname>:<httpsPort>` | **同病**。只对 IP 直连成立；域名会拼成 `:8443`（实际 443）。现在没炸仅因域名条目本就是 https、被 `claudeDesktopEndpoint` 原样保留 |
| **P2** | 证书信任 `resolveGatewayCertificate` [gatewayTrust.ts:160](../../src/shell/gatewayTrust.ts) | 一律取网关自身 CA（`/v1/management/tls/ca` [gatewayTrust.ts:126](../../src/shell/gatewayTrust.ts)），且 endpoint 优先于握手捕获件 | **同病**。客户端实际看到的证书随路径变：IP=网关自签（要装）、域名=边缘 Let's Encrypt（本就受信）。对域名条目，面板显示网关 CA＋"未受信"＋劝装＝**误导且无效** |
| P3 | 网关设置页 `httpsClientUrl` [ProxyConfigForm.tsx:613](../../src/renderer/src/components/proxy/ProxyConfigForm.tsx) | 网关自己的设置页显示自己的监听 URL | **网关自身视角**，非壳侧推导。网关本就无法知道访问路径；客户端端点权威来源应移到壳的客户端切换页。此页仅保留"网关自身监听"语义（去掉"填到 Claude Desktop"误导措辞） |
| P4 | 托盘"复制 URL" [TrayView.tsx:145/259](../../src/renderer/src/components/Tray/TrayView.tsx) | 本地网关托盘读自身 `proxyHost/proxyPort/httpsPort` | **本地网关自身视角**，非壳对远程网关的推导。不在本次范围 |
| — | 规范 key / 路由名 / 管理密钥 / 条目 url / 其它客户端 `endpointFor` | key、路由随网关不随路径；管理密钥已按 origin 存壳侧 `secrets.json`；url 本就是路径数据；其它客户端直接用条目 url | **无病**，不动 |

**结论：同病两处＝P1（https 端点）＋P2（证书信任）。P3/P4 是网关自身视角，另作措辞/范围处理。**

---

## 2. 决策表（D1–D5 我按裁定合推，D6 需你点头）

| # | 事项 | 建议裁定 | 依据与代价 |
|---|---|---|---|
| D1 | 条目承载什么 | `GatewayEntry` 增 `clientHttpsUrl?: string`——**这条访问路径**的客户端 https 端点 | P1 的壳侧落点。https 条目默认=其 url；http 条目由用户填/探测。字段可选，旧条目缺省不炸 |
| D2 | clientHttpsUrl 怎么来 | **https 条目自动=其 url；http 条目在网关表单填，配「从网关探测」一次性建议**（探测结果存条目，此后切换不再问网关） | 保留便利又符合"存壳侧"。`readGatewayHttpsOrigin` 降级为**仅表单用的一次性探测器**，切换路径不再调用。代价：http 条目首次要填一下/点一下探测 |
| D3 | 切换端点判定 | `claudeDesktopEndpoint` 入参由"网关推导的 httpsOrigin"改为"**条目的 clientHttpsUrl**"：https/回环原样；非回环 http 用条目值；无值→blocked 并提示"请在网关条目填客户端 HTTPS 地址" | 切换定端点不再依赖网关管理面在线。代价：http 条目未填时 blocked（诚实，不写坏 URL） |
| D4 | 信任路径感知（P2） | **以"客户端实际握手证书"为准**：条目的客户端 https 连接成功（无 certificate-error）＝公共/已受信证书，**无需安装**；握手被拒＝捕获该证书供安装。不再无条件取网关 CA | 域名自然"已受信"，IP 自然"装自签 CA"。保留 bootstrap（管理面因证书不可达时用捕获件）。代价：动 `gatewayTrust` 取证实序与缓存 |
| D5 | schema 迁移 | `readBook`/`upsertEntry` 同批携带 `clientHttpsUrl`；旧 `gateways.json` 无此字段＝缺省（https 条目回退 url，http 条目待填） | 白名单重建会丢新字段，必须同批改。无破坏性迁移、不改既有字段 |
| D6 | **范围** | 一次做完 P1（D1–D3/D5）＋P2（D4）；P3 仅措辞、P4 不动 | 同根因一次收口。**若想小步，可先 P1 后 P2——需你拍板** |

---

## 3. 阶段

### A. 客户端 https 端点收归条目（P1）
- **A1** [addressBook.ts](../../src/shell/addressBook.ts)：`GatewayEntry` 增 `clientHttpsUrl?`；`readBook`（:81 白名单）与 `upsertEntry`（:124）同批携带。
- **A2** 网关表单（listWindow 渲染层＋`shell:gateway-*` IPC，[main.ts:703/717/771](../../src/shell/main.ts)）：增"客户端 HTTPS 地址"字段＋「从网关探测」按钮（探测=一次性 `config:get` 建议，**存条目**）。
- **A3** [clientSyncPlan.ts:231](../../src/shell/clientSyncPlan.ts) `claudeDesktopEndpoint`：入参改条目 `clientHttpsUrl`；https/回环原样、非回环 http 用条目值、无值 blocked。
- **A4** [clientSyncRpc.ts:65](../../src/shell/clientSyncRpc.ts) `readGatewayHttpsOrigin` 降级为表单探测器；[clientSync.ts:238](../../src/shell/clientSync.ts) gather 不再调它、改传条目字段；[clientApps.ts:65](../../src/shell/clientApps.ts) `AppPlanInput.httpsOrigin` 语义改为"条目客户端 https 端点"。
- **A5** 测试：client-sync-plan / client-apps 增"条目值优先 / 无值 blocked / 域名 https 原样"；撤依赖网关推导的旧断言。

### B. 证书信任路径感知（P2）
- **B1** [gatewayTrust.ts](../../src/shell/gatewayTrust.ts)：取证改"客户端实际握手证书优先"；连接成功（公共/已受信）→"已受信，无需安装"；握手被拒→捕获证书供安装；保留 bootstrap 与缓存键。
- **B2** [main.ts:1617](../../src/shell/main.ts) `trustTargetFor`/面板：按条目客户端端点判定，域名条目不再显示网关 CA"未受信"。
- **B3** 测试：域名（公共证书）→无需安装；IP（自签）→供安装；已装指纹与现出示不符→提示重装。

### C. 收口
- **C1** P3 措辞：[ProxyConfigForm.tsx:611](../../src/renderer/src/components/proxy/ProxyConfigForm.tsx) `httpsClientUrl` 去"填到 Claude Desktop"误导，改"网关自身 https 监听"（locale 同步）。
- **C2** 全量 `npm run gate`（**独跑**，SSH→WSL），两套 tsc＋全测试绿。
- **C3** 本机验收：235 两条入口各切换一次 Claude Desktop——IP 走装信任、域名免装。

---

## 4. 验收（产出层＋呈现层）
- **产出层**：切换写出的 `inferenceGatewayBaseUrl` 对 IP=条目 `clientHttpsUrl`、对域名=其 https url；**不再问网关 httpsPort**。
- **呈现层**：信任面板对域名条目显示"公共证书已受信"，对 IP 条目显示自签 CA＋安装按钮；网关设置页不再误导"填到 Claude Desktop"。
- **门禁**：gate 全绿；新用例覆盖"条目值优先 / 无值 blocked / 域名免装"。

---

## 5. 待你拍板（已决）
1. **D6 范围**：✅ P1＋P2 一次做完（整批授权）。
2. **D2 填充**：✅ 表单手填＋探测建议；https 条目留空即用其 url，探测对 https 条目直接拒绝（守卫）。
3. **D4 信任方向**：✅ 以客户端实际握手证书为准；探针可注入（`HandshakeProbe`），测试不触真实握手/证书库。

## 6. 执行记录（2026-11-14）
- **A1–A2**：`GatewayEntry.clientHttpsUrl`＋readBook/upsertEntry 白名单同批；网关表单新字段＋「从网关探测」（`shell:prompt-probe-https`，settle 时 removeHandler）；对话框 410→490。
- **A3–A4**：`claudeDesktopEndpoint` 入参改条目值（无值 blocked 提示填条目）；gather 不再调 `readGatewayHttpsOrigin`（降级为仅表单探测器）；`AppPlanInput.httpsOrigin`→`clientHttpsUrl`。
- **B1–B2**：`gatewayTrust` 重写为握手优先（`pathTrusted`＝无需安装；被拒→现出示叶证书供装；捕获件保留为 bootstrap）；`TrustTarget.secret` 退役、增 `clientOrigin`；`trustTargetFor` 按条目判定；面板增「公共可信/已安装，无需安装」呈现（zh-CN/en-US 各＋1 key，1981/1981 对齐）。
- **B3/A5 测试**：`tests/shell/gateway-trust.test.ts`（5 例：域名免装/IP 供装/指纹不符重读/无 https 路径诚实缺席/bootstrap）＋`client-https-entry.test.ts`（接线围栏）＋prompt-page/client-apps/client-sync-plan 增改；`shell-entries.test.ts` 旧围栏（PEM 来自网关 CA）按新裁定改期望。
- **C1**：`httpsClientUrl` 措辞改「网关自身 HTTPS 监听」，去「填到 Claude Desktop」误导（两 locale）。
- **阶段读数**：shell+build 241/241；trust+fence 17/17；两套 tsc 0 错；locale 1981/1981。全量 gate 收尾独跑。
- **C3 本机验收**：需新构建的壳 UI 操作（两条 235 入口各切换一次 Claude Desktop），见回报清单。