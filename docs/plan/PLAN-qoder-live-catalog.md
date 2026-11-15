# PLAN — Qoder 在线模型目录 + 全渠道静态快照普查

日期：2026-11-15 触发：用户报障「Qwen3.8-Flash 页面标免费但客户端权重非 0；Qwen4-Max-preview 页面缺失」。
授权：用户当轮明确「重采快照 + 不要静态表、要随官方实时更新 + 普查其它账号渠道」。本 PLAN 为决策档案，方向已批，逐阶段推进。

## 根因（已核实）
- 页面清单+「免费」标注 = 渠道包静态快照。Qoder `listModels/listAllModels` 恒读 `qoder-product.ts` 的 `fallbackModels`（CN 表 2026-09-27 实测），**无任何在线目录请求**。
- 「免费」是 `qoderDisplayName` 在 `priceFactor===0` 时拼进 name 的。快照里 qfmodel `priceFactor:0`（免费是促销价）。上游调价后页面失真。
- Qwen4-Max-preview（`qmodel_latest`）为快照后新增/改名，静态表无发现机制 ⇒ 永远缺失。

## 在线目录机制（已逆向 + 现网实测验证）
- 端点：`GET {encryptedInferBase}/algo/api/v2/model/list`（CN=gateway.qoder.com.cn，国际=api2.qoder.sh）。
  **无 `?Encode=1`**（现网 CLI 日志 + 探针均证实），响应为**明文 JSON**（`decryptServerResponse` 失败回退原文）。
  顶层 scenes：chat/developer/assistant/inline/quest/qwork/experts/qwake/app/qcode/byok_teams/byok_enterprise；**只取 chat**（CN 现网 12 条）。
- 签名：`qodercontext_prepareRequest`（14 参，body/headersJson 缺省传 0,0），authMode='auth'。vendored 旧 WASM（COSY_VERSION 1.1.49）签名**被现网接受**（HTTP 200 实测），无需提取新 WASM。
- 凭据：客户端 `~/.qoder-cn/.auth/user` 加密，`credential_storage_decrypt(text, machineId.slice(0,16))` 可解（存储密钥即 machineId 前 16 字符）⇒ 本地探针已成功解密真实凭据并现网拉取目录，绕开「必须部署才能测」。

## 阶段
### A. 全渠道普查 —— 已完成（结论见 C）
### B. Qoder 在线目录 —— 已完成
1. `qoder-wasm.ts`：`prepareRequest`（通用签名）+ `decryptServerResponse` + `decryptCredentialStorage`（诊断用）；`prepareInfer` 结果读取重构为 `readRequestResult`。
2. `qoder-adapter.ts`：`normalizeQoderCatalogEntry`（纯函数归一）+ `fetchRemoteCatalog` + `ensureRemoteModels`（RemoteCatalogGate + 5min TTL，照 cline 范式）+ `modelEntry`（remote??fallback）；`listAllModels`/`listModels`/`resolveModel`/stream 全部改读 remote??fallback。静态表降为兜底。
3. 基线重采：CN 12 条 + 国际 15 条 live 快照替换旧表（`qoder-product.ts`），均经单测断言「兜底表 == normalize(现网目录)」逐条相等。国际经网关国际账号在线拉取（凭据在 channel-pack/credentials.json，出网走 host-proxy）。
4. 测试：`tests/channels/qoder-catalog-normalize.test.ts`（6 例，含 CN/国际基线一致性 + 归一边界）；既有 qoder/account-stop 26 例无回归；channel-pack 打包通过。

### C. 其它渠道普查结论（修复属新范围，交付 Qoder 后呈现并提议，未批不扩）
**完全静态**（页面恒读快照，无在线发现）：
- **opencode**：`listAllModels`（opencode-adapter.ts:240）恒读 opencode-product.ts 静态表（16 条），channel-pack-rpc.ts:4212 优先它 ⇒ 页面清单永不更新。`listModels` 虽在线，但被 `REACHABLE_IDS`/`FREE_IDS` 静态闸门掐死、models.dev `cost.input===0` 采而不用（opencode-capability.ts:239）。**优先级最高**。
- qoder：本批已修。

**半漂移**（部分在线，但清单/价格/免费标注仍受静态件污染）：
- **lobsterai**：`costMultiplier > 0` 过滤（lobsterai-adapter.ts:278）吞掉 0 倍率 ⇒ 免费模型丢失倍率标注（displayName 1733-1734）。**已核实**。
- **cline**：免费并集含静态 `fallback.isFree`（cline-models.ts:30/94）⇒ 转付费模型可被继续标「免费」。**已核实**。
- **buddy/workbuddy**：价格在线，但清单按兜底白名单重建、非 agentReferenced 新增被丢（buddy-oauth.ts:401-423,494-514；buddy-adapter.ts:1040-1087）。
- **loomy/raccoon**：在线倍率实时，但离线兜底把倍率写死进 name（loomy-product.ts:99-106；raccoon-product.ts:208-246）。

**共性放大器**：除 gemini(5min)/opencode(5min)/trae-auth(30s/5min，但被适配器永久缓存覆盖)外，多数渠道「成功即永久缓存、无 TTL」⇒ 即便在线也不刷新。统一 TTL 复用 `ttl-cache.ts`/`RemoteCatalogGate`。

**健康**（在线且实时，无需改）：comate / gemini / minimax / trae / zcode / codearts。

**建议修复优先级**：opencode listAllModels+白名单 → lobsterai `>0` → cline 静态免费 → 统一 TTL。
（注：buddy/loomy/raccoon 的 file:line 来自普查子代理，修复时需按现网源码复核。）

### D. 收尾 —— 进行中
`npm run gate` 全量一次（SSH→WSL，只在收尾跑）；部署 WSL 网关（scripts/deploy-wsl-daemon.sh，/root/mpd）；经 `model.list`/页面核对 Qwen4-Max-preview 出现、qfmodel 倍率与客户端一致；国际版尝试经网关重采。

## 验收
- 页面 Qoder 清单 = 现网实时目录（含 Qwen4-Max-preview），qfmodel 标注与客户端权重一致。
- 上游再调价/加模型，页面随 TTL 刷新，无需改代码。
- 其它同病渠道：审计结论已交付，修复待用户批准后按优先级推进；gate 绿。