# Knowledge Service MCP 技术文档

## 1. 文档目标

本文档说明 `qa-agent` 中 `knowledge-service` MCP 的真实实现、注册方式、工具定义、默认行为和使用约束。

这份 MCP 不是独立平台服务，而是 `qa-agent` 的一个本地 stdio extension，用于把 `knowledge-service` 的检索能力暴露给 Agent。

## 2. 定位

`knowledge-service` MCP 的定位是：

- 为 QA Agent 提供受控的 RAG 工具入口
- 把复杂的 HTTP 检索接口收敛成少量稳定工具
- 限制 Agent 只执行“检索候选”和“抓取证据”这两类动作

这套 MCP 当前只暴露两个工具：

- `search`
- `fetch`

它刻意不暴露写操作，因此 QA Agent 无法通过 MCP 修改知识库内容。

## 2.1 结构图

```text
+-----------+        stdio/MCP        +------------------------+
| QA Agent  | <---------------------> | knowledge-service MCP  |
+-----+-----+                         | - search               |
      |                               | - fetch                |
      |                               +-----------+------------+
      |                                           |
      | HTTP wrapper                              | HTTP
      v                                           v
                                  +-------------------------------+
                                  | knowledge-service             |
                                  | /search /fetch                |
                                  +-------------------------------+
```

## 3. 所在位置

实现位于：

- `gateway/agents/qa-agent/config/mcp/knowledge-service/src/index.ts`
- `gateway/agents/qa-agent/config/mcp/knowledge-service/src/handlers.ts`

注册配置位于：

- `gateway/agents/qa-agent/config/config.yaml`

说明文档位于：

- `gateway/agents/qa-agent/config/mcp/knowledge-service/README.md`

## 4. 注册与启动方式

### 4.1 扩展注册

在 `qa-agent` 配置中，`knowledge-service` 以 stdio 扩展形式注册：

- `type: stdio`
- `cmd: node`
- 启动脚本：`config/mcp/knowledge-service/node_modules/tsx/dist/cli.mjs`
- 入口：`config/mcp/knowledge-service/src/index.ts`

这意味着：

- MCP 服务不是常驻独立守护进程
- 它跟随 Agent 运行环境启动
- 工具调用时再经由 stdio 和 Agent 框架通信

### 4.2 启用状态

在 `gateway/agents/qa-agent/config/config.yaml` 中，`knowledge-service` 是启用状态：

- `enabled: true`

因此它是 QA Agent 默认可用的核心扩展之一。

### 4.3 启动关系图

```text
qa-agent process
    |
    +-- read config.yaml
    |
    +-- start stdio extension: knowledge-service
            |
            +-- node tsx src/index.ts
                    |
                    +-- register tools: search, fetch
```

## 5. 环境变量与默认值

### 5.1 必需配置

MCP 依赖以下环境变量：

- `KNOWLEDGE_SERVICE_URL`
- `KNOWLEDGE_DEFAULT_SOURCE_ID`

这些值通常由 `gateway/agents/qa-agent/config/secrets.yaml` 注入。

### 5.2 可选配置

- `KNOWLEDGE_REQUEST_TIMEOUT_MS`

### 5.3 代码级默认值

`handlers.ts` 中定义了以下默认值：

- `KNOWLEDGE_SERVICE_URL = http://127.0.0.1:8092`
- `KNOWLEDGE_DEFAULT_SOURCE_ID = src_ac8da09a7cfd`
- `KNOWLEDGE_REQUEST_TIMEOUT_MS = 15000`
- `KNOWLEDGE_FETCH_MAX_NEIGHBOR_WINDOW = 2`

这些默认值的意义是：

- 本地联调时即使未注入完整环境，也能直接启动
- QA Agent 默认绑定一个知识源，不要求每次检索都显式传 `sourceIds`
- `fetch` 的邻居扩展被刻意限制在很小窗口内，避免 Agent 一次抓取过多上下文

## 6. 工具设计

```text
MCP tools
   |
   +-- search --> POST /ops-knowledge/search
   |
   +-- fetch  --> GET  /ops-knowledge/fetch/{chunkId}
```

## 6.1 `search`

```text
search(query, sourceIds?, documentIds?, topK?)
              |
              v
 normalizeSourceIds()
              |
              v
 POST /ops-knowledge/search
              |
              v
   JSON string response
```

### 输入参数

- `query: string`
- `sourceIds?: string[]`
- `documentIds?: string[]`
- `topK?: number`

参数约束：

- `query` 必填
- `topK` 范围为 `1 ~ 20`
- 未传 `topK` 时默认取 `8`

### 底层映射

MCP `search` 会映射到：

- `POST /ops-knowledge/search`

请求体结构：

```json
{
  "query": "用户问题改写后的检索词",
  "sourceIds": ["默认或显式 sourceId"],
  "documentIds": [],
  "topK": 8
}
```

### 默认 source 路径

`sourceIds` 的处理逻辑是：

1. 如果调用者传了非空 `sourceIds`，使用调用者提供的值
2. 如果未传或为空，回退为 `KNOWLEDGE_DEFAULT_SOURCE_ID`
3. 如果默认 source 也为空，则传空数组给后端

这条路径非常关键，因为 QA Agent 的默认问答通常依赖单一知识库。

### 返回结构

返回的是 `knowledge-service` 原始 search 结果的 JSON 字符串，关键字段包括：

- `chunkId`
- `documentId`
- `sourceId`
- `title`
- `titlePath`
- `snippet`
- `score`
- `lexicalScore`
- `semanticScore`
- `fusionScore`
- `pageFrom`
- `pageTo`

### 适用场景

- 检索候选 chunk
- 判断首轮命中质量
- 为下一步 `fetch` 选择最有希望的 chunk

## 6.2 `fetch`

```text
fetch(chunkId, includeNeighbors?, neighborWindow?)
              |
              v
 validate neighborWindow in [1,2]
              |
              v
 GET /ops-knowledge/fetch/{chunkId}
   ?includeNeighbors=...
   &neighborWindow=...
   &includeMarkdown=true
   &includeRawText=true
              |
              v
   JSON string response
```

### 输入参数

- `chunkId: string`
- `includeNeighbors?: boolean`
- `neighborWindow?: number`

参数约束：

- `chunkId` 必填
- `neighborWindow` 必须是整数
- `neighborWindow` 范围为 `1 ~ 2`
- 未传 `neighborWindow` 时默认取 `1`

### 底层映射

MCP `fetch` 会映射到：

- `GET /ops-knowledge/fetch/{chunkId}`

请求参数固定包含：

- `includeNeighbors`
- `neighborWindow`
- `includeMarkdown=true`
- `includeRawText=true`

### 返回结构

关键字段包括：

- `chunkId`
- `documentId`
- `sourceId`
- `title`
- `titlePath`
- `text`
- `markdown`
- `keywords`
- `pageFrom`
- `pageTo`
- `previousChunkId`
- `nextChunkId`
- `neighbors`

### 默认抓取路径

MCP 侧默认只抓单个 chunk，不自动展开大范围上下文：

- `includeNeighbors` 不传时为 `false`
- `neighborWindow` 默认是 `1`
- 即使调用者想扩上下文，也最多扩 `2` 个邻居窗口

这条限制是为了把 QA Agent 的取证行为控制在“最小必要证据”范围内。

## 7. 调用链路

从 QA Agent 视角看，MCP 的标准调用链路是：

1. Agent 先构造聚焦 query
2. 调 MCP `search`
3. 观察候选 chunk 的 `title`、`snippet`、`score`
4. 选择最有希望的一个或少数几个 chunk
5. 调 MCP `fetch`
6. 基于完整 chunk 内容生成带 citation 的答案

也就是说，这个 MCP 的设计目标不是“一步返回最终答案”，而是支撑 Agentic RAG 的两阶段检索。

### 7.1 时序图

```text
QA Agent          MCP handlers            knowledge-service
   |                   |                         |
   | search(...)       |                         |
   |------------------>| POST /search            |
   |                   |------------------------>|
   |                   |<------------------------|
   |<------------------| hits JSON               |
   | fetch(chunkId)    |                         |
   |------------------>| GET /fetch/{chunkId}    |
   |                   |------------------------>|
   |                   |<------------------------|
   |<------------------| chunk JSON              |
```

## 8. 为什么只暴露 `search` 和 `fetch`

当前实现没有直接暴露 `retrieve`，原因上更偏工程控制：

- `search + fetch` 更适合 Agent 自己决定证据是否充分
- Agent 可以做 query rewrite，而不被 `retrieve` 的固定封装束缚
- Agent 可以只抓最相关 chunk，避免一次性拉太多 evidence
- 这更符合 QA Agent 的“retrieval-first”工作流

换句话说，MCP 把“检索策略决策权”留给了 Agent，而不是把所有逻辑下沉到后端接口。

## 9. 错误处理与超时

### 9.0 错误路径图

```text
tool call
   |
   +-- bad args? -------- yes ---> throw local validation error
   |
   +-- no
   |
   +-- HTTP timeout? ---- yes ---> timeout error
   |
   +-- HTTP !ok ? ------- yes ---> "Knowledge service {path} returned ..."
   |
   +-- success ----------> return JSON string
```

### 9.1 超时

MCP 调用 HTTP 时使用 `AbortSignal.timeout(...)`，默认超时为 `15000ms`。

如果 `KNOWLEDGE_REQUEST_TIMEOUT_MS` 配置了新值，就使用该值。

### 9.2 HTTP 错误

当 `knowledge-service` 返回非 2xx 时，MCP 会：

1. 读取响应文本
2. 抛出错误
3. 错误格式类似：

```text
Knowledge service /ops-knowledge/search returned 500: ...
```

这保证 Agent 至少能知道是哪个底层接口失败，而不是只得到一个模糊错误。

### 9.3 参数错误

MCP 会在本地先拦住明显错误：

- 空 `query`
- 空 `chunkId`
- 非法 `neighborWindow`

这减少了对后端服务的无效调用。

## 10. 使用策略

当前 README 和 QA Agent 系统提示对 MCP 的使用策略是一致的：

- 优先 `search`
- 再 `fetch`
- 证据足够时停止检索
- 命中不足时改写 query 后重新 `search`
- 最终答案必须引用 chunk 级证据

这说明 MCP 本身不是“问答引擎”，只是受控的知识检索工具层。

## 11. 约束与边界

### 11.1 能做什么

- 在一个默认知识库或指定知识库中搜索候选 chunk
- 抓取完整 chunk 及少量相邻内容
- 为 QA Agent 提供 citation 所需的原始证据

### 11.2 不能做什么

- 不支持导入文档
- 不支持创建、编辑、删除 chunk
- 不支持 profile 管理
- 不支持直接触发 `retrieve`
- 不支持跨知识库的复杂编排逻辑

### 11.3 当前实现限制

- 返回结果是 JSON 字符串，Agent 需要自行理解和消费
- 默认 source 只有一个，不适合天然多知识域混检
- `fetch` 邻居窗口上限仅为 `2`
- 仍然依赖后端 `knowledge-service` 的 availability 和索引质量

## 12. 结论

`knowledge-service` MCP 是 QA Agent 的受控 RAG 工具层，它把底层 HTTP 检索接口收敛成两个稳定动作：

- `search` 负责召回候选
- `fetch` 负责获取证据

它的设计重点不是功能多，而是边界清晰、默认路径稳定、便于 Agent 执行“先检索、再取证、最后回答”的工作流。
