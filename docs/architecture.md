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
|   OnlyOffice     |<----|    Gateway (Node.js)      |---->|    Langfuse       |
|   Document       |     |   http://localhost:3000    |     |   Observability   |
|   Server :8080   |     +---------------------------+     |   :3100           |
+------------------+       |          |          |         +-------------------+
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
|   (React SPA)  |  SSE    |  (Node.js)    |  子进程  |  (Agent 进程)  |
|                |<--------|                |<-------|                |
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

每个 goosed 实例的环境变量由 Gateway 在 spawn 时注入：

```typescript
// gateway/src/instance-manager.ts:212-220
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  ...agentConfigEnv,                          // 从 config.yaml 读取
  GOOSE_PORT: String(port),                   // OS 分配的随机端口
  GOOSE_HOST: agentConfig.host,               // 0.0.0.0
  GOOSE_SERVER__SECRET_KEY: agentConfig.secret_key,
  GOOSE_PATH_ROOT: userRoot,                  // users/{userId}/agents/{agentId}/
  GOOSE_DISABLE_KEYRING: '1',
}
```

---

### 3.2 Gateway（网关层）

Gateway 是整个平台的核心枢纽，使用原生 Node.js `http` 模块实现（无 Express），负责请求路由、用户隔离、进程管理。

**技术栈：** Node.js + TypeScript + http-proxy

**源码结构：**
```
gateway/src/
  index.ts              # HTTP 服务器、路由定义（含文件上传路由）
  instance-manager.ts   # 多用户实例生命周期管理
  config.ts             # 配置加载（YAML + 环境变量，含 upload/vision 配置）
  file-server.ts        # 文件服务（列表 + 下载 + MIME）
  user-registry.ts      # 会话归属缓存
  hooks.ts              # ReplyPipeline —— /reply 路由的 Hook 链机制
  multipart.ts          # multipart/form-data 解析器（文件上传用）
  hooks/                # 内置 Request Hooks
    body-limit.ts       # 请求体大小限制
    file-attachment.ts  # 上传文件路径安全校验
    vision-preprocess.ts # 图片预处理（off/passthrough/preprocess 三种模式）
```

**路由架构：**

```
Gateway HTTP 路由表
|
|-- GET  /status                      -> 健康检查
|-- GET  /me                          -> 当前用户信息
|-- GET  /config                      -> 网关配置（OnlyOffice 等）
|-- GET  /agents                      -> Agent 列表
|
|-- POST /agents/:id/agent/start      -> 创建会话（按需 spawn 用户实例）
|-- POST /agents/:id/agent/reply      -> SSE 流式对话（fetch 代理）
|-- POST /agents/:id/agent/resume     -> 恢复会话
|-- POST /agents/:id/agent/stop       -> 停止会话
|
|-- GET  /sessions                    -> 聚合会话列表（多实例查询）
|-- GET  /sessions/:id                -> 获取会话详情
|-- DELETE /sessions/:id              -> 删除会话
|
|-- GET  /agents/:id/files            -> 列出用户文件
|-- GET  /agents/:id/files/*          -> 下载文件（带路径穿越防护）
|-- POST /agents/:id/files/upload     -> 文件上传（multipart/form-data）
|
|-- GET  /agents/:id/config           -> 读取 Agent 配置
|-- PUT  /agents/:id/config           -> 更新 Agent Prompt
|-- GET  /agents/:id/skills           -> 列出 Agent 技能
|
|-- GET/POST /agents/:id/mcp          -> MCP 扩展管理（带 fanout）
|-- DELETE   /agents/:id/mcp/:name    -> 删除 MCP 扩展（带 fanout）
|
|-- ANY  /agents/:id/*                -> 兜底代理到 sys 实例
```

**认证机制：**

```typescript
// gateway/src/index.ts:127-140
const headerKey = req.headers['x-secret-key']              // Header 认证
const queryKey = urlObj.searchParams.get('key')             // Query 参数（仅文件路由）
const isFileRoute = urlObj.pathname.match(/^\/agents\/[^/]+\/files(\/|$)/)
const isAuthed = headerKey === config.secretKey
               || (isFileRoute && queryKey === config.secretKey)

const userId = (req.headers['x-user-id'] as string) || DEFAULT_USER  // 'sys'
```

**SSE 流式代理与 Reply Pipeline：**

Gateway 对 `/reply` 路由使用 `fetch` 直接代理（而非 http-proxy），以便精确控制 SSE 流。在转发到 goosed 之前，请求会经过 **ReplyPipeline** 的 Hook 链进行预处理：

```typescript
// gateway/src/index.ts — /reply 路由（简化）
if (action === 'reply') {
  // 1. 构建 Hook 上下文，读取完整 agent 配置（含 secrets.yaml）
  const agentFullConfig = manager.getAgentFullConfig(agentId)
  const hookCtx: HookContext = {
    req, res, agentId, userId,
    agentConfig: agentFullConfig,
    body: bodyJson, bodyStr,
    state: new Map(),
  }

  // 2. 运行 Request Hooks（body-limit → file-attachment → vision-preprocess）
  const proceed = await pipeline.runRequestHooks(hookCtx)
  if (!proceed) return  // Hook 已响应（如 400、413），短路终止

  // 3. 转发到 goosed（使用 hooks 可能修改后的 body）
  const upstreamResponse = await fetch(`${target}/reply`, {
    method: 'POST',
    headers: upstreamHeaders(config.secretKey),
    body: hookCtx.bodyStr,
  })

  // 4. SSE 流式转发
  res.writeHead(upstreamResponse.status, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })
  if (upstreamResponse.body) {
    const reader = upstreamResponse.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
    res.end()
  }
}
```

**ReplyPipeline 机制** (`gateway/src/hooks.ts`)：

- Hooks 按注册顺序依次执行
- 任何 hook 可通过写 response 短路终止（通过 `ctx.res.writableEnded` 检测）
- 所有 request hooks 完成后，自动 `ctx.bodyStr = JSON.stringify(ctx.body)` 同步修改
- 当前注册的 hooks：`body-limit` → `file-attachment` → `vision-preprocess`（详见 [第 6 节](#6-文件上传与-vision-pipeline)）

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
        ├── Sidebar     (侧边导航栏)
        └── Routes
            ├── /            -> Home（Prompt 模板 + 快捷入口）
            ├── /chat        -> Chat（AI 对话主界面）
            ├── /history     -> History（历史会话）
            ├── /files       -> Files（文件浏览器）
            ├── /agents      -> Agents（Agent 列表）
            ├── /agents/:id/configure -> AgentConfigure（配置）
            ├── /scheduled-actions    -> ScheduledActions（定时任务）
            ├── /monitoring           -> Monitoring（监控面板）
            └── /settings             -> Settings（用户设置）
```

**状态管理（Context 架构）：**

```
GoosedProvider           # Agent 客户端管理、连接状态
  ├── getClient(agentId) # 获取/缓存 GoosedClient 实例
  ├── agents[]           # 可用 Agent 列表
  └── isConnected        # 网关连接状态

UserProvider             # 用户认证
  ├── userId             # 当前用户 ID（localStorage 持久化）
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

当通过 API 添加/修改 MCP 配置时，Gateway 会将变更**扇出**到所有运行中的用户实例：

```typescript
// gateway/src/index.ts:442-453
// POST MCP 配置后 fanout 到所有用户实例
const userInstances = manager.getRunningInstancesForAgent(agentId)
  .filter(inst => inst.userId !== SYSTEM_USER)
if (userInstances.length > 0 && bodyStr) {
  const body = JSON.parse(bodyStr)
  await Promise.allSettled(userInstances.map(async inst => {
    const instTarget = manager.getTarget(inst.agentId, inst.userId)
    if (instTarget) {
      await postJsonToTarget(instTarget, '/config/extensions', body, config.secretKey)
    }
  }))
}
```

---

## 4. Gateway 多用户机制详解

多用户机制是 Ops Factory 的核心特性之一。每个用户拥有独立的 goosed 进程实例，实现完整的资源隔离。

### 4.1 实例管理架构

```
InstanceManager
|
|-- instances: Map<"agentId:userId", ManagedInstance>
|     |
|     |-- "universal-agent:sys"   -> { port: 54321, status: 'running', child: Process }
|     |-- "kb-agent:sys"          -> { port: 54322, status: 'running', child: Process }
|     |-- "universal-agent:alice" -> { port: 54400, status: 'running', child: Process }
|     |-- "kb-agent:alice"        -> { port: 54401, status: 'running', child: Process }
|     +-- "universal-agent:bob"   -> { port: 54500, status: 'running', child: Process }
|
|-- spawnLocks: Map<string, Promise>    # 防止并发 spawn 同一实例
|-- warmingUsers: Set<string>           # 正在预热的用户
+-- idleTimer: setInterval              # 空闲回收定时器
```

**ManagedInstance 数据结构：**

```typescript
// gateway/src/instance-manager.ts:12-20
interface ManagedInstance {
  agentId: string            // Agent 标识
  userId: string             // 用户标识
  port: number               // 动态分配的端口号
  child: ChildProcess | null // 子进程句柄
  status: 'starting' | 'running' | 'stopped' | 'error'
  lastActivity: number       // 最后活跃时间戳
  runtimeRoot: string        // 工作目录路径
}
```

### 4.2 实例生命周期

```
用户首次请求
    |
    v
getOrSpawn(agentId, userId)
    |
    |-- 1. 检查缓存: instances.get("agentId:userId")
    |     |-- 命中且 running -> 更新 lastActivity, 返回 URL
    |     +-- 未命中 -> 继续
    |
    |-- 2. 检查 spawn 锁: spawnLocks.get(key)
    |     |-- 已有锁 -> 等待已有 Promise 完成
    |     +-- 无锁 -> 设置锁，开始 spawn
    |
    |-- 3. spawnForUser(agentId, userId)
    |     |-- 3a. prepareUserRuntime() -- 创建目录 + 符号链接
    |     |-- 3b. allocatePort()       -- 绑定 :0 获取随机端口
    |     |-- 3c. spawn('goosed', ['agent'], { env, cwd })
    |     +-- 3d. waitForReady()       -- 轮询 /status 最多 30 次
    |
    |-- 4. 后台预热: warmUpUserInstances(userId, excludeAgentId)
    |     +-- 异步 spawn 该用户的其他所有 Agent
    |
    +-- 5. 清除 spawn 锁, 返回 http://127.0.0.1:{port}
```

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

Gateway 通过定时器定期检查并回收空闲的用户实例，防止资源浪费：

```typescript
// gateway/src/instance-manager.ts:286-301
startIdleReaper(intervalMs: number, maxIdleMs: number): void {
  this.idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, inst] of this.instances) {
      if (inst.userId === SYSTEM_USER) continue  // 永不回收 sys 实例
      if (inst.status !== 'running') continue
      if (now - inst.lastActivity > maxIdleMs) {
        console.log(`[idle-reaper] Stopping idle instance ${key}`)
        this.stopInstance(key)
      }
    }
  }, intervalMs)
}
```

关键设计：

- **sys 实例永不回收**：系统用户实例在启动时预创建，始终运行
- **默认空闲超时**：15 分钟无活动自动回收
- **活跃续命**：用户对任一 Agent 的操作会刷新该用户所有 Agent 实例的 `lastActivity`
- **检查间隔**：每 60 秒检查一次

```typescript
// gateway/src/instance-manager.ts:142-149
// 用户活跃时，刷新该用户所有实例的活跃时间
private touchUserInstances(userId: string): void {
  const now = Date.now()
  for (const inst of this.instances.values()) {
    if (inst.userId === userId && inst.status === 'running') {
      inst.lastActivity = now
    }
  }
}
```

### 4.5 会话归属与可见性

会话通过 `working_dir` 字段判断归属用户：

```typescript
// gateway/src/user-registry.ts:19-22
export function extractUserFromWorkingDir(workingDir: string): string {
  const match = workingDir.match(/\/users\/([^/]+)/)
  return match ? match[1] : SYSTEM_USER  // 无 /users/ 前缀则归属 sys
}
```

会话列表聚合逻辑：

```typescript
// gateway/src/index.ts:220-259（简化）
// GET /sessions - 聚合多实例查询
for (const agent of config.agents) {
  // 查询用户实例（如有运行）
  const userTarget = manager.getTarget(agent.id, userId)
  if (userTarget) {
    sessions.push(...(await fetch(userTarget + '/sessions')))
  }
  // 查询 sys 实例（获取共享/定时任务会话）
  const sysTarget = manager.getTarget(agent.id, SYSTEM_USER)
  if (sysTarget) {
    sessions.push(...(await fetch(sysTarget + '/sessions')))
  }
}

// 过滤：用户只能看到自己的会话 + sys 共享会话
sessions.filter(s => {
  const owner = extractUserFromWorkingDir(s.working_dir)
  return owner === userId || owner === SYSTEM_USER
})
```

### 4.6 后台预热

当用户首次激活某个 Agent 时，Gateway 会在后台自动预热该用户的所有其他 Agent，避免后续切换时的冷启动等待：

```typescript
// gateway/src/instance-manager.ts:112-136
private warmUpUserInstances(userId: string, excludeAgentId: string): void {
  if (this.warmingUsers.has(userId)) return  // 防止重复预热

  const otherAgents = this.config.agents.filter(a => a.id !== excludeAgentId)
  console.log(`[warm-up] Pre-warming ${otherAgents.length} agent(s) for user ${userId}`)

  // Fire-and-forget
  Promise.allSettled(
    otherAgents.map(agent => this.getOrSpawn(agent.id, userId))
  ).then(results => {
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      console.warn(`[warm-up] ${failed} agent(s) failed to warm up for user ${userId}`)
    }
  })
}
```

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

1. Gateway 使用内置 multipart 解析器（`multipart.ts`）解析请求体
2. 文件名清理：去除路径分隔符和特殊字符，添加时间戳前缀
3. 文件类型白名单校验（扩展名检查，支持代码、文档、图片、压缩包等常见格式）
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

Gateway 的 `/reply` 路由在转发请求到 goosed 之前，通过 ReplyPipeline 执行一系列 Request Hooks：

```
用户消息 → [body-limit] → [file-attachment] → [vision-preprocess] → goosed
              |               |                    |
              v               v                    v
          请求体过大?      文件路径合法?         图片处理模式?
          → 413 拒绝      → 403/404 拒绝       → off: 400 拒绝
                                                → passthrough: 放行
                                                → preprocess: 转文字
```

**Hook 详解：**

| Hook | 文件 | 职责 |
|------|------|------|
| `body-limit` | `hooks/body-limit.ts` | 检查请求体大小，超过限制（含 base64 膨胀余量）返回 413 |
| `file-attachment` | `hooks/file-attachment.ts` | 校验消息中引用的上传文件路径在合法范围内 |
| `vision-preprocess` | `hooks/vision-preprocess.ts` | 根据 vision mode 处理图片（拒绝/放行/调 API 转文字） |

**Pipeline 核心接口** (`gateway/src/hooks.ts`)：

```typescript
interface HookContext {
  req: http.IncomingMessage
  res: http.ServerResponse
  agentId: string
  userId: string
  agentConfig: Record<string, unknown>  // 完整的 agent 配置（config.yaml + secrets.yaml）
  body: Record<string, unknown>         // 解析后的请求体（hooks 可修改）
  bodyStr: string                       // 序列化后的请求体（hooks 完成后自动同步）
  state: Map<string, unknown>           // hooks 间共享状态
}

class ReplyPipeline {
  onRequest(name: string, fn: RequestHook): void
  onResponse(name: string, fn: ResponseHook): void
  async runRequestHooks(ctx: HookContext): Promise<boolean>   // false = 已短路终止
  async runResponseHooks(ctx: HookContext, upstream: Response): Promise<void>
}
```

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
  | 3. ReplyPipeline.runRequestHooks()
  |    ├── body-limit: 大小检查
  |    ├── file-attachment: 路径检查
  |    └── vision-preprocess:
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
├── gateway/                       # 网关服务
│   ├── config/
│   │   └── agents.yaml            # Agent 注册表 + OnlyOffice 配置
│   ├── src/
│   │   ├── index.ts               # HTTP 服务器主入口（含文件上传路由）
│   │   ├── instance-manager.ts    # 多用户实例管理
│   │   ├── config.ts              # 配置加载（含 upload/vision 配置）
│   │   ├── file-server.ts         # 文件服务
│   │   ├── user-registry.ts       # 会话归属缓存
│   │   ├── hooks.ts               # ReplyPipeline Hook 链机制
│   │   ├── multipart.ts           # multipart/form-data 解析器
│   │   └── hooks/                 # 内置 Request Hooks
│   │       ├── body-limit.ts      # 请求体大小限制
│   │       ├── file-attachment.ts # 上传文件路径校验
│   │       └── vision-preprocess.ts # 图片预处理 Hook
│   └── package.json
│
├── web-app/                       # 前端应用
│   ├── src/
│   │   ├── App.tsx                # 根组件 + 路由
│   │   ├── contexts/              # React Context 状态管理
│   │   │   ├── GoosedContext.tsx   # Agent 客户端管理
│   │   │   ├── UserContext.tsx     # 用户认证
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
├── agents/                        # Agent 配置（共享模板）
│   ├── universal-agent/
│   ├── kb-agent/
│   └── report-agent/
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
└── users/                         # 用户运行时目录（自动生成）
    ├── sys/
    ├── alice/
    │   └── agents/
    │       └── universal-agent/
    │           ├── config -> (symlink)
    │           ├── data/
    │           ├── state/
    │           └── uploads/       # 上传文件（按 session 分目录）
    │               └── {sessionId}/
    │                   └── {timestamp}_{filename}
    └── bob/
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
3. Gateway (Node.js)
   npx tsx gateway/src/index.ts
   等待 /status 就绪
   --> 自动 spawn sys 用户的所有 Agent 实例
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
| `IDLE_TIMEOUT_MS` | `900000` (15min) | 用户实例空闲超时 |
| `MAX_UPLOAD_FILE_SIZE_MB` | `10` | 单个上传文件大小上限（MB） |
| `MAX_UPLOAD_IMAGE_SIZE_MB` | `5` | 单个上传图片大小上限（MB） |
| `UPLOAD_RETENTION_HOURS` | `24` | 上传文件兜底清理时间（小时） |
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
| **无进程数限制** | 中 | 用户数 * Agent 数 = 进程数，没有上限控制，大量并发用户可能耗尽系统资源 |

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
| **无用户管理** | 没有用户注册、角色权限、管理员后台等功能，任何人输入用户名即可使用 |
| **定时任务管理不完整** | 定时任务依赖 goosed 内置的 Recipe/Schedule 机制，但 UI 上的管理体验较粗糙 |
| **文件上传已实现但功能有限** | 支持通过聊天输入框上传图片（base64 内联）和文件（multipart 上传），但缺少独立的文件管理界面和批量上传能力 |
| **Agent 配置热更新受限** | 修改 `AGENTS.md`（Prompt）可以通过 API 更新，但 `config.yaml` 修改需要重启 Agent 进程 |
| **MCP 扩展依赖 Feishu Token 手动刷新** | KB Agent 的飞书 MCP 集成依赖 `USER_ACCESS_TOKEN`，需要每约 2 小时手动刷新，影响生产可用性 |

### 9.5 工程实践

| 问题 | 说明 |
|------|------|
| **无 monorepo 工具** | 三个包（gateway、web-app、typescript-sdk）各自独立，没有 npm workspaces/turborepo/nx 统一管理，安装和构建需分别操作 |
| **测试覆盖不足** | 集成测试覆盖了主要路由，但 Web App 的单元测试极少；缺少对多用户并发场景的压力测试 |
| **日志缺乏结构化** | 全部使用 `console.log/error`，没有日志级别控制、结构化输出或日志收集方案 |
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
2. 增加进程数上限和资源管控
3. 实现 goosed 进程异常退出后的自动重启
4. 引入结构化日志（如 pino/winston）

**P2（中期优化）：**
1. 引入 monorepo 工具统一依赖管理
2. 建立 CI/CD 流水线
3. 增加 Web App 单元测试覆盖率
4. 考虑引入 Redis 或消息队列实现跨机器扩展的可能性
5. 飞书 MCP Token 自动刷新机制

**P3（长期演进）：**
1. 容器化部署（每个 goosed 实例运行在独立容器中）
2. 实现 Agent 配置热更新（无需重启进程）
3. 引入 RBAC 权限模型
4. 考虑 WebSocket 替代 SSE 以支持双向通信
