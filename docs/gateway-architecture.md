# Gateway 模块架构文档

## 目录

1. [模块概述](#1-模块概述)
2. [模块结构](#2-模块结构)
3. [请求处理流程](#3-请求处理流程)
4. [控制器与路由](#4-控制器与路由)
5. [服务层](#5-服务层)
6. [进程管理](#6-进程管理)
7. [代理与流式传输](#7-代理与流式传输)
8. [Hook 机制](#8-hook-机制)
9. [过滤器链](#9-过滤器链)
10. [配置体系](#10-配置体系)
11. [构建与部署](#11-构建与部署)

---

## 1. 模块概述

Gateway 是 Ops Factory 平台的核心枢纽，负责请求路由、用户认证与鉴权、多用户进程隔离管理、HTTP/SSE 代理转发等功能。

**技术栈：**

| 项目 | 技术选型 |
|------|---------|
| 语言 | Java 21 |
| 框架 | Spring Boot 2.7.18 (WebFlux) |
| 响应式 | Project Reactor (Mono / Flux) |
| 构建 | Maven 多模块 |
| 日志 | Log4j2 (排除默认 Logback) |
| 测试 | JUnit 4 + Mockito + Spring Boot Test |

**设计特点：**

- **全异步非阻塞**：基于 WebFlux 的响应式编程模型，所有 I/O 操作返回 `Mono<T>` 或 `Flux<T>`
- **多模块 Maven**：`gateway-common`（共享模型/工具）+ `gateway-service`（主应用），职责清晰
- **进程级多用户隔离**：每个 (agentId, userId) 组合独立一个 goosed 进程，互不干扰
- **零拷贝 SSE 中继**：`SseRelayService` 直接转发 `DataBuffer`，不解析/缓冲 SSE 内容

---

## 2. 模块结构

### 2.1 Maven 多模块布局

```
gateway/
├── pom.xml                          # 父 POM (ops-gateway-parent)
├── config.yaml                      # 网关运行时配置
├── config.yaml.example              # 配置模板
├── scripts/
│   └── ctl.sh                       # 服务控制脚本
├── agents/                          # Agent 配置目录
│   ├── universal-agent/
│   ├── kb-agent/
│   └── ...
├── users/                           # 用户运行时目录（自动生成）
│
├── gateway-common/                  # 子模块：共享库
│   ├── pom.xml
│   └── src/main/java/com/huawei/opsfactory/gateway/common/
│       ├── constants/
│       │   └── GatewayConstants.java
│       ├── model/
│       │   ├── ManagedInstance.java
│       │   ├── AgentRegistryEntry.java
│       │   └── UserRole.java
│       └── util/
│           ├── PathSanitizer.java
│           ├── ProcessUtil.java
│           └── YamlLoader.java
│
└── gateway-service/                 # 子模块：主应用
    ├── pom.xml
    └── src/main/java/com/huawei/opsfactory/gateway/
        ├── GatewayApplication.java  # Spring Boot 启动类
        ├── config/                  # 配置与全局处理
        │   ├── GatewayProperties.java
        │   ├── CorsFilter.java
        │   ├── WebFluxConfig.java
        │   ├── SchedulingConfig.java
        │   └── GlobalExceptionHandler.java
        ├── controller/              # 控制器层
        │   ├── AgentController.java
        │   ├── SessionController.java
        │   ├── ReplyController.java
        │   ├── FileController.java
        │   ├── StatusController.java
        │   ├── MonitoringController.java
        │   ├── McpController.java
        │   └── CatchAllProxyController.java
        ├── filter/                  # WebFilter 过滤器
        │   ├── AuthWebFilter.java
        │   └── UserContextFilter.java
        ├── hook/                    # Reply Hook 管道
        │   ├── HookPipeline.java
        │   ├── HookContext.java
        │   ├── RequestHook.java
        │   ├── BodyLimitHook.java
        │   ├── FileAttachmentHook.java
        │   └── VisionPreprocessHook.java
        ├── service/                 # 业务服务
        │   ├── AgentConfigService.java
        │   ├── SessionService.java
        │   ├── FileService.java
        │   └── LangfuseService.java
        ├── process/                 # 进程管理
        │   ├── InstanceManager.java
        │   ├── IdleReaper.java
        │   ├── PrewarmService.java
        │   ├── PortAllocator.java
        │   └── RuntimePreparer.java
        └── proxy/                   # 代理层
            ├── GoosedProxy.java
            └── SseRelayService.java
```

### 2.2 gateway-common 模块

提供跨模块共享的常量、模型和工具类，无 Spring 依赖：

| 类 | 职责 |
|----|------|
| `GatewayConstants` | Header 名、默认用户名 (`sys`, `__default__`)、健康检查参数、空闲超时默认值等 |
| `ManagedInstance` | goosed 进程实例模型，含 agentId、userId、port、pid、status、lastActivity |
| `AgentRegistryEntry` | Agent 注册表条目 (record)，含 id、name、sysOnly |
| `UserRole` | 用户角色枚举 (ADMIN / USER)，提供 `fromUserId()` 和 `isAdmin()` |
| `PathSanitizer` | 路径安全校验（防 `..` 穿越）和文件名清理 |
| `ProcessUtil` | 进程操作工具：获取 PID、检查存活、优雅停止（SIGTERM → 等待 → SIGKILL）|
| `YamlLoader` | YAML 文件加载，文件不存在时返回空 Map |

### 2.3 gateway-service 模块

主应用模块，包含全部 Spring Boot 组件。关键依赖：

- `spring-boot-starter-webflux` — 响应式 Web 框架
- `spring-boot-starter-log4j2` — 日志（排除默认 Logback）
- `gateway-common` — 共享模型/工具
- 构建产物：`gateway-service.jar`（Thin JAR）+ `lib/` 依赖目录

---

## 3. 请求处理流程

### 3.1 完整请求链路

```
客户端请求
    │
    ▼
CorsFilter                           # CORS 预检处理
    │
    ▼
AuthWebFilter (@Order=1)             # 认证：验证 x-secret-key
    │ 失败 → 401 Unauthorized
    ▼
UserContextFilter (@Order=2)         # 提取 userId/role，触发预热
    │
    ▼
Controller                           # 路由分发
    │
    ├── AgentController              # /agents, /agents/{id}
    ├── SessionController            # /sessions, /agents/{id}/sessions
    ├── ReplyController              # /agents/{id}/reply (SSE)
    ├── FileController               # /agents/{id}/files
    ├── StatusController             # /status, /me, /config
    ├── MonitoringController         # /monitoring/* (admin)
    ├── McpController                # /agents/{id}/mcp (admin)
    └── CatchAllProxyController      # /agents/{id}/** (兜底)
          │
          ▼
    Service / InstanceManager        # 业务逻辑 + 实例管理
          │
          ▼
    GoosedProxy / SseRelayService    # HTTP 代理 / SSE 中继到 goosed
```

### 3.2 SSE 流式对话链路 (/reply)

```
客户端 POST /agents/{id}/reply
    │
    ▼
ReplyController
    │
    ├── 1. InstanceManager.getOrSpawn()    # 获取/启动 goosed 实例
    │
    ├── 2. HookPipeline.process()          # Hook 预处理
    │      ├── BodyLimitHook               # 请求体大小检查
    │      ├── FileAttachmentHook          # 文件路径安全校验
    │      └── VisionPreprocessHook        # 图片处理 (off/passthrough/preprocess)
    │
    ├── 3. SseRelayService.relay()         # 转发到 goosed /reply
    │
    └── 4. 返回 Flux<DataBuffer>           # 零拷贝 SSE 流式响应
```

---

## 4. 控制器与路由

### 4.1 路由总览

```
Gateway HTTP 路由表
│
├── GET  /status                          → 健康检查 (StatusController)
├── GET  /me                              → 当前用户信息
├── GET  /config                          → 网关配置
│
├── GET  /agents                          → Agent 列表 (AgentController)
├── POST /agents                          → 创建 Agent [admin]
├── DELETE /agents/{id}                   → 删除 Agent [admin]
├── GET  /agents/{id}/skills              → 技能列表 [admin]
├── GET  /agents/{id}/config              → Agent 配置 [admin]
├── PUT  /agents/{id}/config              → 更新 Prompt [admin]
│
├── POST /agents/{id}/reply               → SSE 流式对话 (ReplyController)
├── POST /agents/{id}/agent/reply         → 别名
├── POST /agents/{id}/resume              → 恢复会话
├── POST /agents/{id}/restart             → 重启运行
├── POST /agents/{id}/stop                → 停止运行
├── POST /agents/{id}/agent/start         → 创建会话 (SessionController)
│
├── GET  /sessions                        → 聚合会话列表
├── GET  /sessions/{id}?agentId=X         → 全局会话详情
├── DELETE /sessions/{id}?agentId=X       → 全局会话删除
├── GET  /agents/{id}/sessions            → Agent 会话列表
├── GET  /agents/{id}/sessions/{sid}      → 会话详情
├── DELETE /agents/{id}/sessions/{sid}    → 删除会话
├── PUT  /agents/{id}/sessions/{sid}/name → 重命名会话
│
├── GET  /agents/{id}/files               → 文件列表 (FileController)
├── GET  /agents/{id}/files/**            → 下载文件
├── POST /agents/{id}/files/upload        → 上传文件
│
├── GET  /monitoring/system               → 系统指标 [admin] (MonitoringController)
├── GET  /monitoring/instances            → 活跃实例 [admin]
├── GET  /monitoring/status               → Langfuse 状态 [admin]
├── GET  /monitoring/overview             → 调用概览 [admin]
├── GET  /monitoring/traces               → 追踪列表 [admin]
├── GET  /monitoring/observations         → 观测数据 [admin]
│
├── GET/POST /agents/{id}/mcp            → MCP 扩展 [admin] (McpController)
├── DELETE   /agents/{id}/mcp/{name}     → 删除 MCP 扩展 [admin]
│
└── ANY  /agents/{id}/**                  → 兜底代理 (CatchAllProxyController)
         ├── /system_info, /status        → 用户可访问
         └── 其他路径                      → 仅 admin
```

### 4.2 控制器详解

#### AgentController

管理 Agent 注册表的 CRUD 操作。

- `GET /agents` — 返回所有注册 Agent 列表（含 id、name、sysOnly），从 `config.yaml` 的 `agents[]` 加载
- `POST /agents` — 创建新 Agent，自动生成目录结构和 symlink [admin]
- `DELETE /agents/{id}` — 删除 Agent 并停止所有相关实例 [admin]
- `GET /agents/{id}/skills` — 解析 `skills/` 目录下的 `SKILL.md` frontmatter [admin]
- `GET /agents/{id}/config` — 读取 config.yaml 内容和 AGENTS.md 内容 [admin]
- `PUT /agents/{id}/config` — 更新 AGENTS.md 内容 [admin]

#### SessionController

会话生命周期管理，支持按 Agent 和全局两种路由风格。

- `POST /agents/{id}/agent/start` — 创建新会话，注入 `working_dir` 指向用户运行时目录
- `GET /sessions` — 聚合查询：遍历所有 Agent 的用户实例和 sys 实例，按 `working_dir` 过滤归属会话
- `GET /sessions/{id}?agentId=X` / `GET /agents/{id}/sessions/{sid}` — 获取会话详情，注入 `agentId` 字段
- `DELETE` — 删除会话，清理 `uploads/{sessionId}/` 目录，移除所有者缓存
- `PUT /agents/{id}/sessions/{sid}/name` — 代理到 goosed 的重命名接口

#### ReplyController

SSE 流式对话的核心控制器。

- `POST /agents/{id}/reply` — 运行 HookPipeline 预处理后，通过 SseRelayService 中继 SSE 流
- `/resume`, `/restart`, `/stop` — 直接代理到 goosed 对应端点
- 所有别名路径（`/agent/reply` 等）映射到同一处理逻辑

#### FileController

用户文件的列表、下载和上传。

- `GET /agents/{id}/files` — 递归列出用户运行时目录，跳过 `data/`、`state/`、`config/`、`node_modules/`、`.goose/` 等目录
- `GET /agents/{id}/files/**` — 下载文件，`PathSanitizer.isSafe()` 防止路径穿越
- `POST /agents/{id}/files/upload` — multipart 上传，校验文件扩展名白名单，存储到 `uploads/{sessionId}/`

#### MonitoringController

管理员可观测性仪表盘的后端接口，全部要求 admin 角色。

- `/system` — 系统运行指标（uptime、agent 数量、空闲设置、Langfuse 状态）
- `/instances` — 按 Agent 分组的活跃实例列表
- `/overview`, `/traces`, `/observations` — 代理 LangfuseService 的数据聚合接口，要求 `from` 和 `to` 参数

#### CatchAllProxyController

`@Order(999)` 的兜底控制器，处理所有未被其他控制器匹配的 `/agents/{id}/**` 路径。

- 用户可访问的路径：`/system_info`、`/status`
- 其他路径仅 admin 可访问（代理到 sys 实例）
- Admin 请求使用自身 userId 的实例；用户请求使用自身实例

### 4.3 权限控制矩阵

| 路由类别 | admin | user | 说明 |
|---------|:-----:|:----:|------|
| 聊天 reply/resume/stop | ✅ | ✅ | 核心功能 |
| 会话 CRUD | ✅ | ✅ | 按用户隔离 |
| 文件操作 | ✅ | ✅ | 按用户目录隔离 |
| Agent 列表 | ✅ | ✅ | 只读 |
| Agent 配置/技能 | ✅ | ❌ | 管理功能 |
| Agent 创建/删除 | ✅ | ❌ | 管理功能 |
| MCP 扩展管理 | ✅ | ❌ | 管理功能 |
| 监控 | ✅ | ❌ | 管理功能 |
| 兜底代理 (schedule 等) | ✅ | ❌ | 代理到 sys 实例 |
| 兜底代理 (system_info/status) | ✅ | ✅ | 用户可查 |

---

## 5. 服务层

### 5.1 AgentConfigService

Agent 配置的核心管理服务，负责读取和缓存 Agent 配置。

**关键职责：**

- 启动时从 `config.yaml` 的 `agents[]` 加载 Agent 注册表
- 缓存每个 Agent 的 `config.yaml` 和 `secrets.yaml`，支持 TTL 失效
- 解析 `skills/` 目录下 SKILL.md 文件的 frontmatter 获取技能元数据
- 创建新 Agent：生成目录结构 (`config/`、`config/skills/`)，创建默认 config.yaml 和 AGENTS.md
- 删除 Agent：移除目录，更新 config.yaml 注册表
- 提供路径访问器：`getAgentsDir()`、`getUsersDir()`、`getAgentDir(id)`

### 5.2 SessionService

会话归属的缓存管理。

- 维护 `sessionId → userId` 的内存缓存（`ConcurrentHashMap`）
- `getSessionsFromInstance(port)` — 查询指定 goosed 实例的会话列表
- `injectAgentId(json, agentId)` — 在会话 JSON 中注入 `agentId` 字段
- `removeOwner(sessionId)` — 删除会话时清除缓存

### 5.3 FileService

文件系统操作服务。

- **文件列表** (`listFiles`)：递归遍历用户运行时目录，过滤规则：
  - 跳过目录：`data`、`state`、`config`、`node_modules`、`.goose`、隐藏目录（`.` 开头）
  - 跳过文件：`.DS_Store`、`AGENTS.md`、`.gitkeep`
- **文件解析** (`resolveFile`)：优先尝试直接路径，失败则回退到按文件名搜索（跳过 skip 目录）
- **扩展名校验** (`isAllowedExtension`)：白名单机制，允许代码/文档/图片/压缩包等常见格式，拦截可执行文件（`.exe`、`.bat`、`.dll` 等）
- **MIME 类型检测** + 内联/附件下载策略

### 5.4 LangfuseService

Langfuse 可观测性平台的集成服务。

- `isConfigured()` — 检查 Langfuse 连接参数是否完整
- `checkReachable()` — HTTP 健康检查
- `buildOverview(tracesJson, observationsJson)` — 聚合统计：总调用数、总成本、平均延迟、P95 延迟、错误率、按日分组趋势
- `parseTraces(json)` — 解析 trace 列表，提取 id、name、input、latency、errorMessage 等
- `parseObservations(json)` — 按 name 分组聚合 observation，计算每组的 avgLatency、p95、totalTokens、totalCost
- Basic Auth 认证（publicKey:secretKey）

---

## 6. 进程管理

### 6.1 架构总览

```
                    InstanceManager
                    (核心编排器)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    PortAllocator   RuntimePreparer   PrewarmService
    (端口分配)      (目录准备)        (首次预热)
                                          │
                    IdleReaper ◄──────────┘
                    (空闲回收)        (回收后清除预热状态)
```

### 6.2 InstanceManager

进程生命周期的核心管理器，维护所有 goosed 实例的状态。

**数据结构：**

```
instances: ConcurrentHashMap<"agentId:userId", ManagedInstance>
spawnLocks: ConcurrentHashMap<"agentId:userId", Object>   # 防并发 spawn
```

**关键方法：**

| 方法 | 职责 |
|------|------|
| `getOrSpawn(agentId, userId)` | 获取已有实例或启动新实例（双重检查 + 锁） |
| `doSpawn(agentId, userId)` | 实际启动流程：准备目录 → 分配端口 → 构建环境变量 → spawn 进程 → 健康检查 |
| `buildEnvironment(agentId, userId, port, pathRoot)` | 合并 config.yaml + secrets.yaml 为环境变量，secrets 优先级更高 |
| `waitForReady(port)` | 轮询 `/status`，指数退避（50ms → 500ms），最多 20 次 |
| `stopInstance(key)` | 优雅停止：SIGTERM → 等待 1s → SIGKILL |
| `stopAllForAgent(agentId)` | 停止某 Agent 的所有实例 |
| `touchAllForUser(userId)` | 刷新用户所有实例的 lastActivity |
| `resetStuckRunningSchedules(pathRoot)` | 启动前重置 schedule.json 中卡住的 `currently_running=true` |

**实例限制：**

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxInstancesPerUser` | 5 | 每用户最大运行实例数 |
| `maxInstancesGlobal` | 50 | 全局最大运行实例数 |

**启动时自动行为 (@PostConstruct)：**

1. 为所有 `sysOnly=true` 的 Agent 启动 sys 用户实例
2. 注册默认定时任务（从 `config/recipes/` 目录读取 recipe 文件）

### 6.3 IdleReaper

`@Scheduled` 定时任务，定期回收空闲实例。

- 检查间隔：每 60 秒（`gateway.idle.checkIntervalMs`）
- 空闲超时：15 分钟（`gateway.idle.timeoutMinutes`）
- **sys 实例永不回收**
- 回收后通知 PrewarmService 清除用户预热状态（仅当该用户无任何残余实例时）

### 6.4 PrewarmService

首次请求时的背景预热服务。

- 由 `UserContextFilter` 在每次认证请求时调用 `onUserActivity(userId)`
- 首次遇到新用户时，fire-and-forget 启动默认 Agent（`gateway.prewarm.defaultAgentId`）
- 每个用户仅触发一次预热（`warmedUsers` Set 追踪）
- `clearUser(userId)` — IdleReaper 回收后允许重新预热
- sys 用户和已预热用户不触发
- 预热失败不抛异常，不影响正常请求

### 6.5 PortAllocator

端口分配器，通过绑定 `:0` 获取操作系统分配的可用端口，立即释放后返回端口号。

### 6.6 RuntimePreparer

用户运行时目录的准备器。

- 创建目录结构：`users/{userId}/agents/{agentId}/`
- 建立符号链接：
  - `config` → `../../../../agents/{agentId}/config`（相对路径）
  - `AGENTS.md` → `../../../../agents/{agentId}/AGENTS.md`
- 创建子目录：`data/`、`uploads/`
- 返回运行时根路径，作为 goosed 的 `GOOSE_PATH_ROOT`

---

## 7. 代理与流式传输

### 7.1 GoosedProxy

通用 HTTP 代理，负责将请求转发到 goosed 实例。

**方法：**

| 方法 | 用途 |
|------|------|
| `proxy(request, response, port, path)` | 完整请求/响应代理（保留原始 header） |
| `proxyWithBody(response, port, path, method, body)` | 带预读请求体的代理 |
| `fetchJson(port, path)` | GET 请求，返回响应体字符串 |

**Header 处理：**

- **出站（copyHeaders）**：复制客户端 header，强制注入 `x-secret-key`（覆盖客户端提供的值）
- **入站（copyUpstreamHeaders）**：过滤上游的 6 种 CORS header（由 Gateway 的 CorsFilter 统一处理）：
  - `Access-Control-Allow-Origin`
  - `Access-Control-Allow-Methods`
  - `Access-Control-Allow-Headers`
  - `Access-Control-Expose-Headers`
  - `Access-Control-Max-Age`
  - `Access-Control-Allow-Credentials`

**超时：** 60 秒

### 7.2 SseRelayService

专用于 SSE 流式传输的中继服务。

- `relay(port, path, body)` — POST 请求到 goosed，返回 `Flux<DataBuffer>`
- **零拷贝**：直接转发原始 `DataBuffer`，不解析 SSE 事件内容
- 适用于长时间运行的对话流（LLM 推理可能持续数分钟）
- 60 秒超时

---

## 8. Hook 机制

### 8.1 Pipeline 架构

```
请求到达 ReplyController
    │
    ▼
HookPipeline.process(HookContext)
    │
    ├── BodyLimitHook (@Order=1)
    │   └── 检查 body 大小 ≤ maxFileSizeMb × 4/3（base64 膨胀余量）
    │       失败 → 413 Payload Too Large
    │
    ├── FileAttachmentHook (@Order=2)
    │   └── 解析 JSON，提取文件路径，校验路径在用户目录内
    │       失败 → 403 Forbidden / 404 Not Found
    │
    └── VisionPreprocessHook (@Order=3)
        └── 检测图片内容，根据 vision mode 处理
            ├── off       → 400 Bad Request
            ├── passthrough → 放行
            └── preprocess → 调用 Vision API 替换为文字描述
```

### 8.2 核心接口

- **`RequestHook`**（函数式接口）：`Mono<HookContext> process(HookContext ctx)`
- **`HookContext`**：携带 body、agentId、userId 和 state Map
- **`HookPipeline`**：按注册顺序通过 `flatMap` 链式执行所有 Hook，任何 Hook 返回 error Mono 即短路

### 8.3 Hook 详解

| Hook | 顺序 | 触发条件 | 行为 |
|------|------|---------|------|
| BodyLimitHook | 1 | 所有 /reply 请求 | body 字节数超限 → 413 |
| FileAttachmentHook | 2 | content 中含 text 类型且包含文件路径 | 路径越界 → 403，文件不存在 → 404 |
| VisionPreprocessHook | 3 | content 中含 image 类型 | 根据 agent/全局 vision 配置处理图片 |

**VisionPreprocessHook 支持的 Provider：**

- **OpenAI 兼容**（默认）：适用于 OpenAI、litellm/OpenRouter、Ollama 等
- **Anthropic**：当 `provider: anthropic` 时使用 Anthropic Messages API 格式

---

## 9. 过滤器链

### 9.1 AuthWebFilter (@Order=1)

Spring WebFlux `WebFilter`，负责请求认证。

**认证方式：**

1. `x-secret-key` 请求头
2. `key` 查询参数（备用）

**行为：**

- OPTIONS 预检请求直接放行
- 密钥缺失或不匹配 → 401 Unauthorized
- 通过后继续过滤器链

### 9.2 UserContextFilter (@Order=2)

提取用户身份并设置请求上下文属性。

**逻辑：**

1. 从 `x-user-id` header 提取用户 ID（缺失时默认 `sys`）
2. 通过 `UserRole.fromUserId()` 判断角色：`sys` → ADMIN，其他 → USER
3. 设置 exchange 属性：`userId`、`userRole`
4. 调用 `PrewarmService.onUserActivity(userId)` 触发首次预热

控制器通过 `exchange.getAttribute("userId")` / `exchange.getAttribute("userRole")` 获取用户信息。

---

## 10. 配置体系

### 10.1 配置注入链路

```
gateway/config.yaml          ← 用户编辑的配置文件
        │
        ▼
gateway/scripts/ctl.sh       ← 读取 YAML，转换为 Java -D 系统属性
        │
        ▼
java -Dgateway.secretKey=... ← JVM 系统属性
        │
        ▼
application.yml              ← Spring Boot 配置，使用 ${ENV_VAR:default} 绑定
        │
        ▼
GatewayProperties            ← @ConfigurationProperties(prefix="gateway")
```

### 10.2 GatewayProperties 结构

```
GatewayProperties
├── secretKey                 # 共享认证密钥
├── corsOrigin                # CORS 允许的来源
├── goosedBin                 # goosed 二进制路径
│
├── paths
│   ├── projectRoot           # 项目根目录（默认 ".."）
│   ├── agentsDir             # Agent 配置目录
│   └── usersDir              # 用户运行时目录
│
├── idle
│   ├── timeoutMinutes        # 空闲超时（默认 15）
│   └── checkIntervalMs       # 检查间隔（默认 60000）
│
├── upload
│   ├── maxFileSizeMb         # 最大文件大小（默认 50）
│   └── maxImageSizeMb        # 最大图片大小（默认 20）
│
├── limits
│   ├── maxInstancesPerUser   # 每用户实例上限（默认 5）
│   └── maxInstancesGlobal    # 全局实例上限（默认 50）
│
├── prewarm
│   ├── enabled               # 是否启用预热（默认 true）
│   └── defaultAgentId        # 预热的默认 Agent（默认 universal-agent）
│
├── vision
│   ├── mode                  # off / passthrough / preprocess（默认 off）
│   ├── provider              # Vision 模型 provider
│   ├── model                 # Vision 模型名称
│   ├── apiKey                # Vision API Key
│   ├── baseUrl               # Vision API Endpoint
│   └── maxTokens             # 最大输出 token（默认 1024）
│
├── langfuse
│   ├── host                  # Langfuse 服务地址
│   ├── publicKey             # 公钥
│   └── secretKey             # 密钥
│
└── officePreview
    ├── enabled               # 是否启用（默认 false）
    ├── onlyofficeUrl         # OnlyOffice 服务地址
    └── fileBaseUrl           # 文件访问基础 URL
```

### 10.3 config.yaml 示例

```yaml
host: 0.0.0.0
port: 3000
secret_key: your-secret-key
cors_origin: "*"
goosed_bin: goosed

idle_timeout_minutes: 15
max_instances_per_user: 5
max_instances_global: 50

prewarm_enabled: true
prewarm_default_agent_id: universal-agent

agents:
  - id: universal-agent
    name: Universal Agent
  - id: kb-agent
    name: KB Agent
  - id: supervisor-agent
    name: Supervisor Agent
    sysOnly: true
```

---

## 11. 构建与部署

### 11.1 构建流程

```bash
cd gateway
mvn package -DskipTests
```

**产物：**

```
gateway-service/target/
├── gateway-service.jar        # Thin JAR（主应用）
├── lib/                       # 所有依赖 JAR
└── resources/
    └── log4j2.xml             # 外部化日志配置
```

Maven 插件配置：

- `spring-boot-maven-plugin` — 重打包为可执行 JAR
- `maven-dependency-plugin` — 复制依赖到 `lib/` 目录
- `maven-resources-plugin` — 复制 `log4j2.xml` 到 `target/resources/`

### 11.2 启动方式

通过 `ctl.sh` 脚本启动：

```bash
./scripts/ctl.sh startup              # 前台启动
./scripts/ctl.sh startup --background # 后台启动
```

`ctl.sh` 内部执行：

```bash
java \
  -Dserver.port=${PORT} \
  -Dserver.address=${HOST} \
  -Dgateway.secretKey=${SECRET_KEY} \
  -Dgateway.corsOrigin=${CORS_ORIGIN} \
  -Dgateway.goosedBin=${GOOSED_BIN} \
  -Dgateway.paths.projectRoot=${PROJECT_ROOT} \
  # ... 更多 -D 参数 ...
  -Dloader.path=lib \
  -Dlogging.config=resources/log4j2.xml \
  -jar gateway-service.jar
```

### 11.3 服务管理

| 命令 | 说明 |
|------|------|
| `./scripts/ctl.sh startup` | 构建（如需）+ 启动 |
| `./scripts/ctl.sh shutdown` | 停止 gateway + 所有 goosed 进程 |
| `./scripts/ctl.sh status` | 健康检查（`/status` + `/agents`） |
| `./scripts/ctl.sh restart` | shutdown + startup |

### 11.4 健康检查

`ctl.sh` 启动后执行：

1. 轮询 `GET /status`（携带 `x-secret-key`），最多 40 次，每次间隔 1 秒
2. 查询 `GET /agents` 验证至少一个 Agent 已注册
3. 支持 host fallback：如 `GATEWAY_HOST` 不可达，自动尝试 `127.0.0.1`
