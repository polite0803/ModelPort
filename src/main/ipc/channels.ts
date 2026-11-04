export const IpcChannels = {
  PROXY_START: 'proxy:start',
  PROXY_STOP: 'proxy:stop',
  PROXY_GET_STATUS: 'proxy:getStatus',
  PROXY_STATUS_CHANGED: 'proxy:statusChanged',
  PROXY_GET_STATISTICS: 'proxy:getStatistics',
  PROXY_RESET_STATISTICS: 'proxy:resetStatistics',

  // Extra TLS listener (Claude Desktop's gateway refuses plain HTTP). Status is
  // read-only; installing the generated certificate into the OS trust store is
  // always a user click, never a silent startup action. `uninstall-trust` is the
  // inverse and is equally click-only - it removes the cert, not the file.
  TLS_STATUS: 'tls:status',
  TLS_INSTALL_TRUST: 'tls:install-trust',
  TLS_UNINSTALL_TRUST: 'tls:uninstall-trust',

  CONFIG_GET: 'config:get',
  CONFIG_UPDATE: 'config:update',
  CONFIG_CHANGED: 'config:changed',

  // 多路由 CRUD（R2）。返回 `{ok:true,…} | {ok:false,error:{code,message}}`，
  // 与 channels:* 系列同风格：错误必须原样到达 UI，不许在 IPC 层变成 undefined。
  // `config:update` 依旧能整表写 routes，但那条通道不做名字校验。
  ROUTES_LIST: 'routes:list',
  ROUTES_CREATE: 'routes:create',
  ROUTES_UPDATE: 'routes:update',
  ROUTES_DELETE: 'routes:delete',
  // 候选池预览：按路由配置跑一遍采集/策略/手动增删，返回逐模型状态与筛除原因。
  // 只读，不写任何状态（不扣冷却、不请求上游）。
  ROUTES_PREVIEW: 'routes:preview',
  // 逐路由的候选模型数（一次采集折全表，比逐条 preview 便宜一个量级）。只读。
  ROUTES_POOL_SIZES: 'routes:pool-sizes',

  // Anthropic 客户端（Claude Desktop / Claude Code）的可发现名：一条只读预览、一条落库。
  // 分两条是因为客户端那一侧的白名单会筛名字，用户必须先看一眼「会新增哪几条」再写。
  ANTHROPIC_DISCOVERY_PLAN: 'anthropic:discovery-plan',
  ANTHROPIC_DISCOVERY_APPLY: 'anthropic:discovery-apply',

  STORE_GET: 'store:get',
  STORE_SET: 'store:set',
  STORE_DELETE: 'store:delete',
  STORE_CLEAR_ALL: 'store:clearAll',
  STORE_INIT_ERROR: 'store:initError',
  STORE_RETRY_INIT: 'store:retryInit',

  // 完整备份（全部数据与配置）。与 `providers:export`（单个自定义供应商）以及渲染层
  // localStorage 的「界面偏好导出」是三件事：这条通道搬的是 providers / accounts（含
  // 解密后的凭据）/ config / 路由 / 模型标注 / 渠道登录态。
  // `backup:pick` 把文件读进主进程并返回一次性 token，`backup:apply` 只认 token ——
  // 渲染层没有构造一份「备份」直接改账号表的能力。
  BACKUP_EXPORT: 'backup:export',
  BACKUP_PICK: 'backup:pick',
  BACKUP_UNLOCK: 'backup:unlock',
  BACKUP_APPLY: 'backup:apply',
  BACKUP_CANCEL: 'backup:cancel',
  BACKUP_RESTART: 'backup:restart',

  PROVIDERS_GET_ALL: 'providers:getAll',
  PROVIDERS_GET_BUILTIN: 'providers:getBuiltin',
  PROVIDERS_ADD: 'providers:add',
  PROVIDERS_UPDATE: 'providers:update',
  PROVIDERS_DELETE: 'providers:delete',
  PROVIDERS_CHECK_STATUS: 'providers:checkStatus',
  PROVIDERS_CHECK_ALL_STATUS: 'providers:checkAllStatus',
  PROVIDERS_DUPLICATE: 'providers:duplicate',
  PROVIDERS_EXPORT: 'providers:export',
  PROVIDERS_IMPORT: 'providers:import',
  PROVIDERS_UPDATE_MODELS: 'providers:updateModels',
  PROVIDERS_GET_EFFECTIVE_MODELS: 'providers:getEffectiveModels',
  PROVIDERS_GET_MODEL_CATALOGUE: 'providers:getModelCatalogue',
  PROVIDERS_SET_MODELS_SERVED: 'providers:setModelsServed',
  PROVIDERS_ADD_CUSTOM_MODEL: 'providers:addCustomModel',
  PROVIDERS_REMOVE_MODEL: 'providers:removeModel',
  PROVIDERS_RESET_MODELS: 'providers:resetModels',
  // 手工能力标注（vision/tools/reasoning/context/...），优先级高于所有自动标注
  PROVIDERS_GET_MODEL_MARKS: 'providers:getModelMarks',
  PROVIDERS_SET_MODEL_MARK: 'providers:setModelMark',
  // 元数据解析报表（覆盖率 + 待标注队列）与手动探测（打开页面不发起请求）
  PROVIDERS_GET_MODEL_METADATA: 'providers:getModelMetadata',
  PROVIDERS_PROBE_MODEL: 'providers:probeModel',
  PROVIDERS_CANCEL_PROBE: 'providers:cancelProbe',
  PROVIDERS_GET_PROBE_JOBS: 'providers:getProbeJobs',
  /** 主进程 → 界面的进度事件（单向推送，不是 invoke）。 */
  PROVIDERS_PROBE_PROGRESS: 'providers:probeProgress',
  // 标准模型库：读取快照只读磁盘；刷新必须由用户显式触发（无定时、无开页自动抓取）
  PROVIDERS_GET_CATALOG_STATUSES: 'providers:getCatalogStatuses',
  PROVIDERS_REFRESH_CATALOG: 'providers:refreshCatalog',
  PROVIDERS_GET_CATALOG_CANDIDATES: 'providers:getCatalogCandidates',
  PROVIDERS_ADOPT_CATALOG_FIELD: 'providers:adoptCatalogField',
  PROVIDERS_REVOKE_CATALOG_ADOPTION: 'providers:revokeCatalogAdoption',
  // 全部补齐：主进程持有任务，界面只订阅进度
  PROVIDERS_ESTIMATE_CATALOG_BATCH: 'providers:estimateCatalogBatch',
  PROVIDERS_START_CATALOG_BATCH: 'providers:startCatalogBatch',
  PROVIDERS_PAUSE_CATALOG_BATCH: 'providers:pauseCatalogBatch',
  PROVIDERS_RESUME_CATALOG_BATCH: 'providers:resumeCatalogBatch',
  PROVIDERS_CANCEL_CATALOG_BATCH: 'providers:cancelCatalogBatch',
  PROVIDERS_GET_CATALOG_BATCH_JOBS: 'providers:getCatalogBatchJobs',
  PROVIDERS_CATALOG_BATCH_PROGRESS: 'providers:catalogBatchProgress',

  AGGREGATE_LIST: 'aggregate:list',
  AGGREGATE_DETAIL: 'aggregate:detail',
  AGGREGATE_SAVE: 'aggregate:save',
  AGGREGATE_SET_ENABLED: 'aggregate:setEnabled',
  AGGREGATE_REMOVE: 'aggregate:remove',
  AGGREGATE_TEST: 'aggregate:test',
  AGGREGATE_SYNC_MODELS: 'aggregate:syncModels',
  AGGREGATE_ADD_KEY: 'aggregate:addKey',
  AGGREGATE_REMOVE_KEY: 'aggregate:removeKey',
  AGGREGATE_SET_KEY_ENABLED: 'aggregate:setKeyEnabled',
  AGGREGATE_VALIDATE_KEY: 'aggregate:validateKey',
  AGGREGATE_ADD_MODEL: 'aggregate:addModel',
  AGGREGATE_REMOVE_MODEL: 'aggregate:removeModel',
  AGGREGATE_SET_MODEL_ENABLED: 'aggregate:setModelEnabled',
  AGGREGATE_SET_MODEL_PARAMS: 'aggregate:setModelParams',
  AGGREGATE_TEST_MODEL: 'aggregate:testModel',
  // 用户在详情页点一次才发一次：没有周期轮询，也没有开页自动查。
  AGGREGATE_QUERY_CREDITS: 'aggregate:queryCredits',

  CHANNELS_LIST: 'channels:list',
  CHANNELS_ACCOUNT_COUNTS: 'channels:accountCounts',
  CHANNELS_RPC: 'channels:rpc',
  CHANNELS_CREDITS: 'channels:credits',
  CHANNELS_SET_ENABLED: 'channels:setEnabled',
  CHANNELS_REMOVE: 'channels:remove',
  CHANNELS_AUTO_CHECKIN: 'channels:autoCheckin',
  CHANNELS_MODELS: 'channels:models',
  CHANNELS_REFRESH_MODELS: 'channels:refreshModels',
  CHANNELS_SET_MODEL_DISABLED: 'channels:setModelDisabled',
  CHANNELS_CLEAR_DEAD_MODELS: 'channels:clearDeadModels',
  CHANNELS_CHANGED: 'channels:changed',

  ACCOUNTS_GET_ALL: 'accounts:getAll',
  ACCOUNTS_GET_BY_ID: 'accounts:getById',
  ACCOUNTS_GET_BY_PROVIDER: 'accounts:getByProvider',
  ACCOUNTS_ADD: 'accounts:add',
  ACCOUNTS_UPDATE: 'accounts:update',
  ACCOUNTS_DELETE: 'accounts:delete',
  ACCOUNTS_VALIDATE: 'accounts:validate',
  ACCOUNTS_VALIDATE_TOKEN: 'accounts:validateToken',

  OAUTH_START_LOGIN: 'oauth:startLogin',
  OAUTH_CANCEL_LOGIN: 'oauth:cancelLogin',
  OAUTH_CALLBACK: 'oauth:callback',
  OAUTH_LOGIN_WITH_TOKEN: 'oauth:loginWithToken',
  OAUTH_VALIDATE_TOKEN: 'oauth:validateToken',
  OAUTH_REFRESH_TOKEN: 'oauth:refreshToken',
  OAUTH_GET_STATUS: 'oauth:getStatus',
  OAUTH_PROGRESS: 'oauth:progress',

  LOGS_GET: 'logs:get',
  LOGS_GET_STATS: 'logs:getStats',
  LOGS_GET_TREND: 'logs:getTrend',
  LOGS_GET_ACCOUNT_TREND: 'logs:getAccountTrend',
  LOGS_CLEAR: 'logs:clear',
  LOGS_EXPORT: 'logs:export',
  LOGS_GET_BY_ID: 'logs:getById',

  REQUEST_LOGS_GET: 'requestLogs:get',
  REQUEST_LOGS_GET_BY_ID: 'requestLogs:getById',
  REQUEST_LOGS_GET_STATS: 'requestLogs:getStats',
  REQUEST_LOGS_CLEAR: 'requestLogs:clear',
  REQUEST_LOGS_BUNDLE: 'requestLogs:bundle',
  REQUEST_LOGS_BUNDLE_SAVE: 'requestLogs:bundleSave',
  /** Main -> renderer: one already-persisted row, so the log list need not poll. */
  REQUEST_LOGS_NEW: 'requestLogs:new',

  STATISTICS_GET: 'statistics:get',
  STATISTICS_GET_TODAY: 'statistics:getToday',
  STATISTICS_GET_TOKEN_USAGE: 'statistics:getTokenUsage',
  STATISTICS_GET_TOKEN_USAGE_HISTORY: 'statistics:getTokenUsageHistory',
  STATISTICS_GET_TOKEN_USAGE_DAYS: 'statistics:getTokenUsageDays',

  APP_GET_VERSION: 'app:getVersion',
  APP_CHECK_UPDATE: 'app:checkUpdate',
  APP_DOWNLOAD_UPDATE: 'app:downloadUpdate',
  APP_INSTALL_UPDATE: 'app:installUpdate',
  APP_UPDATE_CHECKING: 'app:updateChecking',
  APP_UPDATE_AVAILABLE: 'app:updateAvailable',
  APP_UPDATE_NOT_AVAILABLE: 'app:updateNotAvailable',
  APP_UPDATE_PROGRESS: 'app:updateProgress',
  APP_UPDATE_DOWNLOADED: 'app:updateDownloaded',
  APP_UPDATE_ERROR: 'app:updateError',
  APP_GET_UPDATE_STATUS: 'app:getUpdateStatus',
  APP_MINIMIZE: 'app:minimize',
  APP_MAXIMIZE: 'app:maximize',
  APP_CLOSE: 'app:close',
  APP_SHOW_WINDOW: 'app:showWindow',
  APP_HIDE_WINDOW: 'app:hideWindow',
  APP_SET_TITLE_BAR_THEME: 'app:setTitleBarTheme',
  APP_OPEN_EXTERNAL: 'app:openExternal',

  SESSION_GET_CONFIG: 'session:getConfig',
  SESSION_UPDATE_CONFIG: 'session:updateConfig',
  SESSION_GET_ALL: 'session:getAll',
  SESSION_GET_ACTIVE: 'session:getActive',
  SESSION_GET_BY_ID: 'session:getById',
  SESSION_GET_BY_ACCOUNT: 'session:getByAccount',
  SESSION_GET_BY_PROVIDER: 'session:getByProvider',
  SESSION_DELETE: 'session:delete',
  SESSION_CLEAR_ALL: 'session:clearAll',
  SESSION_CLEAN_EXPIRED: 'session:cleanExpired',

  MANAGEMENT_API_GET_CONFIG: 'managementApi:getConfig',
  MANAGEMENT_API_UPDATE_CONFIG: 'managementApi:updateConfig',
  MANAGEMENT_API_GENERATE_SECRET: 'managementApi:generateSecret',

  CONTEXT_MANAGEMENT_GET_CONFIG: 'contextManagement:getConfig',
  CONTEXT_MANAGEMENT_UPDATE_CONFIG: 'contextManagement:updateConfig',

  // 供应商模型清单定时刷新：状态只读（lastRun/nextRun/开关），配置走 config:update，
  // 立即刷新一把走 triggerNow。与 AGGREGATE_QUERY_CREDITS 同款"手动触发才发一次"纪律。
  MODEL_REFRESH_GET_STATUS: 'modelRefresh:getStatus',
  MODEL_REFRESH_TRIGGER_NOW: 'modelRefresh:triggerNow',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
