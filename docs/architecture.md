# Ops Factory 架构设计文档

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [组件详解](#3-组件详解)
   - 3.1 [Goosed（AI Agent 运行时）](#31-goosedai-agent-运行时)
   - 3.2 [Gateway（网关层）](#32-gateway网关层)
   - 3.3 [Web App（前端应用）](#33-web-app前端应用)
   - 3.4 [TypeScript SDK（客户端库）](#34-typescript-sdk客户端库)
   - 3.5 [Agents（智能体配置）](#35-agents智能体配置)
   - 3.6 [Langfuse（可观测性平台）](#36-langfuse可观测性平台)
   - 3.7 [OnlyOffice（文档预览服务）](#37-onlyoffice文档预览服务)
   - 3.8 [MCP Server（外部工具集成）](#38-mcp-server外部工具集成)
   - 3.9 [Prometheus Exporter（监控指标导出）](#39-prometheus-exporter监控指标导出)
4. [Gateway 多用户机制详解](#4-gateway-多用户机制详解)
5. [数据流与通信协议](#5-数据流与通信协议)
6. [文件上传与 Vision Pipeline](#6-文件上传与-vision-pipeline)
7. [目录结构与文件布局](#7-目录结构与文件布局)
8. [部署与服务管理](#8-部署与服务管理)
9. [现存不足与改进方向](#9-现存不足与改进方向)

---

## 1. 项目概述

Ops Factory 是一个基于 [Goose](https://github.com/block/goose)（Block 开源的 AI Agent 框架）构建的**多租户 AI 智能体管理平台**。它为运维团队提供一套统一的 Web 界面，支持多个预配置 AI Agent 协作完成事件分析、知识检索、报告生成等运维任务。

核心能力：

- **多用户隔离**：每个用户拥有独立的 Agent 进程和工作目录，互不干扰
- **多 Agent 协作**：支持 Universal Agent、KB Agent、Report Agent 等不同职能的智能体
- **SSE 实时流式对话**：基于 Server-Sent Events 的流式 AI 对话体验
- **文件上传与图片理解**：支持对话中附带文件和图片，Vision Pipeline 提供 off/passthrough/preprocess 三种图片处理模式
- **MCP 工具扩展**：通过 Model Context Protocol 集成飞书知识库、开发者工具等外部能力
- **可观测性**：通过 Langfuse 实现 LLM 调用链追踪与分析
- **文档预览**：通过 OnlyOffice 支持 Office 文档在线预览

---

## 2. 整体架构

```
                         +---------------------------+
                         |       用户浏览器           |
                         +---------------------------+
                                    |
                                    | HTTP / SSE
                                    v
                         +---------------------------+
                         |   Web App (React/Vite)    |
                         |   http://localhost:5173    |
                         +---------------------------+
                                    |
                          x-secret-key / x-user-id
                                    |
                                    v
+------------------+     +---------------------------+     +-------------------+
|   OnlyOffice     |<----|  Gateway (Spring Boot     |---->|    Langfuse       |
|   Document       |     |    WebFlux)               |     |   Observability   |
|   Server :8080   |     |   http://localhost:3000    |     |   :3100           |
+------------------+     +---------------------------+     +-------------------+
                           |          |          |                  |
                  spawn    |          |          |   spawn          |
                           v          v          v                  |
                    +-----------+ +---------+ +-----------+        |
                    | goosed    | | goosed  | | goosed    |        |
                    | universal | | kb      | | report    |  <-----+
                    | :random   | | :random | | :random   |  Langfuse SDK
                    +-----------+ +---------+ +-----------+  (via litellm)
                         |             |            |
                         v             v            v
                    +----------+  +----------+ +----------+
                    | MCP      |  | MCP      | | MCP      |
                    | Tools    |  | Feishu   | | Tools    |
                    | (dev,    |  | 知识库    | | (dev,    |
                    |  todo..) |  |          | |  todo..) |
                    +----------+  +----------+ +----------+
```

### 组件交互总览

```
+----------------+        +----------------+        +----------------+
|                |  HTTP   |                | spawn  |                |
|    Web App     |-------->|    Gateway     |------->|    goosed      |
|   (React SPA)  |  SSE    | (Spring Boot  |  子进程  |  (Agent 进程)  |
|                |<--------|  WebFlux)     |<-------|                |
+----------------+        +----------------+        +----------------+
       |                        |     |                    |
       |   fetch 文件预览        |     |                    | LLM API
       v                        |     |                    v
+----------------+              |     |           +----------------+
|  OnlyOffice    |              |     |           | LLM Provider   |
|  (Docker)      |              |     |           | (OpenRouter/   |
+----------------+              |     |           |  litellm)      |
                                |     |           +----------------+
                                |     |
                          symlink|     | 读取
                                v     v
                         +----------------+
                         |  agents/ 配置   |
                         |  (YAML/MD)     |
                         +----------------+
```

### 端口分配

| 组件 | 端口 | 说明 |
|------|------|------|
| Web App | 5173 | Vite 开发服务器 |
| Gateway | 3000 | HTTP API 网关 |
| OnlyOffice | 8080 | 文档预览服务 |
| Langfuse | 3100 | 可观测性面板 |
| goosed 实例 | 动态分配 | 每个用户/Agent 实例一个随机端口 |

---

## 3. 组件详解

### 3.1 Goosed（AI Agent 运行时）

Goosed 是 Block 开源的 Goose 框架的服务端进程，负责实际的 AI Agent 逻辑执行。每个 goosed 实例是一个独立进程，暴露 HTTP API 供 Gateway 代理调用。

**核心职责：**
- 管理与 LLM 的对话（通过 litellm 支持多模型提供商）
- 执行 MCP 工具调用（开发者工具、文件操作、知识库检索等）
- 维护会话状态（SQLite 本地存储）
- 定时任务执行（cron 调度）

**进程模型：**
```
Gateway 启动时:
  +-- goosed agent (sys:universal-agent)   port=随机
  +-- goosed agent (sys:kb-agent)          port=随机
  +-- goosed agent (sys:report-agent)      port=随机

用户 alice 首次请求时:
  +-- goosed agent (alice:universal-agent) port=随机
  +-- goosed agent (alice:kb-agent)        port=随机   <-- 后台预热
  +-- goosed agent (alice:report-agent)    port=随机   <-- 后台预热
```

每个 goosed 实例的环境变量由 Gateway 的 `InstanceManager.buildEnvironment()` 在 spawn 时注入：

- 从 Agent 的 `config.yaml` 和 `secrets.yaml` 合并键值对（secrets 优先级更高，非标量值跳过）
- 注入核心变量：`GOOSE_PORT`（随机端口）、`GOOSE_HOST`、`GOOSE_SERVER__SECRET_KEY`、`GOOSE_PATH_ROOT`（用户运行时目录）、`GOOSE_DISABLE_KEYRING=1`

---

### 3.2 Gateway（网关层）

Gateway 是整个平台的核心枢纽，基于 Spring Boot WebFlux 响应式框架实现，负责请求路由、用户隔离、进程管理。

**技术栈：** Java 21 + Spring Boot 2.7.18 + WebFlux (Reactor) + Maven 多模块

> 详细架构文档参见 [Gateway 模块架构文档](gateway-architecture.md)

**源码结构（Maven 多模块）：**

```
gateway/
├── pom.xml                          # 父 POM (ops-gateway-parent)
├── gateway-common/                  # 共享模块：常量、模型、工具类
│   └── src/main/java/.../common/
│       ├── constants/GatewayConstants.java
│       ├── model/{ManagedInstance, AgentRegistryEntry, UserRole}.java
│       └── util/{PathSanitizer, ProcessUtil, YamlLoader}.java
│
└── gateway-service/                 # 主应用模块
    └── src/main/java/.../gateway/
        ├── GatewayApplication.java  # Spring Boot 启动类
        ├── config/                  # GatewayProperties, CorsFilter, GlobalExceptionHandler
        ├── controller/              # 8 个控制器（Agent, Session, Reply, File, Status, Monitoring, Mcp, CatchAllProxy）
        ├── filter/                  # AuthWebFilter (@Order=1), UserContextFilter (@Order=2)
        ├── hook/                    # HookPipeline + BodyLimitHook, FileAttachmentHook, VisionPreprocessHook
        ├── service/                 # AgentConfigService, SessionService, FileService, LangfuseService
        ├── process/                 # InstanceManager, IdleReaper, PrewarmService, PortAllocator, RuntimePreparer
        └── proxy/                   # GoosedProxy (HTTP 代理), SseRelayService (SSE 中继)
```

**路由架构：**

```
Gateway HTTP 路由表（Spring WebFlux Controllers）
│
├── GET  /status                          → 健康检查 (StatusController)
├── GET  /me                              → 当前用户信息
├── GET  /config                          → 网关配置
│
├── GET  /agents                          → Agent 列表 (AgentController)
├── POST /agents                          → 创建 Agent [admin]
├── DELETE /agents/{id}                   → 删除 Agent [admin]
│
├── POST /agents/{id}/reply               → SSE 流式对话 (ReplyController)
├── POST /agents/{id}/agent/start         → 创建会话 (SessionController)
├── POST /agents/{id}/resume              → 恢复会话
├── POST /agents/{id}/stop                → 停止会话
│
├── GET  /sessions                        → 聚合会话列表
├── GET  /sessions/{id}?agentId=X         → 全局会话详情
├── DELETE /sessions/{id}?agentId=X       → 全局会话删除
│
├── GET  /agents/{id}/files               → 文件列表 (FileController)
├── GET  /agents/{id}/files/**            → 下载文件（PathSanitizer 防穿越）
├── POST /agents/{id}/files/upload        → 文件上传（multipart）
│
├── GET  /agents/{id}/config              → Agent 配置 [admin]
├── GET/POST /agents/{id}/mcp             → MCP 扩展 [admin] (McpController)
├── GET  /monitoring/*                    → Langfuse 监控 [admin] (MonitoringController)
│
└── ANY  /agents/{id}/**                  → 兜底代理 (CatchAllProxyController @Order=999)
```

**认证与过滤器链：**

请求通过两层 Spring WebFlux `WebFilter` 过滤器进行认证和上下文设置：

1. **AuthWebFilter** (`@Order(1)`)：验证 `x-secret-key` 请求头或 `key` 查询参数，失败返回 401
2. **UserContextFilter** (`@Order(2)`)：从 `x-user-id` header 提取用户 ID（默认 `sys`），通过 `UserRole.fromUserId()` 判断角色（`sys` → ADMIN，其他 → USER），设置 exchange 属性，触发 `PrewarmService.onUserActivity()`

控制器通过 `exchange.getAttribute("userId")` / `exchange.getAttribute("userRole")` 获取用户信息，管理类接口手动检查 `userRole == ADMIN`，非管理员返回 403。

**角色权限控制（RBAC）：**

| 路由 | admin | user | 说明 |
| ------ | :-----: | :----: | ------ |
| 聊天 reply/resume/stop | ✅ | ✅ | 用户核心功能 |
| 会话 CRUD (sessions) | ✅ | ✅ | 按用户隔离 |
| 文件上传/下载 (files) | ✅ | ✅ | 按用户目录隔离 |
| Agent 列表 GET /agents | ✅ | ✅ | 只读列表 |
| Agent 配置/技能/创建/删除 | ✅ | ❌ | 管理功能 |
| MCP 扩展 GET/POST/DELETE | ✅ | ❌ | 管理功能 |
| 监控 GET /monitoring/* | ✅ | ❌ | 管理功能 |
| 兜底代理（schedule 等） | ✅ | ❌ | 代理到 sys 实例 |
| 兜底代理（system_info/status） | ✅ | ✅ | 用户可查 |
| GET /me | ✅ | ✅ | 返回 `{ userId, role }` |

**SSE 流式代理与 Hook Pipeline：**

`ReplyController` 处理 `/reply` 路由时：

1. 调用 `InstanceManager.getOrSpawn()` 获取 goosed 实例端口
2. 通过 `HookPipeline.process(HookContext)` 执行 Hook 链预处理（`BodyLimitHook` → `FileAttachmentHook` → `VisionPreprocessHook`），任何 Hook 返回 error Mono 即短路
3. 调用 `SseRelayService.relay(port, path, body)` 向 goosed POST 请求
4. 返回 `Flux<DataBuffer>` 零拷贝 SSE 流式响应，Content-Type 为 `text/event-stream`

Hook 通过 `@Order` 注解控制执行顺序，通过 `RequestHook` 函数式接口（`Mono<HookContext> process(HookContext ctx)`）实现。详见 [第 6 节](#6-文件上传与-vision-pipeline)。

---

### 3.3 Web App（前端应用）

React 18 单页应用，提供 AI 对话、会话管理、Agent 配置、文件浏览等功能。

**技术栈：** React 18 + TypeScript + Vite + React Router v6

**应用结构：**

```
App (根组件)
├── /login              -> Login 页面
└── ProtectedRoute (需登录)
    ├── ToastProvider   (通知)
    ├── InboxProvider   (定时任务收件箱)
    ├── PreviewProvider (文件预览)
    └── AppContent
        ├── Sidebar     (侧边导航栏，按 role 显示/隐藏管理入口)
        └── Routes
            ├── /            -> Home（Prompt 模板 + 快捷入口）
            ├── /chat        -> Chat（AI 对话主界面）
            ├── /history     -> History（历史会话）
            ├── /files       -> Files（文件浏览器）
            ├── /inbox       -> Inbox（定时任务收件箱）
            ├── /agents      -> Agents（Agent 列表，Configure 按钮仅 admin 可见）
            ├── /agents/:id/configure -> AdminRoute > AgentConfigure（仅 admin）
            ├── /scheduled-actions    -> AdminRoute > ScheduledActions（仅 admin）
            ├── /monitoring           -> AdminRoute > Monitoring（仅 admin）
            └── /settings             -> Settings（用户设置）
```

**状态管理（Context 架构）：**

```
GoosedProvider           # Agent 客户端管理、连接状态
  ├── getClient(agentId) # 获取/缓存 GoosedClient 实例
  ├── agents[]           # 可用 Agent 列表
  └── isConnected        # 网关连接状态

UserProvider             # 用户认证与角色
  ├── userId             # 当前用户 ID（localStorage 持久化）
  ├── role               # 用户角色（'admin' | 'user'，登录后从 GET /me 获取）
  ├── login(username)    # 登录
  └── logout()           # 登出

PreviewProvider          # 文件预览
  ├── openPreview(file)  # 打开文件预览
  ├── officePreview      # OnlyOffice 配置（从 Gateway /config 获取）
  └── isPreviewable()    # 判断文件是否可预览

InboxProvider            # 定时任务收件箱
  ├── unreadSessions[]   # 未读的定时任务会话
  ├── unreadCount        # 未读数量
  └── refresh()          # 每 30 秒自动刷新

ToastProvider            # 通知提示
  └── showToast(type, msg) # 3 秒自动消失
```

**SDK 集成方式：**

Web App 通过 GoosedContext 创建 GoosedClient 实例，其 `baseUrl` 设置为网关的 Agent 路由前缀：

```typescript
// web-app/src/contexts/GoosedContext.tsx:42-52
const getClient = useCallback((agentId: string): GoosedClient => {
    const cacheKey = `${agentId}:${userId || ''}`
    if (!clientCache.current[cacheKey]) {
        clientCache.current[cacheKey] = new GoosedClient({
            baseUrl: `${GATEWAY_URL}/agents/${agentId}`,  // 例: http://localhost:3000/agents/kb-agent
            secretKey: GATEWAY_SECRET_KEY,
            timeout: 5 * 60 * 1000,
            userId: userId || undefined,
        })
    }
    return clientCache.current[cacheKey]
}, [userId])
```

---

### 3.4 TypeScript SDK（客户端库）

`@goosed/sdk` 是对 goosed HTTP API 的 TypeScript 封装，被 Web App 作为本地依赖引用。

**核心类：** `GoosedClient`

```typescript
// typescript-sdk/src/client.ts
class GoosedClient {
  // Agent 操作
  startSession(workingDir): Promise<Session>
  resumeSession(sessionId): Promise<{session, extensionResults}>
  stopSession(sessionId): Promise<void>

  // 流式对话（核心）
  sendMessage(sessionId, text, images?): AsyncGenerator<SSEEvent>  // SSE 流，支持图片
  chat(sessionId, text): Promise<string>                           // 聚合响应

  // 会话管理
  listSessions(): Promise<Session[]>
  getSession(sessionId): Promise<Session>
  deleteSession(sessionId): Promise<void>

  // 工具调用
  getTools(sessionId): Promise<ToolInfo[]>
  callTool(sessionId, name, args): Promise<CallToolResponse>

  // 文件上传
  uploadFile(file, sessionId): Promise<UploadResult>  // multipart 上传到 gateway

  // 定时任务
  createSchedule({id, recipe, cron}): Promise<ScheduledJob>
  listSchedules(): Promise<ScheduledJob[]>
  runScheduleNow(id): Promise<sessionId>
}
```

**新增类型：**

```typescript
// typescript-sdk/src/types.ts
interface ImageData {
  data: string       // base64 编码图片数据（不含 data URL 前缀）
  mimeType: string   // 如 'image/jpeg', 'image/png'
}

interface UploadResult {
  path: string       // 服务端存储的绝对路径
  name: string       // 清理后的文件名
  size: number       // 文件大小（字节）
  type: string       // MIME 类型
}
```

**SSE 流处理：**

SDK 的 `sendMessage` 方法是一个 AsyncGenerator，逐事件解析 SSE 数据流。支持可选的 `images` 参数传递 base64 编码图片：

```typescript
// typescript-sdk/src/client.ts:278-310
async *sendMessage(sessionId: string, text: string, images?: ImageData[]): AsyncGenerator<SSEEvent> {
    // 构造 content 数组：文本 + 图片
    const content: Array<Record<string, unknown>> = [];
    if (text.trim()) content.push({ type: 'text', text });
    if (images?.length) {
      images.forEach(img => content.push({ type: 'image', data: img.data, mimeType: img.mimeType }));
    }
    const message = {
      role: 'user', created: Math.floor(Date.now() / 1000),
      content,
      metadata: { userVisible: true, agentVisible: true },
    };

    const response = await fetch(`${this.baseUrl}/reply`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ session_id: sessionId, user_message: message }),
    })

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let dataLines: string[] = []

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
            if (trimmed === '') {
                // 空行表示一个 SSE 事件结束
                if (dataLines.length > 0) {
                    const data = JSON.parse(dataLines.join('\n')) as SSEEvent
                    yield data  // 逐事件 yield 给调用方
                }
            }
            if (trimmed.startsWith('data:')) {
                dataLines.push(trimmed.slice(5).trimStart())
            }
        }
    }
}
```

**SSE 事件类型：**

| 事件类型 | 说明 |
|---------|------|
| `Ping` | 心跳保活 |
| `Message` | AI 回复消息（含 text、toolRequest、toolResponse） |
| `Finish` | 对话完成 |
| `Error` | 错误信息 |
| `ModelChange` | 模型切换通知 |
| `Notification` | 系统通知 |
| `UpdateConversation` | 对话上下文更新 |

---

### 3.5 Agents（智能体配置）

每个 Agent 通过 `agents/{agentId}/` 目录下的配置文件定义行为。

**目录结构：**
```
agents/
├── universal-agent/
│   ├── AGENTS.md              # Agent 系统 Prompt（中文）
│   └── config/
│       ├── config.yaml        # 模型、扩展、环境变量
│       └── skills/            # 技能目录（SKILL.md 描述）
├── kb-agent/
│   ├── AGENTS.md
│   └── config/
│       ├── config.yaml        # 含飞书 MCP 集成
│       └── skills/
└── report-agent/
    ├── AGENTS.md
    └── config/
        ├── config.yaml
        └── skills/
```

**config.yaml 示例（Universal Agent）：**

```yaml
# agents/universal-agent/config/config.yaml
GOOSE_PROVIDER: litellm
GOOSE_MODEL: google/gemini-3-flash-preview
LITELLM_HOST: https://openrouter.ai/api/
GOOSE_MODE: auto
GOOSE_TELEMETRY_ENABLED: true

# Vision 配置（图片处理模式）
vision:
  mode: off              # off | passthrough | preprocess
  provider: litellm      # preprocess 模式使用的视觉模型 provider
  model: google/gemini-3-flash-preview  # 视觉模型
  maxTokens: 1024        # 视觉模型最大输出 token

# Langfuse 集成
LANGFUSE_INIT_PROJECT_PUBLIC_KEY: pk-lf-opsfactory
LANGFUSE_INIT_PROJECT_SECRET_KEY: sk-lf-opsfactory
LANGFUSE_URL: http://localhost:3100

# 扩展列表
extensions:
  developer:
    enabled: true
    type: builtin
    name: developer
    timeout: 300
  todo:
    enabled: true
    type: platform
    name: todo
  summon:
    enabled: true
    type: platform
    description: Load knowledge and delegate tasks to subagents
  # ...更多扩展
```

**配置共享机制：**

Agent 配置通过**符号链接**在多用户间共享，避免冗余拷贝：

```
users/alice/agents/universal-agent/
├── config -> ../../../../agents/universal-agent/config    # 符号链接
├── AGENTS.md -> ../../../../agents/universal-agent/AGENTS.md
├── data/          # alice 的私有数据
└── state/         # alice 的私有状态
```

---

### 3.6 Langfuse（可观测性平台）

Langfuse 提供 LLM 调用链的追踪、分析和调试能力。通过 Docker Compose 部署。

**架构：**

```
+-------------------+     +-------------------+
|   Langfuse Web    |     |   PostgreSQL 16   |
|   (Next.js)       |---->|   langfuse-db     |
|   :3100           |     |   :5432           |
+-------------------+     +-------------------+
        ^
        |  Langfuse SDK (内嵌于 litellm)
        |
+-------------------+
|   goosed 进程      |
|   GOOSE_PROVIDER:  |
|     litellm        |
+-------------------+
```

**工作原理：**

1. Agent 配置中设置 Langfuse 环境变量（`LANGFUSE_URL`、`LANGFUSE_INIT_PROJECT_*`）
2. goosed 通过 litellm 调用 LLM 时，litellm 自动将追踪数据发送到 Langfuse
3. 在 Langfuse 面板（`http://localhost:3100`）可以查看每次 LLM 调用的输入、输出、耗时、Token 消耗等

**Docker Compose 配置：**

```yaml
# langfuse/docker-compose.yml
services:
  langfuse-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: langfuse

  langfuse:
    image: langfuse/langfuse:2
    ports:
      - "3100:3000"
    environment:
      DATABASE_URL: postgresql://langfuse:langfuse@langfuse-db:5432/langfuse
      LANGFUSE_INIT_ORG_NAME: ops-factory
      LANGFUSE_INIT_PROJECT_NAME: ops-factory-agents
      LANGFUSE_INIT_USER_EMAIL: admin@opsfactory.local
```

---

### 3.7 OnlyOffice（文档预览服务）

OnlyOffice Document Server（社区版）提供 Word、Excel、PowerPoint 文件的在线预览能力。

**交互流程：**

```
+----------+    加载 API.js    +-------------+    HTTP 获取文件    +-----------+
|  浏览器   | <-------------- | OnlyOffice  | ----------------> |  Gateway  |
| (React)  | --- 嵌入编辑器 -->| Docker :8080| <-- 文件内容 ----- |   :3000   |
+----------+                  +-------------+                   +-----------+
```

具体流程：

1. Web App 的 `OnlyOfficePreview` 组件动态加载 OnlyOffice JS API：
   ```
   <script src="http://localhost:8080/web-apps/apps/api/documents/api.js">
   ```
2. 创建嵌入式 DocEditor，传入文件 URL：
   ```
   fileUrl = http://host.docker.internal:3000/agents/{agentId}/files/{path}?key={SECRET}
   ```
3. OnlyOffice 容器通过 `host.docker.internal` 从 Gateway 获取文件内容并渲染

**注意：** 因为 OnlyOffice 运行在 Docker 容器中，所以文件获取 URL 使用 `host.docker.internal` 来访问宿主机的 Gateway 端口。

---

### 3.8 MCP Server（外部工具集成）

MCP（Model Context Protocol）是 Goose 的扩展机制，允许 Agent 调用外部工具和服务。

**KB Agent 的飞书知识库集成示例：**

```yaml
# agents/kb-agent/config/config.yaml（摘要）
extensions:
  feishu-doc:
    enabled: true
    type: stdio
    name: feishu-doc
    cmd: npx
    args: ["-y", "@anthropic/feishu-mcp"]
    env_keys: [APP_ID, APP_SECRET, USER_ACCESS_TOKEN]
    timeout: 300
    available_tools:
      - wiki.v1.node.search    # 搜索知识库
      - docs.v1.content.get    # 获取文档内容
```

**MCP 配置的 Fanout 机制：**

当通过 API 添加/修改 MCP 配置时，`McpController` 会将变更**扇出**到所有运行中的用户实例：

1. 先将配置写入 sys 实例（`InstanceManager.getOrSpawn(agentId, "__default__")`）
2. 获取所有非 sys 用户实例（`InstanceManager.getAllInstances()` 过滤）
3. 对每个用户实例并发发送相同的 POST/DELETE 请求（`GoosedProxy.proxyWithBody()`）
4. 使用 `allSettled` 语义：单个实例失败不影响整体

---

### 3.9 Prometheus Exporter（监控指标导出）

Prometheus Exporter 模块位于 `prometheus-exporter/`，基于 **Spring Boot 2.7.18 + Java 21** 实现，通过拉取 Gateway 的监控 API 暴露标准 Prometheus 指标。

核心接口：

- `GET /metrics`：按需采集并输出 Prometheus 文本格式
- `GET /health`：健康检查（`{"status":"ok"}`）
- `GET /`：简易首页（包含 `/metrics` 链接）

核心指标（与历史实现保持兼容）：

- `opsfactory_gateway_up`
- `opsfactory_gateway_uptime_seconds`
- `opsfactory_agents_configured_total`
- `opsfactory_instances_total{status=...}`
- `opsfactory_instance_idle_seconds{agent_id,user_id}`
- `opsfactory_instance_info{agent_id,user_id,port,status}`
- `opsfactory_langfuse_configured`

原 Node.js 版本已保留到 `prometheus-exporter-legacy/`，用于迁移回滚与对照。

---

## 4. Gateway 多用户机制详解

多用户机制是 Ops Factory 的核心特性之一。每个用户拥有独立的 goosed 进程实例，实现完整的资源隔离。

### 4.1 实例管理架构

```
InstanceManager (Spring @Service)
│
├── instances: ConcurrentHashMap<"agentId:userId", ManagedInstance>
│     │
│     ├── "universal-agent:sys"   → { port: 54321, status: RUNNING, process: Process }
│     ├── "kb-agent:sys"          → { port: 54322, status: RUNNING, process: Process }
│     ├── "universal-agent:alice" → { port: 54400, status: RUNNING, process: Process }
│     ├── "kb-agent:alice"        → { port: 54401, status: RUNNING, process: Process }
│     └── "universal-agent:bob"   → { port: 54500, status: RUNNING, process: Process }
│
├── spawnLocks: ConcurrentHashMap<String, Object>  # 防止并发 spawn 同一实例
│
├── IdleReaper (@Scheduled)                        # 空闲回收定时任务
└── PrewarmService                                 # 首次请求预热
```

**ManagedInstance 数据模型** (`gateway-common`)：

```java
// ManagedInstance.java — 核心字段
public class ManagedInstance {
    enum Status { STARTING, RUNNING, STOPPED, ERROR }

    String agentId;              // Agent 标识
    String userId;               // 用户标识
    int port;                    // 动态分配的端口号
    long pid;                    // 进程 PID
    Status status;               // 实例状态
    long lastActivity;           // 最后活跃时间戳
    transient Process process;   // JDK Process 句柄（不可序列化）

    String getKey() { return agentId + ":" + userId; }
    void touch() { lastActivity = System.currentTimeMillis(); }
}
```

### 4.2 实例生命周期

```
用户首次请求
    │
    ▼
InstanceManager.getOrSpawn(agentId, userId) → Mono<ManagedInstance>
    │
    ├── 1. 检查缓存: instances.get("agentId:userId")
    │     ├── 命中且 RUNNING → touch(), 返回 Mono.just(instance)
    │     ├── 命中但进程已死 → 移除陈旧条目，继续
    │     └── 未命中 → 继续
    │
    ├── 2. 检查实例限制
    │     ├── perUser 超限 (默认 5) → Mono.error(403)
    │     └── global 超限 (默认 50) → Mono.error(503)
    │
    ├── 3. synchronized(spawnLocks.computeIfAbsent(key))  # 双重检查锁
    │     │
    │     └── doSpawn(agentId, userId)
    │           ├── 3a. RuntimePreparer.prepare()   — 创建目录 + 符号链接
    │           ├── 3b. PortAllocator.allocate()     — 绑定 :0 获取随机端口
    │           ├── 3c. buildEnvironment()           — 合并 config/secrets 为 env
    │           ├── 3d. resetStuckRunningSchedules() — 重置卡住的定时任务
    │           ├── 3e. ProcessBuilder.start()       — 启动 goosed 进程
    │           └── 3f. waitForReady()               — 轮询 /status（指数退避 50ms→500ms，最多 20 次）
    │
    └── 4. 返回 Mono.just(instance)
```

**首次预热**由 `PrewarmService` 独立处理（非 InstanceManager 职责）：用户首次经过 `UserContextFilter` 时，fire-and-forget 启动默认 Agent。

### 4.3 用户目录隔离

```
项目根目录/
├── agents/                        # 共享 Agent 定义（只读模板）
│   ├── universal-agent/
│   │   ├── AGENTS.md
│   │   └── config/
│   │       ├── config.yaml
│   │       └── skills/
│   ├── kb-agent/
│   └── report-agent/
│
└── users/                         # 用户运行时目录
    ├── sys/                       # 系统用户（定时任务等）
    │   └── agents/
    │       ├── universal-agent/
    │       │   ├── config -> ../../../../agents/universal-agent/config
    │       │   ├── AGENTS.md -> ../../../../agents/universal-agent/AGENTS.md
    │       │   ├── data/      # sys 用户的数据
    │       │   └── state/     # sys 用户的状态
    │       ├── kb-agent/
    │       └── report-agent/
    │
    ├── alice/                     # 用户 alice 的隔离环境
    │   └── agents/
    │       ├── universal-agent/
    │       │   ├── config -> ../../../../agents/universal-agent/config
    │       │   ├── AGENTS.md -> ../../../../agents/universal-agent/AGENTS.md
    │       │   ├── data/      # alice 的私有数据
    │       │   ├── state/     # alice 的私有状态
    │       │   └── uploads/   # alice 上传的文件（按 sessionId 分目录）
    │       ├── kb-agent/
    │       └── report-agent/
    │
    └── bob/                       # 用户 bob 的隔离环境
        └── agents/
            └── ...
```

### 4.4 空闲回收机制

`IdleReaper` 是一个 Spring `@Scheduled` 定时任务，定期检查并回收空闲的用户实例，防止资源浪费。

关键设计：

- **sys 实例永不回收**：系统用户实例在启动时预创建，始终运行
- **默认空闲超时**：15 分钟无活动自动回收（`gateway.idle.timeoutMinutes`）
- **活跃续命**：用户对任一 Agent 的操作会通过 `InstanceManager.touchAllForUser(userId)` 刷新该用户所有实例的 `lastActivity`
- **检查间隔**：每 60 秒（`gateway.idle.checkIntervalMs`）
- **预热状态清理**：回收后如用户无任何残余实例，通知 `PrewarmService.clearUser()` 允许下次重新预热

### 4.5 会话归属与可见性

`SessionService` 通过 `ConcurrentHashMap<String, String>` 缓存 `sessionId → userId` 的归属关系。会话通过 `working_dir` 字段判断归属用户（匹配 `/users/{userId}/` 路径模式）。

**会话列表聚合逻辑** (`SessionController.listSessions`)：

1. 遍历所有 Agent，对每个 Agent 查询用户实例和 sys 实例的 `/sessions` 接口
2. 通过 `working_dir` 过滤归属：用户只能看到自己的会话 + sys 共享会话
3. 为每条会话注入 `agentId` 字段（goosed 原始响应不含此字段）
4. 所有查询通过 `GoosedProxy.fetchJson()` 异步执行

### 4.6 后台预热

`PrewarmService` 在用户首次经过 `UserContextFilter` 时触发，fire-and-forget 启动默认 Agent（`gateway.prewarm.defaultAgentId`，默认 `universal-agent`）：

- 每个用户仅触发一次（`warmedUsers` Set 追踪），sys 用户不触发
- 预热失败不抛异常，不影响正常请求
- `IdleReaper` 回收用户所有实例后，调用 `clearUser()` 允许下次重新预热
- 可通过 `gateway.prewarm.enabled=false` 禁用

---

## 5. 数据流与通信协议

### 5.1 用户发送消息的完整链路

```
+--------+       +--------+       +---------+       +---------+       +----------+
| 浏览器  | POST  | Gateway| fetch | goosed  | HTTP  |  LLM    |       |  MCP     |
| (React) |------>| :3000  |------>| :随机端口|------>| Provider|       |  Tools   |
+--------+       +--------+       +---------+       +---------+       +----------+
    |                |                  |                 |                 |
    | 1. sendMessage |                  |                 |                 |
    |  (text+images) |                  |                 |                 |
    |--------------->| 2. getOrSpawn    |                 |                 |
    |                |   (如需 spawn)   |                 |                 |
    |                |----------------->|                 |                 |
    |                | 2.5 Pipeline     |                 |                 |
    |                |   Hooks 预处理   |                 |                 |
    |                |   (body-limit,   |                 |                 |
    |                |    vision等)     |                 |                 |
    |                |   3. POST /reply |                 |                 |
    |                |----------------->|                 |                 |
    |                |                  | 4. 调用 LLM     |                 |
    |                |                  |---------------->|                 |
    |                |                  |   模型推理      |                 |
    |                |                  |<----------------|                 |
    |                |                  |                                   |
    |                |                  | 5. 执行工具调用（如需要）          |
    |                |                  |--------------------------------->|
    |                |                  |         工具执行结果               |
    |                |                  |<---------------------------------|
    |                |                  |                                   |
    |                | 6. SSE 流式返回  |                                   |
    |                |<----- data: ... -|                                   |
    |  7. SSE 事件   |                  |                                   |
    |<--- data: ... -|                  |                                   |
    |                |                  |                                   |
    | 8. 渲染消息    |                  |                                   |
    |                |                  |                                   |
```

### 5.2 SSE 事件格式

```
data: {"type":"Message","message":{"role":"assistant","content":[{"type":"text","text":"你好"}]}}

data: {"type":"Message","message":{"role":"assistant","content":[{"type":"toolRequest","id":"call_1","toolCall":{"value":{"name":"developer__shell","arguments":{"cmd":"ls"}}}}]}}

data: {"type":"Message","message":{"role":"assistant","content":[{"type":"toolResponse","id":"call_1","toolResult":{"value":"file1.txt\nfile2.py"}}]}}

data: {"type":"Finish","reason":"stop","token_state":{"inputTokens":100,"outputTokens":50}}
```

### 5.3 文件预览数据流

```
+--------+   请求预览   +--------+   获取文件   +---------+
| 浏览器  |----------->| Gateway |----------->| goosed   |
| (React) |            |         |            | 工作目录  |
+--------+            +--------+            +---------+
    |                      |                      |
    | (A) 代码/Markdown/图片/PDF                  |
    |<--- 原始文件内容 ---|                        |
    | (浏览器内渲染)                               |
    |                                              |
    | (B) Office 文件 (docx/xlsx/pptx)            |
    |                      |                      |
    |--- 加载 OnlyOffice JS API ----+             |
    |                               v             |
    |                        +-------------+      |
    |                        | OnlyOffice  |      |
    |                        |   :8080     |------+
    |<-- 渲染后的文档视图 ---|             | (通过 host.docker.internal
    |                        +-------------+  获取文件)
```

---

## 6. 文件上传与 Vision Pipeline

### 6.1 概述

Ops Factory 支持用户在对话中附带图片和文件作为上下文。采用混合方案：

- **图片**：前端压缩为 base64 → 内联到 message content → 经 Gateway Vision Pipeline 处理
- **非图片文件**：通过 multipart 上传到 Gateway → 存储至用户目录 → 消息中附带路径 → Agent 通过工具读取

### 6.2 文件上传

**上传路由：** `POST /agents/:id/files/upload`

- Content-Type: `multipart/form-data`
- 字段: `file`（二进制）、`sessionId`（字符串）
- 响应: `{ path, name, size, type }`

**处理流程：**

1. Gateway 的 `FileController` 接收 multipart/form-data 请求
2. `PathSanitizer.sanitizeFilename()` 清理文件名：去除路径分隔符和特殊字符
3. `FileService.isAllowedExtension()` 白名单校验（支持代码、文档、图片、压缩包等常见格式，拦截 `.exe`、`.bat`、`.dll` 等可执行文件）
4. 存储到 `users/{userId}/agents/{agentId}/uploads/{sessionId}/{timestamp}_{filename}`
5. 返回服务端绝对路径

**大小限制：**

| 配置 | 环境变量 | 默认值 |
|------|---------|--------|
| 单个文件上限 | `MAX_UPLOAD_FILE_SIZE_MB` | 10 MB |
| 单个图片上限 | `MAX_UPLOAD_IMAGE_SIZE_MB` | 5 MB |

**Session 删除时自动清理：** 删除 session 时同步清理对应的 `uploads/{sessionId}/` 目录。

### 6.3 Vision Pipeline

Vision Pipeline 是 Gateway Reply Pipeline（Hook 链）中的核心环节，控制图片在对话中的处理方式。

**三种模式：**

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| `off` | 消息含图片时返回 400 拒绝 | 不需要图片理解的 Agent |
| `passthrough` | 图片原样转发给 goosed/LLM | LLM 自身支持多模态（如 Gemini） |
| `preprocess` | 调 Vision 模型将图片转为文字描述后替换 | LLM 不支持多模态，需外部视觉理解 |

**配置层级（优先级从高到低）：**

```
Agent config.yaml vision 段
    ↓ (未设置则 fallback)
Agent secrets.yaml（LITELLM_API_KEY、LITELLM_HOST 作为 apiKey/baseUrl 的 fallback）
    ↓
Gateway 环境变量（VISION_MODE、VISION_PROVIDER 等全局默认）
    ↓
内置默认值（mode=off）
```

**配置示例（Agent config.yaml）：**

```yaml
vision:
  mode: preprocess          # off | passthrough | preprocess
  provider: litellm         # Vision 模型 provider
  model: google/gemini-3-flash-preview  # Vision 模型
  maxTokens: 1024           # 最大输出 token
  # 可选覆盖：
  # apiKey: ...             # 覆盖全局 VISION_API_KEY
  # baseUrl: ...            # 覆盖全局 VISION_BASE_URL
  # prompt: ...             # 覆盖默认图片分析 prompt
```

**Vision API 兼容性：**

Vision Preprocess Hook 支持两种 API 格式：

- **OpenAI 兼容格式**（默认）：适用于 OpenAI、litellm/OpenRouter、Ollama 等。自动确保 endpoint 包含 `/v1` 前缀
- **Anthropic 格式**：当 `provider: anthropic` 时使用 Anthropic Messages API 格式

### 6.4 Reply Pipeline（Hook 链）

Gateway 的 `/reply` 路由在转发请求到 goosed 之前，通过 `HookPipeline` 执行一系列 `RequestHook`：

```
用户消息 → [BodyLimitHook] → [FileAttachmentHook] → [VisionPreprocessHook] → goosed
               @Order(1)          @Order(2)               @Order(3)
                  |                   |                       |
                  v                   v                       v
            请求体过大?          文件路径合法?            图片处理模式?
            → 413 拒绝          → 403/404 拒绝          → off: 400 拒绝
                                                        → passthrough: 放行
                                                        → preprocess: 转文字
```

**Hook 详解：**

| Hook | Java 类 | 职责 |
|------|---------|------|
| `BodyLimitHook` | `hook/BodyLimitHook.java` | 检查请求体大小 ≤ maxFileSizeMb × 4/3（base64 膨胀余量），超限返回 413 |
| `FileAttachmentHook` | `hook/FileAttachmentHook.java` | 解析 JSON 提取文件路径，校验路径在用户目录内，越界返回 403/404 |
| `VisionPreprocessHook` | `hook/VisionPreprocessHook.java` | 根据 agent/全局 vision mode 处理图片（拒绝/放行/调 Vision API 转文字） |

**Pipeline 核心接口**：

- **`RequestHook`**（函数式接口）：`Mono<HookContext> process(HookContext ctx)` — 返回修改后的 context 或 error Mono 短路
- **`HookContext`**：携带 `body`（JSON Map）、`agentId`、`userId`、`state`（hooks 间共享 Map）
- **`HookPipeline`**：按 `@Order` 注解顺序通过 `flatMap` 链式执行所有 Hook，任何 error Mono 即短路终止

### 6.5 前端集成

**ChatInput 组件支持：**

- 拖拽上传图片/文件
- 文件选择器
- 剪贴板粘贴图片
- 图片前端压缩（Canvas，max 1024px，JPEG 0.85 质量）
- 根据 `visionMode` 控制图片 UI 可见性

**处理流程差异：**

- **图片**：FileReader → base64 → 前端压缩 → 内联到 message content（`type: 'image'`）
- **非图片文件**：调 `client.uploadFile()` 上传到 Gateway → 文件路径拼接到消息文本末尾

**前端常量：**

| 常量 | 值 |
|------|-----|
| `MAX_IMAGES_PER_MESSAGE` | 3 |
| `MAX_FILES_PER_MESSAGE` | 5 |

### 6.6 数据流：图片消息的完整链路

```
浏览器 (ChatInput)
  |
  | 1. 图片压缩 → base64
  | 2. 构造 message.content = [{type:'text',...}, {type:'image',data:base64,...}]
  |
  v
Gateway (/reply)
  |
  | 3. HookPipeline.process(HookContext)
  |    ├── BodyLimitHook: 大小检查
  |    ├── FileAttachmentHook: 路径检查
  |    └── VisionPreprocessHook:
  |        ├── mode=off       → 400 拒绝
  |        ├── mode=passthrough → 放行
  |        └── mode=preprocess → 调 Vision API → 替换图片为文字描述
  |
  | 4. 转发修改后的 body 到 goosed
  v
goosed (Agent 进程)
  |
  | 5. LLM 推理（passthrough 时接收原始图片，preprocess 时接收文字描述）
  |
  v
SSE 流式响应 → Gateway 转发 → 浏览器渲染
```

---

## 7. 目录结构与文件布局

```
ops-factory/
├── gateway/                       # 网关服务（Java 21 / Spring Boot WebFlux / Maven 多模块）
│   ├── pom.xml                    # 父 POM (ops-gateway-parent)
│   ├── config.yaml                # 网关运行时配置
│   ├── scripts/
│   │   └── ctl.sh                 # 服务控制脚本（startup/shutdown/status/restart）
│   ├── gateway-common/            # 共享模块：常量、模型、工具类
│   │   ├── pom.xml
│   │   └── src/main/java/.../common/
│   │       ├── constants/GatewayConstants.java
│   │       ├── model/{ManagedInstance, AgentRegistryEntry, UserRole}.java
│   │       └── util/{PathSanitizer, ProcessUtil, YamlLoader}.java
│   ├── gateway-service/           # 主应用模块
│   │   ├── pom.xml
│   │   └── src/main/java/.../gateway/
│   │       ├── GatewayApplication.java
│   │       ├── config/            # GatewayProperties, CorsFilter, GlobalExceptionHandler
│   │       ├── controller/        # 8 个控制器
│   │       ├── filter/            # AuthWebFilter, UserContextFilter
│   │       ├── hook/              # HookPipeline, BodyLimitHook, FileAttachmentHook, VisionPreprocessHook
│   │       ├── service/           # AgentConfigService, SessionService, FileService, LangfuseService
│   │       ├── process/           # InstanceManager, IdleReaper, PrewarmService, PortAllocator, RuntimePreparer
│   │       └── proxy/             # GoosedProxy, SseRelayService
│
├── web-app/                       # 前端应用
│   ├── src/
│   │   ├── App.tsx                # 根组件 + 路由
│   │   ├── contexts/              # React Context 状态管理
│   │   │   ├── GoosedContext.tsx   # Agent 客户端管理
│   │   │   ├── UserContext.tsx     # 用户认证与角色（ProtectedRoute、AdminRoute）
│   │   │   ├── PreviewContext.tsx  # 文件预览
│   │   │   ├── InboxContext.tsx    # 收件箱
│   │   │   └── ToastContext.tsx    # 通知
│   │   ├── hooks/                 # 自定义 Hooks
│   │   │   ├── useChat.ts         # SSE 流式对话
│   │   │   ├── useAgentConfig.ts  # Agent 配置管理
│   │   │   ├── useMcp.ts          # MCP 扩展管理
│   │   │   └── useSkills.ts       # 技能查询
│   │   ├── pages/                 # 页面组件
│   │   ├── components/            # 通用组件（ChatInput 含图片上传）
│   │   ├── types/                 # TypeScript 类型定义
│   │   └── utils/                 # 工具函数
│   │       └── imageUtils.ts      # 图片压缩（Canvas）
│   └── package.json
│
├── typescript-sdk/                # TypeScript 客户端库
│   ├── src/
│   │   ├── client.ts              # GoosedClient 类
│   │   ├── types.ts               # 类型定义
│   │   └── index.ts               # 导出
│   └── package.json
│
│   ├── agents/                    # Agent 配置（共享模板）
│   │   ├── universal-agent/
│   │   ├── kb-agent/
│   │   └── ...
│   └── users/                     # 用户运行时目录（自动生成，gitignored）
│
├── langfuse/                      # Langfuse 可观测性
│   └── docker-compose.yml
│
├── scripts/
│   └── ctl.sh                     # 统一服务管理脚本
│
├── test/                          # 集成测试
│   ├── integration.test.ts
│   ├── helpers.ts
│   └── vitest.config.ts
│
└── docs/                          # 架构文档
    ├── architecture.md            # 整体架构文档
    └── gateway-architecture.md    # Gateway 模块架构文档
```

---

## 8. 部署与服务管理

### 8.1 统一控制脚本

`scripts/ctl.sh` 提供了统一的服务管理入口：

```bash
./scripts/ctl.sh startup              # 启动所有服务
./scripts/ctl.sh startup gateway      # 仅启动网关
./scripts/ctl.sh startup webapp       # 仅启动前端
./scripts/ctl.sh shutdown all         # 停止所有服务
./scripts/ctl.sh status               # 检查服务状态
./scripts/ctl.sh restart gateway      # 重启网关
```

### 8.2 启动顺序

```
1. OnlyOffice (Docker)
   docker run -d --name onlyoffice -p 8080:80 onlyoffice/documentserver
   等待 /healthcheck 就绪
       |
       v
2. Langfuse (Docker Compose)
   docker compose -f langfuse/docker-compose.yml up -d
   等待 /api/public/health 就绪
       |
       v
3. Gateway (Spring Boot WebFlux)
   cd gateway && mvn package -DskipTests  # 构建（ctl.sh 自动检测是否需要）
   java -Dloader.path=lib -jar gateway-service/target/gateway-service.jar
   等待 /status 就绪
   --> @PostConstruct 自动 spawn sysOnly Agent 实例 + 注册默认定时任务
       |
       v
4. Web App (Vite)
   npm run dev (web-app 目录)
   等待 Playwright 检测页面就绪
```

### 8.3 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_HOST` | `0.0.0.0` | 网关绑定地址 |
| `GATEWAY_PORT` | `3000` | 网关端口 |
| `GATEWAY_SECRET_KEY` | `test` | 共享认证密钥 |
| `GOOSED_BIN` | `goosed` | goosed 二进制路径 |
| `PROJECT_ROOT` | 自动检测 | 项目根目录 |
| `VITE_GATEWAY_URL` | `http://127.0.0.1:3000` | 前端连接网关地址 |
| `VITE_GATEWAY_SECRET_KEY` | `test` | 前端认证密钥 |
| `OFFICE_PREVIEW_ENABLED` | `true` | OnlyOffice 启用开关 |
| `ONLYOFFICE_URL` | `http://localhost:8080` | OnlyOffice 服务地址 |
| `IDLE_TIMEOUT_MINUTES` | `15` | 用户实例空闲超时（分钟） |
| `MAX_INSTANCES_PER_USER` | `5` | 每用户最大实例数 |
| `MAX_INSTANCES_GLOBAL` | `50` | 全局最大实例数 |
| `MAX_UPLOAD_FILE_SIZE_MB` | `50` | 单个上传文件大小上限（MB） |
| `MAX_UPLOAD_IMAGE_SIZE_MB` | `20` | 单个上传图片大小上限（MB） |
| `VISION_MODE` | `off` | 全局默认 Vision 模式（off/passthrough/preprocess） |
| `VISION_PROVIDER` | (空) | Vision 模型 provider |
| `VISION_MODEL` | (空) | Vision 模型名称 |
| `VISION_API_KEY` | (空) | Vision 模型 API Key |
| `VISION_BASE_URL` | (空) | Vision 模型 API Endpoint |
| `VISION_MAX_TOKENS` | `1024` | Vision 模型最大输出 token |
| `VISION_PROMPT` | (内置默认) | 图片分析 prompt |

---

## 9. 现存不足与改进方向

### 9.1 安全性

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| **认证过于简单** | 高 | 当前仅依赖共享密钥（`x-secret-key`）+ 用户名（`x-user-id`），无密码、无 JWT/OAuth，任何人知道密钥即可冒充任意用户 |
| **密钥硬编码** | 高 | 默认密钥 `test` 在代码和配置中硬编码，`GATEWAY_SECRET_KEY` 在前端 `.env` 和 HTTP Header 中明文传输 |
| **CORS 全开放** | 中 | `Access-Control-Allow-Origin: *`，任何域名都可以调用 Gateway API |
| **无 HTTPS** | 中 | 所有通信均使用 HTTP 明文传输，包括认证密钥和用户数据 |
| **前端认证仅靠 localStorage** | 中 | 登录仅设置 `localStorage` 中的 `userId`，无 token 刷新、无过期机制 |

### 9.2 可靠性与扩展性

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| **单机部署限制** | 高 | Gateway 通过 `spawn` 管理 goosed 子进程，无法跨机器水平扩展；所有进程状态存储在内存中（`Map`），Gateway 重启即丢失所有运行实例信息 |
| **无持久化状态** | 高 | `InstanceManager` 的实例信息全在内存中，Gateway 崩溃后无法恢复用户实例，需全部重建 |
| **无健康检查与自愈** | 中 | goosed 进程如果异常退出（非正常 SIGTERM），仅记录 `status: 'error'`，不会自动重启 |
| **会话归属缓存无持久化** | 中 | `SessionOwnerCache` 是纯内存 Map，Gateway 重启后需重新从 goosed 实例重建 |
| ~~**无进程数限制**~~ | ~~中~~ | ✅ 已实现：`maxInstancesPerUser`（默认 5）和 `maxInstancesGlobal`（默认 50）限制，超限返回 403/503 |

### 9.3 性能

| 问题 | 说明 |
|------|------|
| **冷启动延迟** | 新用户首次请求需要等待 goosed 进程启动（轮询 30 次 * 500ms = 最多 15 秒），预热机制缓解了后续 Agent 的等待 |
| **会话列表查询效率低** | `GET /sessions` 需要向所有 Agent 的用户实例和 sys 实例逐一发请求并聚合，Agent 和用户越多越慢 |
| **无连接池** | Gateway 对 goosed 实例的每次 HTTP 请求都是独立的 `fetch`，未复用连接 |

### 9.4 功能完整性

| 问题 | 说明 |
|------|------|
| **监控页面使用 Mock 数据** | `Monitoring.tsx` 页面的指标（请求量、延迟、可用率）全部是硬编码假数据，未接入真实 Langfuse API |
| **无用户管理** | 没有用户注册、管理员后台等功能，任何人输入用户名即可使用。已实现基于 userId 的 RBAC（`sys` = admin，其他 = user），管理类路由和前端页面按角色区分访问权限 |
| **定时任务管理不完整** | 定时任务依赖 goosed 内置的 Recipe/Schedule 机制，但 UI 上的管理体验较粗糙 |
| **文件上传已实现但功能有限** | 支持通过聊天输入框上传图片（base64 内联）和文件（multipart 上传），但缺少独立的文件管理界面和批量上传能力 |
| **Agent 配置热更新受限** | 修改 `AGENTS.md`（Prompt）可以通过 API 更新，但 `config.yaml` 修改需要重启 Agent 进程 |
| **MCP 扩展依赖 Feishu Token 手动刷新** | KB Agent 的飞书 MCP 集成依赖 `USER_ACCESS_TOKEN`，需要每约 2 小时手动刷新，影响生产可用性 |

### 9.5 工程实践

| 问题 | 说明 |
|------|------|
| **无 monorepo 工具** | Gateway 已改为 Maven 多模块（统一构建），但 web-app 和 typescript-sdk 仍各自独立，安装和构建需分别操作 |
| **测试覆盖不足** | Gateway 已有 358 个测试（单元 + E2E），但 Web App 的单元测试极少；缺少对多用户并发场景的压力测试；Gateway 部分场景需真实 goosed 进程的集成测试 |
| ~~**日志缺乏结构化**~~ | ✅ 已改进：Gateway 使用 Log4j2 替代 console.log，支持日志级别控制和外部化配置（`log4j2.xml`） |
| **配置管理分散** | 配置散落在 YAML 文件、环境变量、`.env` 文件中，缺乏统一的配置验证和文档 |
| **无 CI/CD** | 缺少自动化构建、测试、部署流水线 |
| **Python SDK 已不存在** | README 中仍引用 Python SDK，但代码库中已无相关目录 |

### 9.6 改进建议优先级

**P0（必须优先解决）：**
1. 实现真正的用户认证（JWT + 密码验证 或 SSO 集成）
2. 移除硬编码密钥，使用加密存储
3. 增加 HTTPS 支持

**P1（短期改进）：**
1. 实现监控面板与 Langfuse API 真实对接
2. ~~增加进程数上限和资源管控~~ ✅ 已实现（`maxInstancesPerUser` / `maxInstancesGlobal`）
3. 实现 goosed 进程异常退出后的自动重启
4. ~~引入结构化日志~~ ✅ 已实现（Log4j2）

**P2（中期优化）：**
1. 引入 monorepo 工具统一依赖管理
2. 建立 CI/CD 流水线
3. 增加 Web App 单元测试覆盖率
4. 考虑引入 Redis 或消息队列实现跨机器扩展的可能性
5. 飞书 MCP Token 自动刷新机制

**P3（长期演进）：**
1. 容器化部署（每个 goosed 实例运行在独立容器中）
2. 实现 Agent 配置热更新（无需重启进程）
3. ~~引入 RBAC 权限模型~~ ✅ 已实现（`sys` = admin，其他 = user，Gateway 路由守卫 + 前端 AdminRoute）
4. 考虑 WebSocket 替代 SSE 以支持双向通信
