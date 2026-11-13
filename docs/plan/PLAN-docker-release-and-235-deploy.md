# PLAN：Docker 发布形态 + 部署到 192.168.0.235

> 状态：已批（2026-11-14），A/B/C 已执行 ｜ 执行宿主：SSH → WSL（构建/git），Windows → 235（部署 SSH）

## 一、本轮实测事实

| 项 | 读数 |
| --- | --- |
| 235 SSH | `192.168.0.235:10000`，user `13397183711`，Windows `~/.ssh/nas_key` 可登录（known_hosts 有记录，config 无显式条目） |
| 235 docker | 28.0.4，用户在 docker 组；data-root 在 `/data_8CKVAT3E/...`（11T 盘，2.1T 可用）；registry-mirrors 已配（qiniu/ustc/1panel.live 等）；`systemctl is-enabled docker` = enabled |
| 235 端口 | **127.0.0.1:8080 已被占用**（loopback 服务），8443 空闲 ⇒ 宿主 HTTP 映射用 18080 |
| 235 硬件 | x86_64，24G 内存；根分区仅 851M 但 docker 不在根分区 |
| WSL | **无 docker** ⇒ 镜像在 235 上构建（顺带验证随仓库发布的 Dockerfile）；CI ubuntu runner 有 docker |
| 数据目录 | `store.ts:286` `join(homedir(), '.modelport')`，无 env 覆盖 ⇒ 容器 `HOME=/data` + `VOLUME /data`，tls/ccr/logs 全跟随 |
| 版本基线 | `.nvmrc` = 24；v1.8.12 tag 已存在；HEAD 有未推送 `65d33fc`；工作区有并行会话的 comate 未提交改动（**不碰、不提交**） |
| 发布流水线 | `release.yml`：gate → prepare → 平台矩阵 → verify；verify 只核控制台消费的资产；daemon tarball 在 ubuntu 行构建上传 |
| 部署指南 | `src/shell/deployGuide.ts`（远程行 HTML：资产链接 + systemd 命令），测试 `tests/shell/deploy-guide.test.ts` |

## 二、阶段 A —— 仓库：Docker 发布形态

- **A1 `docker/Dockerfile`**：`FROM node:24-slim`（与 .nvmrc 同基线）；构建上下文 = `build:daemon` 的 staged 树；
  COPY bundle/resources/renderer；`ENV HOME=/data MODELPORT_RESOURCE_ROOT=/app/resources MODELPORT_WEB_ROOT=/app/renderer`；
  `USER node` + `VOLUME /data`（命名卷继承镜像目录属主）；`EXPOSE 8080 8443`；
  `ENTRYPOINT ["node","/app/modelport-daemon.cjs"]`（参数透传，`--init-host` 可一次性跑）。
- **A2 `scripts/build-docker.mjs` + `npm run build:docker`**：消费 `dist/daemon-stage/modelport-daemon-<ver>/`；
  `docker build` → `docker save | gzip` → `dist/modelport-daemon-<ver>-docker-<arch>.tar.gz` + 同名 `.sha256`
  （arch 口径与 build-daemon 一致：`DAEMON_ARCH || process.arch`）；无 docker 时清晰报错（WSL 构建不了镜像，CI/有 docker 的主机构建）。
- **A3 `release.yml`**：ubuntu 矩阵行在 daemon tarball 之后加「构建并上传 Docker 镜像」步骤（上传 3 次重试，同既有模式）；
  verify 必查清单加 `modelport-daemon-<ver>-docker-{x64,arm64}.tar.gz`（含 .sha256）。
- **A4 `src/shell/deployGuide.ts`**：远程「部署指南」加 Docker 小节（docker 资产链接 + 校验 + load/init/run 命令，
  与 systemd 并列）；扩 `tests/shell/deploy-guide.test.ts`。
- **A5 文档同步**：`docs/features/wsl-daemon.md` 形态表加 Docker 行 + 「Docker 部署」节（含升级=load 新镜像重建容器、卷保留）；
  `README.md` 两处产物表 + 构建命令；`docs/AGENTS-full.md` 产物段落。
- **A6 边界**：控制台不做 docker 自动安装/升级（与远程形态同档，手动）；更新检查消费的资产清单不变。

## 三、阶段 B —— 门禁与镜像构建

- **B1** A 完成后经 SSH 跑一次 `npm run gate`（同时产出 dist tarball 与 staged 树）。
  红若落在 comate 文件（并行会话）⇒ 按共享树规则报告等待，不改他人代码。
- **B2** 双 ssh 管道把 staged 树 + Dockerfile 传到 235（`ssh wsl tar … | ssh 235 tar …`）；
  235 上 `docker build`（node:24-slim 走已配镜像源）。

## 四、阶段 C —— 235 部署

- **C1** `docker volume create modelport-data`；一次性 `docker run --rm -v … <image> --init-host --port 8080`，
  捕获 `MODELPORT_HANDSHAKE`（API Key + 管理口令）。
- **C2** `docker run -d --name modelport --restart unless-stopped -p 18080:8080 -p 8443:8443 -v modelport-data:/data <image>`。
- **C3** 探活三层：235 本地 `curl /health`；Windows `curl.exe --noproxy '*' http://192.168.0.235:18080/health`；
  带 Key 请求 `/v1/models`。
- **C4** 回报 handshake 供控制台「添加网关」（远程形态，地址 `http://192.168.0.235:18080`）；
  HTTPS 8443 自签证书，信任流程同 `docs/features/https-certificate-trust.md`。

## 五、拍板项（默认值如下，整批批准或按编号点）

- **D1** 基础镜像 `node:24-slim`；资产 = docker save 的 tar.gz + .sha256 进 GitHub Release，**不推 registry**（无凭据/付费依赖）。
- **D2** 235 宿主端口 **18080**(HTTP)/8443(HTTPS)（8080 被占）；容器名 `modelport`；卷 `modelport-data`。
- **D3** gate 绿后把 A 批**单独提交一个 commit**（不碰 comate 改动）；**默认不打 tag/不发布**，发布另行指示（若发则 1.8.13）。
- **D4** verify 必查清单纳入 docker 资产（D1 的连带面）。

## 六、验收与回退

- 验收：gate 全绿；235 容器 running 且 Windows 侧 /health、/v1/models 可达；指南/文档/README 三处同步。
- 回退：`docker stop modelport && docker rm modelport`（**卷保留**，数据不丢）；仓库侧单 commit 可 revert。

## 七、执行记录（2026-11-14）

- gate：2529/2529 通过，EXIT=0（首跑红在新增测试断言过宽：`docker load` 命中「注意」段的升级说明，
  收窄为 `docker load -i` 后复跑全绿）。
- 235 两个环境坑：HOME=/home/ 不可写（docker CLI 与构建上下文改走 /tmp，`HOME=/tmp docker …`）；
  宿主 8080 被占 ⇒ 映射 18080。
- 镜像 `modelport-daemon:1.8.12` 在 235 构建（node:24-slim 走已配镜像源）；容器 `modelport`
  restart=unless-stopped，卷 modelport-data:/data。
- `httpsEnabled` 出厂 false，`--init-host` 不改它 ⇒ 经管理 RPC `config:update` 开启后重启容器，
  8443 才监听（文档「默认值」表已列 httpsPort，此处补记开关事实）。
- 探活（Windows 侧）：HTTP 18080 /health、/v1/models（带 Key）、管理 RPC 带口令 200 / 无口令 401、
  HTTPS 8443 /health 全通。
- 端口对齐（用户反馈「界面仍显示 8080」）：根因是首装用了非恒等映射 `-p 18080:8080`，界面读的是
  网关进程自己的监听端口。经 RPC `config:update proxyPort=18080` + 重建容器 `-p 18080:18080`
  对齐；手册与页内部署指南改教恒等映射（宿主端口被占 ⇒ 监听端口改同一个空闲端口）。
- ConnectGate 中文（用户反馈「这个页面没有中文」）：store 默认语言硬编码 en-US 覆盖浏览器检测 ⇒
  改跟随 `i18n.language`；登录前加 中文/English 切换（只写本地偏好，不碰网关配置）。
- 数据刷新不彻底（用户反馈）：先疑 SSE 登录前 401 死流，235 实测证伪（window 标记排除重载、
  RPC 改配置表单跟新 ⇒ 流活着），headless.ts 该轮改动撤回。真缺陷：proxyStore 的
  CONFIG_CHANGED 镜像订阅在模块顶层，远程页 electronAPI 安装晚于模块求值 ⇒ 订阅被跳过，
  表单等 appConfig 派生面冻结在挂载值。订阅改可重入 subscribeConfigMirror()，main.tsx
  安装后补调。切换特有的残余陈旧面待用户截图定位。