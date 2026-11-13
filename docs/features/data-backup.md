# 完整备份与迁移

> 适用版本：v1.7.3 ｜ 最后核对：2026-11-14 ｜ 状态：现行

## 这个功能点是什么

设置 → 数据安全 → **完整备份与迁移**：把本机的全部业务数据与配置打成一个 JSON 文件，在另一台电脑（或重装后的同一台）导入，得到与导出时一致的状态。与它同页的「界面偏好同步」只搬 13 个 UI 偏好，不搬任何业务数据；两者不可互相替代。

导出有两种送达方式、同一套采集/封装引擎：桌面端弹原生保存对话框写盘（`0600`）；浏览器控制台（无头网关服务的 `/ui/`）走 `delivery: 'payload'`——网关把文件内容随结果原样返回，浏览器触发下载，落在看页面这台机器的下载目录。无头宿主没有对话框，但浏览器有下载能力，所以界面不再以 `desktop-only` 拒绝导出（旧版网关仍会报，文案专门说明）。

一份备份包含：

| 数据 | 来源 |
| --- | --- |
| 供应商、聚合条目、渠道 provider 记录、自定义端点 | `data.json: providers` |
| 账号与凭据（API Key / Cookie / refresh token） | `data.json: accounts[].credentials`（导出时已解密） |
| 路由表、模型别名、代理 API Key、管理密钥、请求与压缩配置 | `data.json: config`（完整 `AppConfig`） |
| 模型标注、overrides、标准库采用台账、实时额度快照 | `data.json` 同名键 |
| 统计与 Token 账本（可选） | `data.json: statistics` / `tokenUsage` |
| 请求日志、应用日志（可选，默认关闭） | `request-logs/`、`logs/` ndjson |
| 渠道账号、渠道凭据、模型黑名单、永久积分锁定 | 渠道包 `backup.export` RPC |

不搬的东西：`store.key`（本机密钥库封装，换机无意义）、额度账本（`quota-ledger.json`，本机计量窗口）、`derived/` 下的探测与目录快照（可重建）。

## 为什么不能直接拷 `~/.modelport`

`data.json` 由 `store.key` 加密，而 `store.key` 是 `safeStorage` 用**本机**密钥库封装的；账号凭据还在此之上逐字段再封一次。同一台机器拷目录能用，换台机器每个字段都解不开 —— `decryptData` 返回 `null`，请求一路 401，错误信息里只有一串像 Key 的 base64。所以备份件里存的是**明文**：导出侧解密，导入侧用本机密钥重新加密。

明文件有被人拿走即用的风险，因此导出可选用户口令封装：scrypt（N=16384, r=8, p=1）派生 32 字节密钥，AES-256-GCM 加密，KDF 参数与盐、IV 一起写进文件头，换机器用同一口令即可解开。口令不落盘，忘记即无法恢复。

## 关键行为与不变量（必守约束）

- **导入只认主进程读过的文件**：`backup:pick` 由主进程弹原生对话框读文件、解析、缓存，返回一次性 `token`；`backup:apply` 只接受 token。渲染层没有「把一段自定 JSON 当备份导入」的通道，否则任何能执行渲染层 JS 的东西都能绕过专用通道改账号表。浏览器导入是它的镜像：`<input type=file>` 选件、字节上传 `POST /v1/management/backup/stage`，喂同一个引擎。
- **导出只序列化一次，送达分流**：`exportBackup` 先采集、序列化（明文或口令封装），再按 `delivery` 分流。`'payload'` 不弹框、不写盘，回 `fileName` + `payload` + 摘要；缺省走对话框写盘。管理面 RPC 与桌面 IPC 共用这一条通道，鉴权不变（管理密钥）。
- **token 单次使用、10 分钟过期**，最多缓存 4 份。`apply` 成功后立即删除；同一份件点两次「导入」不会把第一次的结果再覆盖一遍。
- **覆盖模式先留副本**：落库前把 `data.json` 复制到 `data.pre-restore.<时间戳>.json`，路径随结果返回给界面。
- **覆盖模式要求备份里有 `providers` 数组与 `config` 对象**，否则拒绝（`wrong-format`）。缺这两块的「备份」多半是手改件，整份覆盖会把账号表清成空。
- **路由在恢复时必须取备份那份**：`storeManager.restoreConfig()` 与 `setConfig()` 的唯一差别就在这里。`setConfig` 永远保留盘上现表（渲染层镜像可能陈旧），拿它做恢复会让每个别名都解析不到候选。
- **合并模式本地优先**：供应商/账号按 `id` 取并集，只补本地没有的；`config` 整体保留本机设置（端口、绑定地址、鉴权、管理密钥），只往 `modelMappings` / `routes` 里补本地没有的名字。统计、日志、渠道登录态在合并模式下不落库 —— 统计相加会把同一批请求记两遍，渠道包是整份替换语义（半份合并会让账号池与凭据表错位）。
- **落库前清洗形状**：供应商与账号逐条校验（缺 `id` / 缺 `providerId` 整条丢弃并计数），必填标量补安全缺省；日志行要求 `id`+`timestamp`（请求）或 `level`+`message`+`timestamp`（应用）。备份是外部输入，不能让 `undefined` 铺进直读这些字段的界面。
- **导入后必须重启**：供应商与账号在启动时播种并镜像进运行时，热替换会留下两套并存状态。界面给「立即重启」按钮（`app.relaunch()` + `app.quit()`），不重启则下次启动生效。
- **渠道登录态走渠道包自己的 RPC**：`backup.export` / `backup.import`，不拷 `channel-pack/*.json`。那份目录里有同机多 profile 共享的文档与整体替换语义的 `state.json`，按文件搬运会把别人的行一起带走，也绕过了包内的字段迁移。渠道运行时不可用时导出继续，附 `channel-unavailable` 警告。
- **凭据解不开时不写坏值**：导出逐字段解密，失败的字段不进备份，标注 `credentials-unreadable`；导入侧对明文逐字段重新 `encryptData`，落盘的永远是本机可解的密文。

## 文件格式

```jsonc
{
  "format": "modelport-backup",
  "version": 1,
  "appVersion": "1.7.1",
  "createdAt": "2026-11-04T02:00:00.000Z",
  "platform": "win32",
  "scope": { "includeStatistics": true, "includeLogs": false },
  "warnings": ["credentials-unreadable"],
  "data": {
    "providers": [], "accounts": [], "config": {},
    "userModelOverrides": {}, "userModelMarks": {}, "catalogAdoptions": [],
    "aggregateCreditSnapshots": {}, "statistics": {}, "tokenUsage": {},
    "channels": { "accounts": [], "credentials": {}, "disabledModels": {} },
    "requestLogs": [], "appLogs": []
  }
}
```

封装件的外层是 `{"format":"modelport-backup-sealed","version":1,"sealed":{…}}`，`sealed` 里是 `algorithm` / `kdf` / `n` / `r` / `p` / `salt` / `iv` / `tag` / `ciphertext`，缺一项即判为不合法。版本高于当前应用时拒绝导入（`unsupported-version`），低于当前版本照常放行，读不懂的字段由各自的归一逻辑丢弃。

## 代码落点

| 位置 | 职责 |
| --- | --- |
| `src/shared/backup.ts` | 格式常量、`BackupBundle` / `BackupPreview` 类型、`parseBackupDocument`、`summarizeBackup`、`mergeById`、`mergeNamedTables`（纯逻辑，主/渲染共用） |
| `src/main/backup/service.ts` | 采集、序列化、送达（对话框写盘 / payload 返回）、读盘、token 缓存、覆盖与合并落库、重启 |
| `src/main/backup/sanitize.ts` | 供应商/账号/日志行的落库前清洗 |
| `src/main/backup/crypto.ts` | scrypt + AES-256-GCM 封装与解封 |
| `src/main/backup/ipc.ts` | `backup:export` / `pick` / `unlock` / `apply` / `cancel` / `restart` |
| `src/main/store/store.ts` | `restoreConfig()`（路由取传入那份）、`replaceRequestLogs()` |
| `src/renderer/src/components/settings/DataBackup.tsx` | 导出选项、口令、导入预览、模式选择、重启提示 |
| `src/renderer/src/api/headless.ts` | 浏览器字节通道：`uploadBackup`（选件上传）与 `downloadBackup`（payload 触发下载） |

## 排查

- 「导入成功，重启后数据没变」：看设置页日志里的 `备份已导入（覆盖/合并）` 是否带 `skipped`；合并模式不落库统计与渠道登录态是设计行为。
- 「账号都在，但全部 401」：备份导出时本机已解不开那些凭据（`credentials-unreadable`），或导入时选的是不含凭据的旧版备份。重新填一次 Key 即可。
- 「渠道卡片变成未配置」：导出时渠道运行时不可用（`channel-unavailable`），或导入时渠道包 `backup.import` 失败（结果 `skipped` 含 `channels`）。渠道账号需要在渠道页重新登录。
- 「想要回滚」：用结果里给的 `data.pre-restore.<时间戳>.json` 覆盖回 `~/.modelport/data.json`，重启应用。
- 「浏览器里导出报 desktop-only」：网关版本早于 payload 导出（`delivery: 'payload'`）。升级网关；或在桌面端导出。
