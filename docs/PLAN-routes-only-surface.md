# PLAN：对外面只留路由，启用位只管路由池

- 日期：2026-11-01
- 状态：四条裁定已点完，按阶段 1 → 5 执行
- 基线：main @ e0a7b4d（工作树另有 27 个非本批改动的未提交文件，见第 5 节）
- 范围：`/v1/models` 的广告面、模型启用位的落库与消费路径、路由池候选数的呈现
- 不在本批：路由打分算法本身、额度/限流档、anthropic 入站的解析顺序

## 0. 现状核对（本轮实读）

| 事实 | 位置 |
| --- | --- |
| `/v1/models` 现在拼三段：启用的路由 → 每家启用模型 → 无人认领的用户别名 | `src/main/proxy/routes/models.ts:81-124` |
| 单查 `/v1/models/:model` 同样三段（路由 → 别名 → 目录模型） | `src/main/proxy/routes/models.ts:162-241` |
| 路由候选池只读 `getEffectiveModels()`，即目录的 served 切片 | `src/main/proxy/autoRouter.ts:379` |
| `poolStrategies` 在采集之后过滤；`includeModels` 只能从策略前的候选里取回，**不复活停用模型**，取不到就进 `unresolved` | `src/main/proxy/autoRouting.ts:312-360` |
| 目录行（builtin/custom/fetched 三种来源）逐个开关，落 `excludedModels` | `src/renderer/src/components/models/ModelList.tsx:186`、`store.ts:2263` |
| **别名行没有开关**（`served` 硬编码 true，`source` 为 undefined ⇒ 不渲染 Switch） | `src/renderer/src/components/models/ModelList.tsx:441-457` |
| `ModelMapping` 声明两处（shared 与 store），且没有任何启用位 | `src/shared/types.ts:534`、`src/main/store/types.ts:257` |
| 别名的消费点共四处：`modelMapper` 五条读路径、`loadbalancer.providerSupportsModel/mapModel`、`messages.gatewayKnowsModel`、`/v1/models` | `src/main/proxy/modelMapper.ts:18-120`、`loadbalancer.ts:249,295`、`routes/messages.ts:57` |
| 聚合/渠道同步重建**自己名下**的映射时整条替换对象 | `src/main/providers/aggregate/manager.ts:763-773` |

## 1. 四条裁定（2026-11-01 用户点选）

| # | 裁定 | 依据 / 代价 / 回退 |
| --- | --- | --- |
| R1 | 请求里 `model` 直接填单模型名**照旧接**，但**必须该模型处于启用态** | 依据：具名路径今天已经用 `isModelRoutable` 卡 served，这一段行为不动。代价：客户端要手填名字，`/v1/models` 不再替它列出来。回退：把两段拼装加回来即可，无落库变更 |
| R2 | `/v1/models` 与 `/v1/models/:model` **只剩启用中的路由**，别名与单模型一律不再广告、不再可查 | 依据：用户要「清单里能看到的才是一条能用的名字」。代价：`aliasMappingKeys` 与 `contextWindowOf` 失去唯一生产调用者 ⇒ 一并退役；`modelport-provider-model-matrix` skill 的「以 `/v1/models` 为模型源」从此只拿到路由名，矩阵按路由跑。回退：恢复两段循环，两者未被别处消费，无迁移 |
| R3 | **别名行也给独立开关**，停用后该别名既不能被点名、也不被 anthropic 入口认识 | 落库位置：`ModelMapping.disabled?: boolean`（缺席即在用，老配置零迁移）。代价：同步重建自己名下映射时会抹掉这个键，但那批名字同时也在目录里、由 `excludedModels` 管，界面不会把它们当别名行展示。回退：删掉键，读侧全部按 `!== true` 判定，不留脏数据 |
| R4 | 界面文案跟上新语义：启用位 = **进不进路由候选池**，路由卡片显示候选数并对空池给警示 | 依据：池空的路由照旧被广告（它是用户启用着的路由），若界面一切正常就是拿缺席伪装成结果。代价：两 locale 的既有键要改写。回退：文案改动不影响行为 |

## 2. 阶段

1. `/v1/models` 列表与单查收窄为「只有启用的路由」，退役 `providerCatalogueNames` / `aliasMappingKeys` / `contextWindowOf` / 死导入
2. `ModelMapping.disabled` 两处声明 + 四个消费点 + 映射页与模型页的开关
3. `autoRouter.routePoolSizes()` + `routes:poolSizes` IPC（channels/handler/preload/类型）+ 路由卡片候选数与空池警示
4. 文案（zh-CN、en-US）+ `docs/AGENTS-full.md` 契约段 + 本文件
5. 判据更新（`proxy-routes-request`、`models-context-window`、`model-serving`、anthropic 与别名新增用例）+ 收尾一次 `npm run gate`

## 3. 不动的东西

- `getEffectiveModels()` 仍是「目录的 served 切片」这一唯一真值源；路由池、具名请求放行、能力下界都继续读它。
- 路由名优先于同名模型的解析顺序、`conflicts_model` 校验、停用路由的 `route_disabled` 404 全部不变。
- 停用行灰显留在列表里（2026-10-29 裁定）不变。

## 4. 已知代价（要在交付说明里复述）

- anthropic 客户端（Claude Desktop / Claude Code）的模型发现只认它自己那张名字表，所以 `anthropicInbound.modelMap` 的**目标今后必须填路由名**；填单模型名时那一行不再出现在清单里。
- `GET /v1/models` 条目数从「几百」变成「路由数」，客户端的模型下拉会显著变短——这是本次要求，不是回归。

## 5. 现场约束

工作树带着 27 个非本批的未提交改动，其中 `src/main/proxy/routes/models.ts`、`src/main/store/types.ts`、两个 locale、`AGENTS.md`、`docs/AGENTS-full.md` 与本批真重叠 ⇒ 本批**只改不提交**，等那批落地后统一切分归属。

## 6. 执行记录（本轮落地）

| 阶段 | 改了什么 | 读数 |
| --- | --- | --- |
| 1 | `routes/models.ts` 的两段拼装（每家启用模型 / 用户别名）与 `providerCatalogueNames` 删除，列表改为 `enabledRoutes.map(routeEntry)`；单查只认路由 | `tests/routes/proxy-routes-request`、`route-context-floor`、`tests/routes/anthropic-inbound` 全绿 |
| 1 | 退役 `aliasMappingKeys`、`contextWindowOf`（收窄后生产侧零调用者）+ `models.ts` 里两条本来就没人用的导入 | `tests/proxy/models-context-window.test.ts` 收窄到路由下界那一半；`tests/store/model-serving.test.ts` 去掉两条映射用例 |
| 2 | `ModelMapping.disabled`（两处声明）＋唯一判据 `modelServing.ts::isMappingActive`，接进 `modelMapper`（直接名/通配名/`getActualModel`/`getPreferredProvider`/`getPreferredAccountId` 五条读路径）、`loadbalancer.mapModel`、`isModelRoutable` 的 mapping 入参、`messages.gatewayKnowsModel`；管理 API 的 POST/PUT 与模型映射页的编辑草稿都保住这个位 | `tests/store/model-serving.test.ts` 新增「停别名不牵连同名目录行」；`proxy-routes-request` 新增 R3 端到端（停用→503、清单与单查都不认、重新启用→500） |
| 2 | 模型页别名行给独立开关：写走 `config.update({modelMappings})`（现读整表再改这几行），「仅启用选中」的作用域从此含别名 | 两个 tsc 程序 0 错误 |
| 3 | `autoRouter.routePoolSizes(routes)`（与广告下界共用 `keptOfPool` 一次折叠，按（供应商,模型）去重）＋新通道 `routes:pool-sizes`（channels/handlers/preload/`electron.d.ts`/`modelRouteName.ts` 的 `RoutePoolSizesResult`） | `route-context-floor` 新增候选数用例（含第二个账号不翻倍、停用即掉数、include 不复活停用模型） |
| 3 | 路由卡片三态各占一句：读不到 / 池是空的（destructive + 说明它仍被广告但请求必 503）/ 池里有 N 个 | 两 locale 键集 parity 0/0，占位符一致 |
| 4 | 模型页 7 条文案改到「路由池」口径；`AGENTS.md` 增一条不变量；`docs/AGENTS-full.md` 的 `/v1/models` 契约段重写并拆出 `context_window` 那一条 | 本文件 |

### 代价（要复述给用户的）

- `anthropicInbound.modelMap` 的**目标今后必须填路由名**：Claude Desktop / Claude Code 逐行按自己的名字表筛，映射指向单模型时那一行不再发出。已把 `tests/routes/anthropic-inbound.test.ts` 的夹具改成指向 `auto`，对照值现取（同一条路由在 OpenAI 形状里广告的窗口），没有写死数字。
- `GET /v1/models` 的条目数从几百降到路由数；`skills/modelport-provider-model-matrix` 以 `/v1/models` 为模型源，从此按路由跑矩阵（这是收窄的直接后果，脚本本身没改）。
- 别名停用位落在映射表自身，而聚合/渠道同步重建**自己名下**的映射时是整条替换：那批名字同时也在目录里、由 `excludedModels` 管，界面不会当别名行展示，所以抹不掉用户看得见的停用位。

### 未闭环

- 新通道 `routes:pool-sizes` 不参与热更新 ⇒ 必须整启 `npm run dev` 才看得到候选数；用户在热更新状态下看到「候选数读不到」不是缺陷。
- UI 三态与别名开关只由 `tsc` + locale parity + 判据测试证明，**没有实机点过**（本仓无法在无头环境起 Electron）。

## 7. R2 与「Claude 可发现别名」相撞（等拍板，本批未动）

同一工作树里另一路在做的 Anthropic 发现流程（`store/anthropicAliases.ts` + `AnthropicInboundSettings.tsx`，未提交）会给每个真 Claude 模型写一条 `claude-*` **别名**，让 Claude Desktop 能从清单里选中它。R2 落地后清单只有路由 ⇒ 那条别名**发得出但列不到**（`gatewayKnowsModel` 认它，`/v1/models` 不广告它）。对方已把这条判据写成 `todo`（`tests/routes/anthropic-inbound.test.ts:420-432`），并注明缺的是「按模型名钉池」的能力。

两个解法，都不在本批范围：

| 选项 | 做法 | 代价 |
| --- | --- | --- |
| A（推荐） | 给 `ModelRoute` 加白名单式的钉池（如 `pinnedModels: RouteModelRef[]`，与 `poolStrategies` 之后、`includeModels` 同一层折叠），发现流程改为**建一条钉死那一家模型的路由** | 第五处逐路由字段：两处类型声明、写入校验、`keptOfPool` 折叠、路由 UI、迁移与既有判据都要跟上。好处是名字域仍然只有路由，且「清单写的名字」等于「实际跑的模型」 |
| B | anthropic 那一支额外列出「启用中的别名行」（OpenAI 形状仍只发路由） | 与 R2 的字面口径冲突，等于让用户改口；且同一张清单出现两类条目，客户端按 `owned_by` 分组时会分叉 |

在 A 或 B 定下来之前，那条 `todo` 不许删——它是这个缺口唯一的可见证据。

### 7.1 收口（2026-11-02，用户点「A」，本批落地）

拍板为 A，已实现，`todo` 转成了正式判据（`tests/routes/anthropic-inbound.test.ts`：名字出现在
anthropic 清单里 + 请求按 `as-requested` 命中 + 上游收到 Anthropic 的写法）。两处与本节草案不同，都是有意的：

- **字段名取 `pinModels`**，不是草案里的 `pinnedModels`：与同一结构里的 `includeModels` /
  `excludeModels` 同词表，引用形状也直接复用 `RouteModelRef`，于是归一化（`normalizeRouteModelRefs`）、
  写入校验（`checkRouteModelRefs`）与预览的 `unresolved` 三套机制原样接管，不出现第二份「按名字匹配」的方言。
- **折叠顺序是 pin 在池策略之前**，不是草案说的「与 `includeModels` 同一层（之后）」：放在之后会让
  `includeModels` 从策略前的全候选里把池外模型捞回来，钉定当场被绕开——那正是这条能力要防的事。
  现在 `applyManualModelSelection` 的 `allCandidates` 收到的是钉定后的基底，include 只能捞回池内模型。

实现位置：`shared/types.ts::ModelRoute.pinModels`、`main/proxy/autoRouting.ts::applyModelNamePin`（规则只此一份）、
`main/proxy/autoRouter.ts` 三处消费（广告下界 / 选路 / 预览）、`main/store/modelRoutes.ts` 归一与写校验、
`main/store/store.ts::checkRouteFieldWrites`、路由编辑器行内钉定动作与「未钉定」状态、en/zh 标签。
判据里有一条静态检查钉住「三处消费都必须折到」，少折一处即红。空数组 = 不钉 = 全目录，
既有路由逐字不变（另有回归判据）。

发现流程因此从「写别名」改为「建路由」：`shared/anthropicDiscovery.ts` + `main/store/anthropicRoutes.ts`
+ 设置页那张卡片的「生成路由」。别名那条链不再进清单（R2 的口径），但仍是含点号 id 的唯一通路——
`anthropicInbound.modelMap` 的键会在 anthropic 形状里排在最前，前提是它的目标是一条路由。
