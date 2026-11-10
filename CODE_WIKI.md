# ModelPort 项目代码文档

> 适用版本：v1.7.0 ｜ 最后核对：2026-11-04 ｜ 状态：部分过期

> 这是一份较早的概览文档，保留用于快速定位模块。规则与现状以根目录 [`AGENTS.md`](AGENTS.md) 和
> [`docs/AGENTS-full.md`](docs/AGENTS-full.md) 为准；两者与本文不一致时，以它们为准。文档索引见
> [`docs/README.md`](docs/README.md)。

## 1. 项目概述

ModelPort 是一个多平台 AI 服务统一管理工具，把任意 OpenAI 兼容端点汇总为一份本地 API。它内置 92 条带 Key / 免密的聚合渠道目录（含 Kilo 免费池，共 580 个模型）、13 个账号渠道（浏览器 / 设备码 / API Key）以及自定义供应商，并与 openclaw、Cline、Roo-Code 等工具无缝集成，使任何 OpenAI 兼容客户端都能开箱即用。

### 核心功能
- OpenAI 兼容 API：提供标准的 OpenAI 兼容 API 端点，实现无缝集成
- 多提供商支持：92 条聚合渠道（API Key / 免费额度 / 本机，共 580 个模型）、13 个账号渠道以及自定义供应商
- 上下文管理：滑动窗口 / 令牌限制的删除式裁剪，永不清空对话；可选的实时区压缩不注入提示词
- 函数调用：`tools` / `tool_choice` / `parallel_tool_calls` 原生透传，网关不改写工具定义或文本回复
- 模型映射：灵活的模型名称映射，支持通配符和首选提供商/账户选择
- 自定义参数：支持自定义 HTTP 头，启用网络搜索、思考模式和深度研究功能
- 仪表板监控：实时请求流量、令牌使用和成功率
- API 密钥管理：为本地代理生成和管理密钥
- 模型管理：查看和管理所有提供商的可用模型
- 请求日志：详细的请求日志，用于调试和分析
- 代理配置：灵活的代理设置和路由策略
- 系统托盘集成：从菜单栏快速访问状态
- 多语言支持：英语和简体中文支持
- 现代 UI：清洁、响应式界面，支持明暗主题

## 2. 项目架构

ModelPort 采用 Electron 架构，分为主进程和渲染进程两部分。主进程负责核心功能实现，包括代理服务器、账户管理、模型管理等；渲染进程负责用户界面展示。

### 架构图

```
ModelPort/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts            # 应用入口点
│   │   ├── autostart.ts        # 开机自启动（autostartHost.ts 为宿主侧探测）
│   │   ├── tray/               # 系统托盘集成（index.ts / TrayManager.ts / TrayWindow.ts）
│   │   ├── proxy/              # 代理服务器管理
│   │   ├── ipc/                # IPC 处理器
│   │   ├── store/              # 数据存储
│   │   ├── oauth/              # OAuth 认证
│   │   ├── providers/          # 提供商管理
│   │   ├── channelPack/        # 账号通道宿主（worker / bridge / compat）
│   │   ├── requestLogs/        # 请求日志
│   │   ├── appLogs/            # 应用日志
│   │   ├── window/             # 窗口管理
│   │   ├── updater/            # 应用内更新
│   │   └── types/              # 类型声明（含 channelPack.d.ts）
│   ├── preload/                # 上下文桥接
│   └── renderer/               # React 前端
│       ├── components/         # UI 组件
│       ├── pages/              # 页面组件
│       ├── stores/             # Zustand 状态管理
│       ├── hooks/              # 自定义钩子
│       └── i18n/               # 国际化（en-US / zh-CN）
├── tests/                      # Node 内置测试运行器用例（按子系统分目录）
├── docs/                       # 计划与执行状态文档
├── build/                      # 构建资源
└── scripts/                    # 构建脚本
```

## 3. 主要模块职责

### 3.1 主进程 (Main Process)

#### 3.1.1 应用核心 (src/main/index.ts)
- 应用启动和初始化
- 窗口管理
- 系统托盘集成
- 异常处理

#### 3.1.2 代理服务 (src/main/proxy/)
- 提供 OpenAI 兼容的 API 端点
- 管理请求路由和转发
- 实现负载均衡策略
- 模型映射和转换
- 会话管理
- 上下文压缩（`compression/`，见 §4.1.5）
- 额度计量与预检（`quota/`）
- 账号通道与聚合目录的转发适配（`adapters/`、`routes/management/`）

#### 3.1.3 数据存储 (src/main/store/)
- 管理应用配置
- 存储提供商和账户信息
- 日志管理

#### 3.1.4 OAuth 认证 (src/main/oauth/)
- 处理不同提供商的认证流程
- 令牌提取和管理

#### 3.1.5 提供商管理 (src/main/providers/)
- 内置提供商通路（当前 `builtinProviders` 为空）
- 自定义提供商配置
- 提供商状态检查
- 聚合目录（`aggregate/`：registry 数据 + manager）与登录账号通道（`accountChannels/`）

#### 3.1.6 账号通道宿主 (src/main/channelPack/)
- 拉起 `vendor/channel-pack` 的 worker 进程并收发消息（`bridge.ts`）
- 推理内容回放（`reasoningReplay.ts`）与工具违规观测（`proxy/utils/toolViolationTap.ts`，只读原生 `tool_calls`）
- `compat/` 提供上游私有包的兼容垫片，仅通过 esbuild alias 生效

### 3.2 渲染进程 (Renderer Process)

#### 3.2.1 界面组件 (src/renderer/src/components/)
- 仪表板组件
- 提供商管理组件
- 代理设置组件
- 模型管理组件
- 日志查看组件

#### 3.2.2 页面 (src/renderer/src/pages/)
- 仪表板页面
- 提供商页面
- 代理设置页面
- 模型页面
- API 密钥页面
- 日志页面
- 设置页面
- 聚合目录页面（`Aggregate.tsx`，五态额度与免费池标记）
- 登录账号通道页面（`Channels.tsx`）
- 关于页面（`About.tsx`）

#### 3.2.3 状态管理 (src/renderer/src/stores/)
- 仪表板状态
- 提供商状态
- 代理状态
- 导航状态
- 设置状态

## 4. 关键类与函数

### 4.1 主进程核心类

#### 4.1.1 ProxyServer (src/main/proxy/server.ts)
- **职责**：实现基于 Koa 的代理服务器
- **主要方法**：
  - `start(port, host)`：启动代理服务器
  - `stop()`：停止代理服务器
  - `restart(port, host)`：重启代理服务器
  - `isRunning()`：检查服务器是否运行
  - `getStatistics()`：获取服务器统计信息

#### 4.1.2 LoadBalancer (src/main/proxy/loadbalancer.ts)
- **职责**：实现负载均衡策略（`round-robin | fill-first | failover | smart | pace`）
- **主要方法**：
  - `selectAccount(model, strategy, preferredProviderId, preferredAccountId)`：选择合适的账户
  - `markAccountFailed(accountId)`：标记账户失败
  - `clearAccountFailure(accountId)`：清除账户失败状态
  - `selectChainCandidates(model, preferredAccountId)`：裸模型名的聚合跨家链候选（按 headroom 排序）
  - `selectSameProviderCandidates(model, providerId, excludeAccountId)`：同一供应商的其余可用账号
  - `getAvailableAccountCount(model, providerId)`：可用账户数量
  - `getAvailableModels()`：全部可路由的模型显示名
  - `getAvailableAccounts(...)` 为私有方法，不属于对外接口

#### 4.1.3 ModelMapper (src/main/proxy/modelMapper.ts)
- **职责**：支持请求模型到实际模型的映射
- **主要方法**：
  - `mapModel(requestedModel, provider)`：映射模型名称
  - `getActualModel(requestedModel, providerId)`：获取实际模型名称
  - `getPreferredProvider(requestedModel)`：获取首选提供商
  - `addMapping(requestModel, actualModel, preferredProviderId, preferredAccountId)`：添加模型映射

#### 4.1.4 StoreManager (src/main/store/store.ts)
- **职责**：管理应用数据存储
- **主要方法**：
  - `getConfig()`：获取应用配置
  - `updateConfig(config)`：更新应用配置
  - `getProviders()`：获取提供商列表
  - `getAccountsByProviderId(providerId, includeCredentials)`：获取指定提供商的账户（第二个参数是"是否解密凭证"，不是"是否只取启用项"）
  - `addLog(level, message, data)`：添加日志

#### 4.1.5 上下文压缩 (src/main/proxy/compression/)
- **职责**：在路由之后、托管标记注入之前压缩请求内容里的可压片段；全链路 fail-open，任何异常都原样转发
- **入口**：
  - `applyCompression(input)`：压缩 live zone 并产出 `CompressionReport`（`index.ts`）
  - `recordCompressionReport(requestId, report)` / `takeCompressionReport(requestId)`：把报告从转发器交给路由层（路由负责响应头与请求日志行）
- **模块划分**（共 15 个文件）：
  - `index.ts`：门面与报告注册表
  - `detector.ts`：内容类型识别（JSON 数组 / JSON 文档 / 日志 / 搜索 / 源码 / 纯文本等）
  - `estimator.ts`：内容感知的 token 估算
  - `policy.ts`：门禁（必须严格变小，且至少省 `MIN_SAVINGS_RATIO`）
  - `liveZone.ts`：live zone 选取与字节区间替换
  - `types.ts`：共享类型与阈值常量（配置类型来自 `src/shared/types.ts`）
  - `compressors/smartCrusher.ts`：JSON 统计选行压缩
  - `ccr/store.ts`、`ccr/markers.ts`：可逆内容寻址存储与哨兵标记
  - `signals/adaptiveSizer.ts`、`signals/errorKeywords.ts`：保留行预算与错误关键词分级
  - `outputSteering.ts`：输出侧 verbosity 注入
  - `duplication.ts`、`duplicationSummary.ts`、`survivorship.ts`：**只观测不改动请求**的跨轮重复度与会话存活期统计
- **配套管理接口**：`src/main/proxy/routes/management/compression.ts`（`/v1/management/compression/status|retrieve|duplication`）
- **注入点**：`src/main/proxy/forwarder.ts`（`applyCompression` / `applyVerbositySteering` / `measureCrossTurnDuplication` / `recordConversationTurn`），报告在 `src/main/proxy/routes/chat.ts` 取回
- **配置**：`src/shared/types.ts` 的 `CompressionConfig` / `DEFAULT_COMPRESSION_CONFIG`，落地在 `src/main/store/compressionConfig.ts`

#### 4.1.6 额度计量 (src/main/proxy/quota/)
- **职责**：聚合目录的额度记账、观察学习与预检；`smart` / `pace` 路由策略读同一份账本
- **主要文件**：
  - `ledger.ts`：滚动分钟 / 24 小时 + UTC 自然月的用量账本（防抖落盘）
  - `observations.ts`：从上游响应头与 429 正文学习上限（只降不升）
  - `limits.ts`：条目帽 / 逐模型帽 / 实测帽合并
  - `usage.ts`：请求与响应的 token 计量（估算值不写进客户端响应）
  - `gate.ts`：`autoRouter` 与 `loadbalancer` 共用的预检判据

### 4.2 渲染进程核心组件

#### 4.2.1 Dashboard (src/renderer/src/pages/Dashboard.tsx)
- **职责**：展示应用仪表板，包括请求统计、提供商状态等

#### 4.2.2 Providers (src/renderer/src/pages/Providers.tsx)
- **职责**：管理 AI 服务提供商和账户

#### 4.2.3 ProxySettings (src/renderer/src/pages/ProxySettings.tsx)
- **职责**：配置代理服务器设置，包括端口、负载均衡策略等

#### 4.2.4 Models (src/renderer/src/pages/Models.tsx)
- **职责**：管理和查看可用的 AI 模型

#### 4.2.5 ApiKeys (src/renderer/src/pages/ApiKeys.tsx)
- **职责**：管理 API 密钥

## 5. 依赖关系

### 5.1 核心依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Electron | 33+ | 跨平台桌面应用框架 |
| React | 18+ | UI 框架 |
| TypeScript | 5+ | 类型安全的 JavaScript |
| Koa | 2.15+ | HTTP 服务器 |
| Zustand | 5+ | 状态管理 |
| Tailwind CSS | 3.4+ | CSS 框架 |
| Axios | 1.7+ | HTTP 客户端 |
| electron-store | 10+ | 数据存储 |
| eventsource-parser | 3+ | 处理 Server-Sent Events |
| i18next | 25+ | 国际化 |

### 5.2 开发依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| electron-vite | 2.3+ | 构建工具 |
| vite | 5.4+ | 前端构建工具 |
| typescript | 5.6+ | 类型检查 |
| tailwindcss | 3.4+ | CSS 框架 |
| electron-builder | 25.1+ | 应用打包 |

## 6. 项目运行方式

### 6.1 开发环境

#### 6.1.1 安装依赖
```bash
npm install
```

#### 6.1.2 启动开发服务器
```bash
# Linux/macOS
npm run dev

# Windows
npm run dev:win
```

### 6.2 生产构建

#### 6.2.1 构建应用
```bash
npm run build              # 构建应用
npm run build:mac          # 构建 macOS 版本
npm run build:win          # 构建 Windows 版本
npm run build:linux        # 构建 Linux 版本
npm run build:all          # 构建所有平台版本
```

### 6.3 运行应用

#### 6.3.1 启动应用
```bash
# 预览构建版本
npm start

# 无沙箱模式启动
npm run start:sandbox
```

## 7. 配置与部署

### 7.1 配置文件

应用数据存储在 `~/.modelport/` 目录：
- `data.json` - 单一 electron-store 文件，包含配置、提供商、账户、会话、统计与应用日志（并不存在单独的 `providers.json` / `accounts.json`）
- `store.key` - 本机数据密钥
- `request-logs/` - 请求明细日志
- `channel-pack/` - 渠道包自身状态与加密后的渠道凭证
- `tls/` - 托管的自签名证书与私钥

凭证保护有两层：`store.key` 由系统 `safeStorage` 封装，单个凭证再用 `safeStorage` 加密一层。系统加密不可用时没有可绑定的密钥，数据文件会以明文写入，仅在控制台告警。

### 7.2 代理配置

- **端口**：默认 8080，可在设置中修改
- **路由策略**：轮询（Round Robin）、填充优先（Fill First）、故障转移（Failover）、智能（Smart）、匀速（Pace）；后两者由额度账本驱动
- **API 密钥**：可在设置中启用 API 密钥认证

### 7.3 提供商配置

提供商分为三类：

- 聚合目录：92 条渠道 / 580 个模型（API Key / 免费额度 / 本机），每条保存后生成 `provider/model` 命名空间的供应商记录
- 账号渠道：13 个浏览器 / 设备码 / API Key 账号通道，账户池与模型目录由 `vendor/channel-pack` 提供
- 自定义供应商：自行填入任意 OpenAI 兼容端点

API Key 类条目需要填入对应的密钥；Kilo 这类免密条目保存时会创建空凭据的本地账户，无需额外配置即可路由。

## 8. 开发指南

### 8.1 代码结构

- **主进程**：`src/main/` 目录，包含核心功能实现
- **渲染进程**：`src/renderer/src/` 目录，包含 UI 组件和页面
- **共享代码**：`src/shared/` 目录，包含主进程和渲染进程共享的代码

### 8.2 测试

测试用 Node 内置的 `node --test` 运行器，用例按子系统分目录放在 `tests/` 下：

| 目录 | 覆盖范围 |
|------|----------|
| `tests/api/` | 路由层契约：鉴权策略、错误形状、参数策略、工具违规标记 |
| `tests/proxy/` | 转发与额度：重试策略、计量、流式结果、消息角色 |
| `tests/shared/` | 主进程 / 渲染进程共享纯函数：聚合路由、成本分类、响应线格式 |
| `tests/aggregate/` | 聚合目录转录与多 Key 行为 |
| `tests/channels/` | 13 个账号渠道的不变量（模型目录、上下文窗口、用量口径、推理回放等） |
| `tests/compression/` | 上下文压缩：门禁、live zone、选行、日志/搜索压缩器、CCR 标记、装配 |
| `tests/providers/` | 提供商适配器、模型列表读取、端点策略 |
| `tests/routes/`、`tests/http/` | 路由表、消息 / 响应线转换与 HTTP 层契约 |
| `tests/store/`、`tests/renderer/`、`tests/ipc/`、`tests/main/`、`tests/build/`、`tests/updater/`、`tests/app-logs/`、`tests/request-logs/` | 存储、渲染层、IPC、入口、构建产物守卫与日志 |
| `tests/skills/` | 随仓库分发的技能说明文档一致性检查 |

**必须用 Node 22.18+ 运行（CI 固定 Node 24）。** 仓库里的 `.ts` 用例依赖 Node 原生的 TypeScript 支持，过旧的 Node 22 会在
`node --test` 阶段整片报 `ERR_UNKNOWN_FILE_EXTENSION`，看起来像"测试全挂"，实际是运行时太老。
门禁命令见 `package.json` 的 `scripts`。

### 8.3 扩展提供商

要添加新的提供商支持，需要：
1. 在 `src/main/providers/builtin/` 目录添加提供商实现
2. 在 `src/main/oauth/adapters/` 目录添加 OAuth 适配器
3. 在 `src/main/proxy/adapters/` 目录添加代理适配器
4. 在渲染进程中添加提供商图标和配置界面

### 8.4 调试技巧

- 使用 `npm run dev` 启动开发模式，支持热重载
- 主进程日志可在终端查看
- 渲染进程可使用 Chrome 开发者工具调试（在开发模式下自动打开）

## 9. 常见问题

### 9.1 macOS："App is damaged and can't be opened"

由于 macOS 安全机制，从 App Store 外下载的应用可能会触发此警告。运行以下命令修复：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/ModelPort.app"
```

### 9.2 端口被占用

如果默认端口 8080 被占用，可在设置中修改代理端口。

### 9.3 提供商认证失败

- 检查令牌是否有效
- 确保网络连接正常
- 查看应用日志获取详细错误信息

## 10. 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron 33+ |
| 前端 | React 18 + TypeScript |
| 样式 | Tailwind CSS |
| 状态管理 | Zustand |
| 构建工具 | Vite + electron-vite |
| 打包工具 | electron-builder |
| 服务器 | Koa |

## 11. 许可证

GNU General Public License v3.0。详见 [LICENSE](LICENSE) 文件。

## 12. 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开 Pull Request

## 13. 更新日志

### v1.5.0
- 退役 8 家 Web UI 页面接入供应商（DeepSeek / GLM / Kimi / Mimo / MiniMax / Qwen / Qwen AI / Z.ai），启动时清理其供应商、账户与模型映射
- 新增 79 条聚合渠道目录（API Key / 免费额度 / 本机），支持 openai-chat 与 anthropic-messages 两种线路
- 新增 Kilo 免密免费池（`kilo-auto/free`，仅保留 `isFree` 模型）
- 新增聚合渠道页面与 `aggregate:*` IPC 通道

### v1.2.0
- Implemented automatic application update feature
- Added real-time download progress tracking
- Added one-click install and restart functionality
- Improved error handling and user experience
- Added multi-language support for update UI

### v1.1.4
- 改进上下文管理功能
- 优化模型映射逻辑
- 修复已知 bug

### v1.1.3
- 新增函数调用支持
- 改进代理服务器性能
- 优化 UI 界面

### v1.1.2
- 新增 Qwen AI (Global) 支持
- 改进 OAuth 认证流程
- 修复稳定性问题

### v1.1.1
- 新增系统托盘集成
- 改进日志系统
- 修复 minor bug

### v1.1.0
- 初始版本发布
- 支持多个 AI 提供商
- 提供 OpenAI 兼容 API
- 实现基本的代理功能
