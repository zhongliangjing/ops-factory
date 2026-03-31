# Knowledge Service 技术架构文档

## 1. 文档目标

本文档说明 `knowledge-service` 在 Ops Factory 中的实际技术架构，覆盖：

- 前端管理与检索测试链路
- 后端服务分层、数据模型与存储
- 文档导入、切块、索引、检索、召回的完整路径
- 检索参数的默认解析、回退与关键缺省路径
- 对外接口列表与推荐使用方式

本文以仓库当前实现为准。凡是“接口已经暴露但运行时尚未完全消费”的能力，会单独标注。

## 2. 定位与边界

`knowledge-service` 是独立的知识入库、切块、索引和检索服务，负责：

- `source` 级知识库管理
- 文档导入与转换产物管理
- `chunk` 生成、编辑、删除、重排
- 词法检索、向量检索、混合检索
- `fetch` / `retrieve` / `explain`
- index profile / retrieval profile 及其与 source 的绑定

不负责的内容：

- 浏览器侧统一鉴权与租户隔离
- 前端绕过网关访问的放开策略
- LLM 最终问答编排本身，这部分由 Agent 或上层编排服务承担

## 3. 总体架构

### 3.0 架构总览图

```text
+------------------------+          +---------------------------+
| web-app                |          | Agent / Orchestrator      |
| - Knowledge            |          | - QA Agent                |
| - KnowledgeConfigure   |          | - Other backend callers   |
| - RetrievalTab         |          +-------------+-------------+
+-----------+------------+                        |
            | HTTP                                     HTTP
            v                                          v
                +-----------------------------------+
                | knowledge-service                 |
                |-----------------------------------|
                | Controller                        |
                | KnowledgeServiceFacade            |
                | Search / Chunking / Embedding     |
                | LexicalIndex / VectorIndex        |
                +---------+---------------+---------+
                          |               |
              +-----------+---+       +---+-------------------+
              | DB / Meta     |       | Runtime Storage       |
              | source/doc/...|       | upload/artifacts/index|
              +---------------+       +-----------------------+
```

### 3.1 架构分层

1. 前端 `web-app`
   - 知识库列表页：`web-app/src/pages/Knowledge.tsx`
   - 知识库配置页：`web-app/src/pages/KnowledgeConfigure.tsx`
   - 检索测试页签：`web-app/src/components/knowledge/KnowledgeRetrievalTab.tsx`

2. 后端控制层
   - `SourceController`
   - `DocumentController`
   - `ChunkController`
   - `RetrievalController`
   - `ProfileController`
   - `JobController`
   - `SystemController`
   - `StatsController`

3. 后端编排层
   - `KnowledgeServiceFacade`
   - 负责把 source/document/chunk/profile/retrieval 的业务流程串起来

4. 核心能力层
   - `ChunkingService`
   - `EmbeddingService`
   - `LexicalIndexService`
   - `VectorIndexService`
   - `SearchService`

5. 持久化与运行时存储
   - 元数据库：SQLite 或 PostgreSQL
   - 原始文件目录
   - Markdown artifact 目录
   - Lucene lexical index
   - Lucene vector index

### 3.2 核心对象

- `Source`：知识库逻辑隔离单元，也是前端管理的主对象
- `Document`：导入后的文档实体
- `Chunk`：检索最小工作单元
- `Profile`：索引参数或检索参数模板
- `Job`：重建、重索引等维护任务的运行态记录

## 4. 前端架构

### 4.1 页面结构

前端围绕既有知识库工作台模型组织，不新建独立视觉体系：

- 列表页 `Knowledge`
  - 展示 source 卡片、状态、统计信息
  - 支持创建和删除知识库

- 详情页 `KnowledgeConfigure`
  - `basic`：基础信息
  - `documents`：文档上传、文档列表、预览、artifact
  - `chunks`：chunk 浏览、编辑、删除、重排
  - `retrieval`：检索测试、compare、chunk 详情
  - `config`：profile/defaults/capabilities 展示与编辑
  - `maintenance`：重建、任务状态、失败信息

### 4.2 前端调用方式

当前前端运行时通过 `KNOWLEDGE_SERVICE_URL` 直接访问 `knowledge-service`。这满足本地开发和当前实现，但仓库约束仍建议生产由 `gateway` 统一代理与鉴权收口。

### 4.3 前端检索测试链路

`KnowledgeRetrievalTab` 是知识服务前端链路里最重要的运行态界面，承担三类能力：

- 单次检索测试：调用 `POST /ops-knowledge/search`
- 多模式对比：调用 `POST /ops-knowledge/search/compare`
- 命中详情展开：调用 `GET /ops-knowledge/fetch/{chunkId}`

这个页面还管理本地历史与缓存：

- 历史 query 保存在浏览器 `localStorage`
- compare 结果也做本地缓存
- 这些缓存只影响前端体验，不影响服务端检索状态

### 4.3.1 前端检索时序图

```text
User          RetrievalTab            knowledge-service
 |                 |                         |
 | open page       |                         |
 |---------------->| GET defaults/capability |
 |                 |------------------------>|
 |                 |<------------------------|
 | input query     |                         |
 |---------------->| POST /search            |
 |                 |------------------------>|
 |                 |<------------------------|
 | click hit       |                         |
 |---------------->| GET /fetch/{chunkId}    |
 |                 |------------------------>|
 |                 |<------------------------|
 | inspect detail  |                         |
```

### 4.4 前端默认路径

前端检索测试的默认路径是：

1. 读取当前 source 绑定的 retrieval profile
2. 读取系统 `capabilities` 和 `defaults`
3. 默认把检索方式展示为 `hybrid`
4. compare 固定拉取三种模式：`hybrid` / `semantic` / `lexical`
5. 单次命中后，再对某个候选 chunk 调 `fetch`

前端不会修改 source 绑定关系，除非用户显式在配置页中更新 profile 或 binding。

## 5. 后端架构

### 5.0 后端组件关系图

```text
+-------------------------+
| RetrievalController     |
| Source/Doc/Chunk/...    |
+-----------+-------------+
            |
            v
+-------------------------+
| KnowledgeServiceFacade  |
| - resolve profile       |
| - resolve defaults      |
| - filter chunks         |
| - orchestrate response  |
+-----+---------+---------+
      |         |
      |         +-----------------------------+
      v                                       v
+-------------+                    +----------------------+
| SearchService|                   | Chunk/Doc/Source Repo|
+------+------+                   +----------------------+
       |
   +---+-------------------+
   |                       |
   v                       v
+----------+         +---------------+
| Lexical  |         | VectorIndex   |
| BM25     |         | KNN + embed   |
+----------+         +-------+-------+
                               |
                               v
                        +-------------+
                        | Embedding   |
                        +-------------+
```

### 5.1 运行与存储

服务启动时会加载：

- `src/main/resources/application.yaml`
- 运行目录下的 `./config.yaml`

默认运行目录为 `knowledge.runtime.base-dir=./data`，通常包含：

- `upload/<sourceId>/<documentId>/original/`
- `artifacts/<sourceId>/<documentId>/content.md`
- `indexes/`
- `meta/knowledge.db`

数据库迁移使用 Flyway，在 `db/migration/common` 下维护版本链。

### 5.2 索引结构

当前实现是双索引架构：

- 词法索引：`LexicalIndexService`
  - 基于 Lucene
  - 按 source 拆分 index
  - 使用 BM25
  - 对 title / titlePath / keywords / text 做不同权重加权

- 向量索引：`VectorIndexService`
  - 基于 Lucene KNN vector
  - 向量存储在 `indexes/vectors/`
  - 依赖 `EmbeddingService` 生成 query embedding 和 chunk embedding

### 5.3 编排中心

`KnowledgeServiceFacade` 是服务的主编排层，负责：

- 校验 source 可读性
- 选择 retrieval profile
- 解析 defaults/profile/override
- 过滤 chunk 集合
- 调用 `SearchService`
- 组装 `search` / `compare` / `fetch` / `retrieve` 的返回结构

也就是说，真正的“关键缺省路径”不在 Controller，而在 `KnowledgeServiceFacade`。

## 6. 入库与索引链路

### 6.1 文档导入主路径

主路径如下：

1. 创建 `source`
2. 调用 `POST /ops-knowledge/sources/{sourceId}/documents:ingest`
3. 原始文件写入 `upload/.../original/`
4. 转换引擎把原件转换为文本和 markdown artifact
5. `ChunkingService` 生成 chunk 草稿
6. 抽取标题、关键词、页码等元数据
7. chunk 写入数据库
8. lexical index 与 vector index upsert
9. 文档进入可检索状态

### 6.1.1 入库时序图

```text
Client      DocumentController   Facade      Converter/Chunking     Storage/Index
  |                 |              |                 |                    |
  | ingest files    |              |                 |                    |
  |---------------->|              |                 |                    |
  |                 |------------->| save original   |                    |
  |                 |              |---------------->|                    |
  |                 |              | convert         |                    |
  |                 |              |---------------->|                    |
  |                 |              | chunk           |                    |
  |                 |              |---------------->|                    |
  |                 |              | persist chunks  |------------------->|
  |                 |              | build indexes   |------------------->|
  |                 |<-------------| done            |                    |
  |<----------------|              |                 |                    |
```

### 6.2 切块默认策略

切块相关默认参数来自 `ops-knowledge.chunking`，关键参数包括：

- `mode`
- `targetTokens`
- `overlapTokens`
- `respectHeadings`
- `keepTablesWhole`
- `splitLongParagraphs`
- `mergeShortParagraphs`
- `minChunkTokens`
- `maxChunkTokens`

实际含义是：尽量保留文档结构，避免标题、表格和短段落在切块时被破坏得过于碎片化。

### 6.3 索引默认策略

词法检索当前真实生效的默认字段权重是：

- `title = 4.0`
- `titlePath = 2.5`
- `keywords = 2.0`
- `text/content = 1.0`

这意味着：

- 标题命中优先级最高
- 层级标题其次
- 关键词摘要能显著提升召回
- 正文匹配是基础兜底路径

## 7. 检索与召回策略

### 7.1 检索模式

当前服务支持三种模式：

- `lexical`
- `semantic`
- `hybrid`

对应实现：

- `lexical`：只按 BM25 词法分数排序
- `semantic`：只按向量相似度排序
- `hybrid`：把 lexical 与 semantic 的候选集合做 RRF 融合

### 7.2 实际召回路径

### 7.2.0 检索模式关系图

```text
                +--------------------+
query --------->| SearchService      |
                +---------+----------+
                          |
      +-------------------+-------------------+
      |                   |                   |
      v                   v                   v
  lexical             semantic             hybrid
  BM25                vector KNN           lexical + semantic
  rank by score       rank by score        RRF fuse -> final rank
```

#### lexical 路径

1. 查询字符串 trim
2. 使用 query analyzer 分词
3. 在 source 对应 Lucene lexical index 中检索
4. 返回 lexical 命中集合
5. 按 `scoreThreshold` 过滤
6. 截断到 `finalTopK`

这是当前最稳定、最直接的召回路径。

#### semantic 路径

1. 生成 query embedding
2. 在 vector index 中做 KNN 检索
3. 返回 semantic 命中集合
4. 按 `scoreThreshold` 过滤
5. 截断到 `finalTopK`

注意：语义检索链路已接入真实实现，但部分 explain/高级参数仍不完整。

#### hybrid 路径

1. 分别执行 lexical 检索与 semantic 检索
2. 取两路候选集合并集
3. 分别计算 lexical rank 与 semantic rank
4. 使用 RRF 计算融合分数
5. 按融合分数倒序排序
6. 再以 semanticScore、lexicalScore 作为并列打破条件
7. 按 `scoreThreshold` 过滤
8. 截断到 `finalTopK`

当前 hybrid 的真实实现不是加权平均，而是 `RRF`。

### 7.2.1 Hybrid 排序图

```text
lexical hits                 semantic hits
[c1, c3, c5, ...]            [c3, c2, c1, ...]
      |                            |
      +------------+   +-----------+
                   v   v
             union candidate set
                   |
                   v
       score = 1/(rrfK+lex_rank) + 1/(rrfK+sem_rank)
                   |
                   v
          sort by fusionScore desc
                   |
                   v
                finalTopK
```

### 7.3 RRF 融合策略

当前 `hybrid` 使用 reciprocal rank fusion：

- lexical 某个命中的 rank 越靠前，贡献越高
- semantic 某个命中的 rank 越靠前，贡献越高
- 总分为两路 reciprocal rank 之和
- `rrfK` 越大，排名差异越被平滑

这条路径的特点是稳定、可解释、对分数标尺差异不敏感，适合作为默认混合召回策略。

### 7.4 默认检索路径

如果调用方没有显式指定 `mode`，系统默认会走 `hybrid`。

具体解析顺序：

1. 请求 `override.mode`
2. retrieval profile 中 `retrieval.mode`
3. 系统默认 `ops-knowledge.retrieval.mode`
4. 如果以上都没有，兜底为 `hybrid`

### 7.5 TopK 解析与缺省路径

检索时存在三组 `topK`：

- `request.topK` / `finalTopK`
- `lexicalTopK`
- `semanticTopK`

解析规则：

1. `finalTopK` 优先取请求中的 `topK`
2. 否则取 profile 中 `result.finalTopK`
3. 再否则取系统默认 `retrieval.finalTopK`
4. 如果 `finalTopK <= 0` 或大于 `maxTopK`，直接报错
5. `lexicalTopK` 与 `semanticTopK` 会被强制提升到不小于 `finalTopK`

这意味着，即使 profile 把某一路候选数配得很小，只要最终要返回更多结果，系统也会自动把候选召回数抬高，避免因为候选集过小导致最终结果不足。

### 7.6 Retrieval Profile 的关键缺省路径

```text
request.retrievalProfileId ?
        |
   +----+----+
   | yes     | no
   v         v
 use it   single source ?
              |
         +----+----+
         | yes     | no
         v         v
  source.bound RP  default RP
         |
         v
   if empty -> default RP
```

`search` 和 `compare` 调用时，retrieval profile 的选择逻辑为：

1. 如果请求显式传了 `retrievalProfileId`，优先使用它
2. 如果没有显式传，且 `sourceIds` 只有一个，则使用该 source 绑定的 retrieval profile
3. 如果 source 没绑 profile，则回退到系统默认 retrieval profile
4. 如果是多 source 检索，也直接回退到系统默认 retrieval profile

这就是当前系统最重要的“关键缺省路径”。

### 7.7 Search 参数解析优先级

运行时检索参数优先级为：

`override > retrieval profile > system defaults`

其中当前真正已经生效的核心参数包括：

- `mode`
- `lexicalTopK`
- `semanticTopK`
- `rrfK`
- `scoreThreshold`
- `snippetLength`
- `topK`

而 `includeScores`、`includeExplain` 等字段目前主要是接口预留。

### 7.8 Compare 的默认路径

`POST /ops-knowledge/search/compare` 的当前实现有两个显著特点：

- compare 固定用 `COMPARE_FETCH_TOP_K = 64` 拉取三种模式的原始候选
- 如果未指定 `modes`，默认比较 `hybrid`、`semantic`、`lexical`

因此 compare 更适合测试召回质量和排序差异，不适合作为线上业务正式检索接口。

### 7.9 Fetch 的默认路径

`fetch` 的职责不是召回，而是命中后取全文证据。

默认路径：

1. 根据 `chunkId` 读取 chunk
2. 可选读取同文档相邻 chunk
3. 返回 text / markdown / keywords / page refs / previous / next

当前约束：

- `neighborWindow` 必须大于 0
- 且不能超过 `ops-knowledge.fetch.max-neighbor-window`
- `includeMarkdown` 和 `includeRawText` 参数已暴露，但目前不会改变返回裁剪行为

### 7.10 Retrieve 的默认路径

`retrieve` 当前是一个轻量 RAG evidence 聚合器，真实执行路径非常明确：

1. 先调用内部 `search`
2. 遍历命中结果
3. 对每个命中执行 `fetch(chunkId, false, 1)`
4. 组装 `evidences`
5. 返回给上层 Agent/LLM

这意味着当前 `retrieve` 的默认行为是：

- 不扩展邻居 chunk
- 固定 `neighborWindow=1`，但因为 `includeNeighbors=false` 实际不会展开
- 返回内容以单 chunk 为主
- 更适合作为“轻量直接取证据”的接口，而不是复杂上下文编排器

另外，`RetrieveOverride` 中以下参数当前大多还是预留位：

- `expandContext`
- `expandMode`
- `neighborWindow`
- `maxEvidenceCount`
- `maxEvidenceTokens`
- `includeMetadata`
- `includeReferences`
- `includeExplain`

其中 `includeReferences` 当前会返回页码引用，但不是按 override 动态裁剪。

### 7.10.1 Retrieve 时序图

```text
Caller            Facade                Search                Fetch
  |                 |                     |                    |
  | POST /retrieve  |                     |                    |
  |---------------->| resolve settings    |                    |
  |                 |----search(query)--->|                    |
  |                 |<---hits-------------|                    |
  |                 |----fetch(hit1)-------------------------->|
  |                 |<---chunk1--------------------------------|
  |                 |----fetch(hit2)-------------------------->|
  |                 |<---chunk2--------------------------------|
  |                 | assemble evidences  |                    |
  |<----------------|                     |                    |
```

## 8. 接口列表

### 8.1 系统与配置

- `GET /ops-knowledge/capabilities`
  - 返回服务支持的 retrieval modes、chunk modes、analyzers、editable fields、feature flags

- `GET /ops-knowledge/system/defaults`
  - 返回当前系统生效的默认 ingest/chunking/retrieval/features 配置

### 8.2 Source

- `GET /ops-knowledge/sources`
- `POST /ops-knowledge/sources`
- `GET /ops-knowledge/sources/{sourceId}`
- `PATCH /ops-knowledge/sources/{sourceId}`
- `DELETE /ops-knowledge/sources/{sourceId}`
- `GET /ops-knowledge/sources/{sourceId}/stats`
- `POST /ops-knowledge/sources/{sourceId}:rebuild`
- `GET /ops-knowledge/sources/{sourceId}/maintenance`

适用场景：

- 知识库创建与管理
- source 级统计查看
- source 全量重建

### 8.3 Document

- `GET /ops-knowledge/documents`
- `POST /ops-knowledge/sources/{sourceId}/documents:ingest`
- `GET /ops-knowledge/documents/{documentId}`
- `PATCH /ops-knowledge/documents/{documentId}`
- `DELETE /ops-knowledge/documents/{documentId}`
- `GET /ops-knowledge/documents/{documentId}/chunks`
- `GET /ops-knowledge/documents/{documentId}/preview`
- `GET /ops-knowledge/documents/{documentId}/artifacts`
- `GET /ops-knowledge/documents/{documentId}/artifacts/markdown`
- `GET /ops-knowledge/documents/{documentId}/original`
- `POST /ops-knowledge/documents/{documentId}:rebuild`
- `POST /ops-knowledge/documents/{documentId}:reindex`
- `POST /ops-knowledge/documents/{documentId}:rechunk`
- `GET /ops-knowledge/documents/{documentId}/stats`

适用场景：

- 文档导入与追踪
- 预览与转换产物查看
- 单文档重建与重索引

### 8.4 Chunk

- `GET /ops-knowledge/chunks`
- `GET /ops-knowledge/chunks/{chunkId}`
- `POST /ops-knowledge/documents/{documentId}/chunks`
- `PATCH /ops-knowledge/chunks/{chunkId}`
- `PATCH /ops-knowledge/chunks/{chunkId}/keywords`
- `DELETE /ops-knowledge/chunks/{chunkId}`
- `POST /ops-knowledge/documents/{documentId}/chunks:reorder`
- `POST /ops-knowledge/chunks/{chunkId}:reindex`

适用场景：

- 管理台精细维护 chunk
- 调整关键词与顺序
- 编辑后立即影响后续检索

### 8.5 Retrieval

- `POST /ops-knowledge/search`
  - 用于先召回 chunk，再展示或进一步 `fetch`

- `POST /ops-knowledge/search/compare`
  - 用于比较三种检索模式的命中差异

- `GET /ops-knowledge/fetch/{chunkId}`
  - 用于按 chunkId 取全文和相邻 chunk

- `POST /ops-knowledge/retrieve`
  - 用于直接返回 evidence 列表给上层 RAG

- `POST /ops-knowledge/explain`
  - 用于解释 query 对某 chunk 的命中原因

### 8.6 Profile 与 Binding

- `GET /ops-knowledge/profiles/index`
- `POST /ops-knowledge/profiles/index`
- `GET /ops-knowledge/profiles/index/{profileId}`
- `PATCH /ops-knowledge/profiles/index/{profileId}`
- `DELETE /ops-knowledge/profiles/index/{profileId}`

- `GET /ops-knowledge/profiles/retrieval`
- `POST /ops-knowledge/profiles/retrieval`
- `GET /ops-knowledge/profiles/retrieval/{profileId}`
- `PATCH /ops-knowledge/profiles/retrieval/{profileId}`
- `DELETE /ops-knowledge/profiles/retrieval/{profileId}`

- `GET /ops-knowledge/profiles/bindings`
- `POST /ops-knowledge/profiles/bind`
- `PATCH /ops-knowledge/profiles/bindings/{sourceId}`

注意：

- profile `PATCH` 当前是浅合并
- 删除 profile 前必须先解除 source binding

### 8.7 Job 与统计

- `GET /ops-knowledge/jobs`
- `GET /ops-knowledge/jobs/{jobId}`
- `POST /ops-knowledge/jobs/{jobId}:cancel`
- `POST /ops-knowledge/jobs/{jobId}:retry`
- `GET /ops-knowledge/jobs/{jobId}/logs`
- `GET /ops-knowledge/jobs/{jobId}/failures`
- `GET /ops-knowledge/stats/overview`

## 9. 推荐接入方式

### 9.1 给前端管理台

推荐链路：

1. 初始化先调 `capabilities` 与 `system/defaults`
2. source 详情页按 tab 分批加载
3. 检索测试用 `search` / `search/compare` / `fetch`
4. 不把可编辑字段写死，优先信任 `capabilities`

### 9.2 给 Agent 或编排服务

推荐链路：

1. 已知 source 范围时，优先显式传 `sourceIds`
2. 如果要自己做重排，调用 `search + fetch`
3. 如果只需要快速拿证据，优先 `retrieve`
4. 如果命中解释很重要，再补 `explain`

### 9.3 给生产网关

推荐链路：

1. 由网关统一代理 `knowledge-service`
2. 在网关实现鉴权、审计、限流、租户边界
3. 不建议浏览器在生产环境直接访问知识服务

## 10. 当前实现限制

- 当前搜索虽然支持 lexical / semantic / hybrid，但整体最成熟的仍是 lexical 与 RRF hybrid 主路径
- `search.override` 与 `retrieve.override` 中不是所有参数都已完全生效
- `retrieve` 目前仍是“search 后逐条 fetch”的轻量封装，不是完整的上下文扩展器
- `fetch` 的 `includeMarkdown` 与 `includeRawText` 目前不参与返回裁剪
- profile 更新是浅合并，嵌套配置更新时要传完整一级对象
- 前端当前直接访问 `knowledge-service`，生产部署仍建议经由 `gateway`

## 11. 结论

当前 `knowledge-service` 已经形成一条可用闭环：

- 文档导入
- 结构化切块
- 双索引构建
- 检索与 compare
- 命中详情 fetch
- 直接 evidence retrieve
- source/profile/job 运维管理

如果要在当前阶段做稳定集成，应优先依赖以下闭环能力：

- `source` 管理
- 文档导入与 artifact 读取
- `chunk` CRUD
- `search`
- `fetch`
- `retrieve`
- `profile` 绑定
- `jobs` 与 `stats`
