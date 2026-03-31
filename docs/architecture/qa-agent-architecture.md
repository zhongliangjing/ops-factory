# QA Agent 技术文档

## 1. 文档目标

本文档说明 Ops Factory 中 `QA Agent` 的技术架构、运行方式、提示词约束、与 `knowledge-service` MCP 的协作模型，以及它如何执行 Agentic RAG。

本文档描述的是仓库当前实现的 `gateway/agents/qa-agent`。

## 2. 定位

`QA Agent` 是知识库问答智能体，职责非常聚焦：

- 面向知识库问答场景回答用户问题
- 通过 `knowledge-service` 做检索式问答
- 输出带 chunk 级 citation 的简洁答案

它不是通用运维 Agent，也不是写库 Agent。它的主价值是：

- 把“检索什么、何时改写 query、何时 fetch 证据、何时停止”这些决策交给 Agent
- 但把知识访问范围严格约束在受控 MCP 工具内

## 2.1 架构图

```text
+-------------+      uses       +------------------------+      HTTP      +-------------------+
| User        | --------------> | QA Agent               | -------------> | knowledge-service |
+-------------+                 | - query planning       |                +-------------------+
                                | - rewrite              ^
                                | - evidence judgment    |
                                +-----------+------------+
                                            |
                                            | MCP tools
                                            v
                                +------------------------+
                                | knowledge-service MCP  |
                                | - search               |
                                | - fetch                |
                                +------------------------+
```

## 3. 目录结构

关键文件如下：

- `gateway/agents/qa-agent/AGENTS.md`
- `gateway/agents/qa-agent/config/config.yaml`
- `gateway/agents/qa-agent/config/prompts/system.md`
- `gateway/agents/qa-agent/config/mcp/knowledge-service/...`
- `gateway/agents/qa-agent/config/secrets.yaml`

## 4. 运行配置

### 4.1 模型与推理参数

当前配置位于 `config/config.yaml`：

- `GOOSE_PROVIDER: custom_qwen3.5-27b`
- `GOOSE_MODEL: qwen/qwen3.5-27b`
- `GOOSE_MODE: auto`
- `GOOSE_CONTEXT_LIMIT: 65536`
- `GOOSE_MAX_TOKENS: 4096`
- `GOOSE_TEMPERATURE: 0.2`
- `GOOSE_CONTEXT_STRATEGY: summarize`
- `GOOSE_AUTO_COMPACT_THRESHOLD: 0.8`
- `GOOSE_MAX_TURNS: 50`

这组配置体现了 QA Agent 的工程取向：

- 低温度，降低事实漂移
- 大上下文，容纳多轮检索与引用
- 自动压缩上下文，减少多轮问答时的上下文膨胀
- 最大轮数受控，避免无限搜索

### 4.2 启用的扩展

默认启用的核心扩展是：

- `todo`
- `summon`
- `knowledge-service`

其中真正服务问答闭环的核心扩展是 `knowledge-service`。

系统提示词还要求 QA Agent 忽略无关工具，只使用：

- `knowledge-service__search`
- `knowledge-service__fetch`

这说明工具边界不是靠“可见性”控制，而是靠系统提示词做强约束。

### 4.3 运行组件图

```text
qa-agent runtime
   |
   +-- model config
   |    - qwen3.5-27b
   |    - temp 0.2
   |    - max turns 50
   |
   +-- system prompt
   |    - retrieval-first
   |    - citation required
   |
   +-- enabled extensions
        - todo
        - summon
        - knowledge-service
```

## 5. 角色边界

### 5.1 必须做的事

- 理解用户问题
- 拆解子问题
- 生成聚焦检索 query
- 先检索后回答
- 必要时改写 query 再检索
- 对最有希望的 chunk 做 `fetch`
- 只基于已检索证据作答
- 为每个事实性句子补 citation

### 5.2 不能做的事

- 不能直接凭参数化知识作答
- 不能在证据不足时编造事实
- 不能修改知识库内容
- 不能使用非 `knowledge-service` 的工具替代证据来源

## 6. 提示词架构

QA Agent 的行为约束主要来自两层：

### 6.1 `AGENTS.md`

这里定义了角色、可用工具、工作流和 guardrails，属于简化版操作说明。

### 6.2 `config/prompts/system.md`

这是更严格的系统提示词，约束包括：

- QA Agent 是 `retrieval-first` agent
- 必须先 `search`
- 只在有希望的 chunk 上做 `fetch`
- 命中不足时要改写 query
- 证据足够时停止继续检索
- 每个事实句必须带 citation

因此它不是“搜一下再回答”的弱约束，而是明确规定了完整检索工作流。

## 7. Agentic RAG 工作流

## 7.1 标准主路径

```text
understand question
       |
       v
build focused query
       |
       v
search knowledge chunks
       |
       v
results sufficient?
   | yes                  | no
   v                      v
fetch best chunk      rewrite query
   |                      |
   v                      |
answer with cite <--------+
```

QA Agent 的标准主路径如下：

1. 理解问题
2. 判断是否包含多个子问题、限定条件、实体名或术语别名
3. 构造短而聚焦的 query
4. 调 `knowledge-service__search`
5. 观察 `title`、`snippet`、排序与页码信息
6. 命中不足时改写 query 再检索
7. 对最有希望的 chunk 调 `knowledge-service__fetch`
8. 基于完整 chunk 生成答案
9. 为每个事实句添加 citation

### 7.2 Query 改写策略

系统提示词要求它在以下情况下改写 query：

- 首轮命中弱相关
- snippet 不完整
- 检索词过于宽泛
- 用户问题带有口语化表达

可采用的改写方向：

- 更小范围的子问题
- 领域术语
- 别名
- 产品名
- 缩写
- 操作名称

这意味着 QA Agent 不是直接把整句用户问题丢给搜索接口，而是要主动做 query planning。

### 7.3 何时 `fetch`

`fetch` 不是对所有命中统一执行，而是只对“promising evidence”执行。

判断标准主要包括：

- 标题是否高度相关
- snippet 是否已经显式包含答案线索
- 命中排序是否靠前
- 当前 chunk 是否足以支撑回答

如果 chunk 内容不完整，允许进一步抓相邻 chunk，但默认只抓最少必要上下文。

### 7.4 停止条件

QA Agent 必须在证据足够时停止检索，不能无限扩大搜索范围。

停止条件通常是：

- 已经拿到回答所需关键事实
- 引用链路完整
- 多轮检索后新增信息很少

如果多轮检索后仍证据不足，必须明确说明“无法从已检索知识中确认”。

### 7.5 问答时序图

```text
User            QA Agent             MCP                knowledge-service
 |                 |                  |                         |
 | ask question    |                  |                         |
 |---------------->| plan query       |                         |
 |                 | search           |                         |
 |                 |----------------->| POST /search            |
 |                 |                  |------------------------>|
 |                 |                  |<------------------------|
 |                 | inspect hits     |                         |
 |                 | fetch best hit   |                         |
 |                 |----------------->| GET /fetch/{chunkId}    |
 |                 |                  |------------------------>|
 |                 |                  |<------------------------|
 |                 | answer+citation  |                         |
 |<----------------|                  |                         |
```

## 8. 与 Knowledge Service MCP 的协作

### 8.1 协作方式

QA Agent 不直接调用 `knowledge-service` HTTP API，而是通过 MCP 暴露的两个工具：

- `knowledge-service__search`
- `knowledge-service__fetch`

这意味着系统架构上有一层明显的职责拆分：

- Agent 负责检索决策
- MCP 负责工具封装
- knowledge-service 负责知识存储和检索执行

### 8.1.1 职责分工图

```text
QA Agent
  - decide query
  - decide rewrite
  - decide sufficiency
  - compose answer

MCP
  - validate args
  - normalize defaults
  - call HTTP API
  - return tool payload

knowledge-service
  - index/search/fetch
  - profile/default resolution
  - chunk/document/source storage
```

### 8.2 为什么不直接用 `/retrieve`

当前架构故意没有让 QA Agent 直接依赖 `/retrieve`，主要原因是：

- QA Agent 要自己决定是否改写 query
- QA Agent 要自己判断哪条 chunk 值得 fetch
- QA Agent 要自己控制证据充分性
- 这样更符合 agentic retrieval，而不是后端一次性包办

## 9. Citation 机制

### 9.1 强约束格式

系统提示词规定 citation 必须使用：

`{{cite:INDEX|TITLE|CHUNK_ID|SOURCE_ID|PAGE_LABEL|SNIPPET|URL}}`

并且要求：

- 每个事实句末尾都必须带 citation
- 同一 chunk 可复用同一 index
- 一句话依赖多个 chunk 时可附多个 citation
- 不能使用 `[[chunk_id]]`
- 不能使用 `[1]`
- 不能使用脚注式格式

### 9.2 设计目的

这套 citation 约束有两个作用：

- 让回答能回溯到 chunk 级证据
- 让前端或消费方有机会把 citation 渲染成可悬浮预览的结构化引用

因此 citation 不是装饰，而是 QA Agent 输出协议的一部分。

## 10. 默认行为与关键缺省路径

### 10.1 默认语言

默认使用中文回答，除非用户显式使用其他语言。

### 10.2 默认知识源

如果 Agent 没有显式传 `sourceIds`，MCP 会回退到配置中的 `KNOWLEDGE_DEFAULT_SOURCE_ID`。

这意味着 QA Agent 当前默认服务于一个主知识库，而不是自动做多知识库路由。

### 10.4 缺省路径图

```text
user question
    |
    v
search without sourceIds?
    |
 +--+--+
 | yes |------------------------------+
 +--+--+                              |
    |                                 |
    v                                 |
use KNOWLEDGE_DEFAULT_SOURCE_ID       |
    |                                 |
    +---------------> search ---------+
                      |
                      v
               fetch top evidence
                      |
                      v
              answer with citation
```

### 10.3 默认证据路径

默认主路径是：

1. `search`
2. 选最相关命中
3. `fetch`
4. 回答

而不是：

1. 搜索所有文档
2. 拉大量全文
3. 再在本地做重排

所以它更像“精简取证型 Agent”，而不是“大规模全文装载型 Agent”。

## 11. 适用场景

QA Agent 最适合以下场景：

- 知识库事实问答
- 部署文档、运行手册、故障报告等文档检索问答
- 需要引用来源 chunk 的回答
- 对“先检索再回答”有严格要求的场景

不适合的场景：

- 需要调用外部系统实时数据
- 需要修改知识内容
- 需要复杂多工具编排
- 需要跨多个异构数据源自动融合推理

## 12. 当前实现限制

- 工具层只提供 `search` 和 `fetch`，能力边界清晰但较窄
- 默认 source 单一，不包含复杂知识路由
- 回答质量高度依赖检索结果和 chunk 质量
- citation 协议较严格，输出端必须遵守
- 如果知识库证据本身不足，QA Agent 只能明确告知不能确认，不能补全推断

## 13. 技术总结

QA Agent 的技术路线可以概括为：

- 用受控 MCP 限制知识访问面
- 用严格系统提示词约束检索顺序和引用协议
- 把 query planning、query rewrite、evidence sufficiency judgement 保留在 Agent 内部
- 把知识检索执行下沉到 `knowledge-service`

因此，QA Agent 不是一个“通用大模型聊天壳”，而是一套围绕知识库问答场景专门收窄过能力边界的 Agent 架构。
