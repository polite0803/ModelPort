# HTTPS 与证书信任

> 适用版本：v1.7.0 ｜ 最后核对：2026-11-04 ｜ 状态：现行

## 这个功能点是什么

ModelPort 的代理除了 HTTP 监听，还可以同时开启一个 TLS 监听（默认 8443）。两个监听器共用同一个 Koa 应用与同一套路由，区别只在传输层：HTTP 走明文，HTTPS 走 `https.createServer` 并在建立连接时出示证书。

证书有两种来源。第一种是应用托管的自签名证书，首次启用 HTTPS 时生成到 `~/.modelport/tls/server.crt` 与 `server.key`；第二种是用户自带的一对 PEM 文件，通过 `httpsCertPath` 与 `httpsKeyPath` 配置。托管证书会为 `localhost`、`127.0.0.1`、`::1` 以及用户额外填写的 `httpsSanHosts` 生成 SAN，客户端用地址访问时证书名必须落在 SAN 里，否则 TLS 校验失败。

HTTPS 监听不是“可选的装饰”。Claude Desktop 的网关在部分配置下直接拒绝明文 HTTP，只接受 TLS 地址，因此设置页把 HTTPS 端口与证书状态放在代理配置的首屏；但 HTTPS 只解决传输，不解决客户端是否信任这张证书。

设置页展示证书的 subject、issuer、有效期、SHA-256 指纹、SAN 与来源，并提供“安装到系统信任”按钮。这个按钮只会写操作系统信任库（Windows 用 `certutil -user -addstore Root`，macOS 用 `security add-trusted-cert`），并且只在用户点击时执行，启动过程不会改动信任库。

真正容易出错的地方是“信任”有两个消费者。Chromium/Schannel 系客户端（Claude Desktop、浏览器、Windows `curl`）读操作系统信任库；Node 系客户端（Codex CLI、WorkBuddy/CodeBuddy agent、任何基于 `node:https` 或 undici 的程序）完全不读它，只认 Node 自带的 CA 集合加上 `NODE_EXTRA_CA_CERTS`。因此面板上的 `trusted: true` 只能回答前一类客户端的问题。

排查顺序应当是：先看 `TlsStatus.running` 与 `TlsStatus.error`（监听有没有起来、端口是否被占），再看 `certificate.subjectAltName` 是否覆盖客户端实际使用的地址，最后看 `handshakeRejections.byCode`。若计数为空且请求日志有行，说明握手成功、问题在 HTTP 层；若计数非零且请求日志无行，说明失败发生在 TLS 层，客户端的证书校验根本没让请求进入网关。

证书状态与信任状态是两件事。`TlsCertificateInfo` 只描述监听器出示的那张证书（来源 `managed` / `custom`、路径、subject、issuer、SHA-256 指纹、有效期、SAN、是否自签名）；`trusted` 描述操作系统信任库的探测结果，平台没有廉价探针时是 `null` 而不是 `false`。把两者混读，会把“证书有效”当成“客户端一定连得上”。

## 关键行为与不变量（必守约束）

- **证书与私钥必须成对出现**。只填 `httpsCertPath` 或只填 `httpsKeyPath` 会在启动监听前报错（`HTTPS certificate and key must be provided together`）；私钥与证书公钥不匹配也会拒绝加载。
- 托管证书有效期 397 天，剩余不足 7 天时重签；重签判据还包括“当前必须覆盖的主机名是否都在 SAN 里”，名单不变时指纹保持稳定，不会每次启动都作废用户已经装好的信任。〔v1.5.0 起〕
- 必须覆盖的主机名永远是 `localhost`、`127.0.0.1`、`::1` 加 `httpsSanHosts`；IP 走 SAN type 7，域名走 type 2。`httpsSanHosts` 的非法项（既不是 IP 也不是合法 DNS 名）在配置校验阶段被拒绝。
- `httpsPort` 默认 8443，取值 1–65535；HTTPS 开启时不能与 `proxyPort` 相同。
- 启用 HTTPS 不会自动改写 `proxyHost`：监听地址沿用主代理配置，默认 `127.0.0.1`，需要局域网访问时必须显式调整。
- **`TlsStatus.trusted` 只代表系统信任库**。Node 系客户端需要 `NODE_EXTRA_CA_CERTS=<certPath>`；设置面板会打印这行可复制文本，`GET /v1/management/tls/ca` 则把同一份 PEM（只有证书，绝不含私钥）交给另一台机器。〔v1.5.5 起〕
- **客户端拒绝握手的请求在网关侧没有请求行**：没有路由执行，就没有请求日志、没有 `X-Request-Id`、没有尝试链。唯一证据是 `httpsServer.on('tlsClientError')` 交给 `createHandshakeRejectionTracker` 的计数，按 OpenSSL code 分组，暴露为 `TlsStatus.handshakeRejections`。〔v1.5.5 起〕
- 握手拒绝计数从监听启动开始，监听停止即丢弃计数，不会留下“仍在拒绝”的陈旧读数；同一 code 在 30 秒窗口内只写一次应用日志，避免重试客户端刷爆日志。
- `isCertificateRejection` 只把证书类 code（如 `DEPTH_ZERO_SELF_SIGNED_CERT`、`UNKNOWN_CA`、`CERT_HAS_EXPIRED`）归为信任问题；协议类失败（`ERR_SSL_WRONG_VERSION_NUMBER`、`EPROTO`，通常是 HTTP 客户端打到 HTTPS 端口）必须给出不同提示，因为修法不同。
- Node 服务端收到客户端拒绝证书时往往只看到裸 `ECONNRESET`，`DEPTH_ZERO_SELF_SIGNED_CERT` 这个 code 留在客户端。不要凭服务端 code 断言“客户端不信任证书”，只能陈述“握手在请求前结束”。〔v1.5.5 起〕
- Windows 撤销信任**不能**用 `certutil -delstore`：实测序列号不匹配时它仍返回 0 并删掉库中第一条；实现改为 PowerShell 按 SHA-1 指纹精确过滤，未命中时什么都不删。〔v1.5.0 起〕
- 托管证书依赖 `selfsigned`，该依赖必须打进主进程 bundle：安装包的 asar 不携带 `node_modules`，外置化会在启动时崩溃。
- `/v1/management/tls/ca` 与 `/tls/status` 都经过 `managementAuthMiddleware`；`/ca` 在证书尚未生成时返回 404 `certificate_not_found`，不会顺手生成一张新证书。
- 证书材料在代理启动时读取与校验；替换自定义 PEM 或修改 `httpsSanHosts` 后需要停止再启动代理才生效，运行期不会热加载文件。
- 关闭 `httpsEnabled` 只停止 TLS 监听，不删除 `~/.modelport/tls/` 下的托管证书与私钥；再次开启会复用同一对文件（SAN 名单变化时才重签）。
- TLS 监听启动失败（例如端口已被占用）只会写 `TlsStatus.error` 并令 `running: false`，不会连带停掉 HTTP 监听；错误文案会明确是“HTTPS port … is already in use”还是证书加载失败。
- HTTP 与 HTTPS 共用同一个 Koa 实例、同一套路由和同一套鉴权；TLS 层失败不进入业务中间件，因此不会触发账号冷却、不会计入成功率、也不会出现在仪表盘流量里。
- Linux 的信任安装/移除按发行版给出命令提示（`trust anchor`、`update-ca-certificates`），应用不替用户执行 `sudo`；安装结果里的 `trusted` 仍是 `null`，需要用户自行确认。
- 客户端必须在证书安装/移除后重启才会重新读取信任库；安装成功只代表“证书已写进当前用户库”，不代表已经打开的那个进程立刻生效。
- 证书安装没有“悄悄帮用户装”的路径：启动、开启 HTTPS、保存配置都不会改动系统信任库，唯一入口是设置页的显式操作（或调用管理接口/等价 IPC）。
- `httpsSanHosts` 只作用于托管证书；自定义 PEM 的 SAN 完全由文件本身决定，填了额外主机名也不会被重签，客户端仍按证书里的 SAN 校验。
- 证书与私钥不进入日志、诊断包或配置导出：诊断包只记录 HTTPS 开关与端口，PEM 只在用户主动调用 `/tls/ca` 或安装信任时读取。
- 两类典型误配可以从握手 code 直接区分：HTTP 客户端打到 HTTPS 端口通常得到 `ERR_SSL_WRONG_VERSION_NUMBER` / `EPROTO`；HTTPS 客户端打到 HTTP 端口则表现为连接被重置或空响应，二者都不是证书信任问题。
- 证书过期时客户端在握手阶段就会拒绝，请求同样不会留下请求行；排查“昨天还能连、今天连不上”时，先看 `certificate.validTo`，再看 SAN 与信任库。
- 多机部署的正确做法是把 `/tls/ca` 返回的 PEM 与 `fingerprint256` 一起分发，接收端安装后用同一指纹核对；“能下载到证书”不等于“装进了正确的信任库”。
- HTTP 与 HTTPS 可以同时监听同一个 host，只是端口不同；客户端脚本必须显式选择 `https://` 并带上端口，不能假设“开了 HTTPS 就自动跳转”。
- 托管证书只在证书文件缺失、临近过期或 SAN 不覆盖时重写；用户替换自定义 PEM 后，状态来源变为 `custom`，应用不会再生成或覆盖那份文件。

## 配置项与默认值

| 配置键 | 默认值 | 作用 |
| --- | --- | --- |
| `httpsEnabled` | `false` | 是否同时开启 TLS 监听 |
| `httpsPort` | `8443` | TLS 监听端口，须与 `proxyPort` 不同 |
| `httpsSanHosts` | `[]` | 额外写进托管证书 SAN 的 IP / 域名 |
| `httpsCertPath` | 空（未声明） | 自带证书路径；与 `httpsKeyPath` 成对 |
| `httpsKeyPath` | 空（未声明） | 自带私钥路径；与 `httpsCertPath` 成对 |

环境变量 `NODE_EXTRA_CA_CERTS` 属于客户端侧的配置，不在应用内设置；它指向 `GET /v1/management/tls/ca` 返回的 PEM 落盘位置。

托管证书固定落在 `~/.modelport/tls/`；私钥写入时尝试 `0600` 权限（Windows 可能忽略 POSIX mode，但文件仍在用户目录下）。

管理接口：`GET /v1/management/tls/status` 返回监听状态、证书信息、`trusted` 与 `handshakeRejections`；`GET /v1/management/tls/ca` 返回 `TlsCertificateBundle`（PEM 与元数据，不含私钥）。渲染层的信任操作走 IPC `tls:status`、`tls:install-trust`、`tls:uninstall-trust`，不直接调用系统命令。

## 相关代码位置

- `src/main/proxy/tls.ts` — 证书加载、生成、SAN 校验、信任安装/移除、握手计数
- `src/main/proxy/routes/management/tls.ts` — `/tls/ca` 与 `/tls/status`
- `src/shared/httpsConfig.ts` — SAN 归一化、端口校验、URL 拼接
- `src/main/proxy/server.ts` — HTTPS 监听与 `tlsClientError` 接线
- `src/main/proxy/middleware/managementAuth.ts` — 管理接口鉴权
- `src/main/store/config.ts` — 配置校验入口（`validateHttpsConfig`）
- `src/main/store/types.ts` — `httpsEnabled` / `httpsPort` / `httpsSanHosts` 默认值
- `src/main/ipc/channels.ts` — `tls:status` / `tls:install-trust` / `tls:uninstall-trust`
- `src/main/ipc/handlers.ts` — 信任安装/移除处理器
- `src/renderer/src/components/proxy/ProxyConfigForm.tsx` — 设置页表单与证书状态展示
- `src/renderer/src/pages/ProxySettings.tsx` — 代理设置页容器
- `src/shared/types.ts` — `TlsStatus` / `TlsCertificateBundle` 等形状

## 版本沿革

| 版本 | 变化 | 证据 |
| --- | --- | --- |
| v1.5.0 | 新增 HTTPS 监听（默认 8443、托管自签名证书 397 天、成对自有 PEM、安装到系统信任） | CHANGELOG「v1.5.0」条目 |
| v1.5.0 | 证书可加入远程地址（`httpsSanHosts`，IP 走 SAN type 7、域名 type 2）；重签判据改为“是否覆盖当前名单”；新增“从系统信任移除” | CHANGELOG「v1.5.0」条目 |
| v1.5.0 | Windows 撤销信任改用 PowerShell 按 SHA-1 精确删除，不再使用 `certutil -delstore` | CHANGELOG「v1.5.0」条目 |
| v1.5.5 | 补齐 `NODE_EXTRA_CA_CERTS` 通路、`GET /v1/management/tls/ca` 与 `/tls/status`（握手被拒计数） | CHANGELOG「v1.5.5」条目 |
