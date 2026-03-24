# knowledge-service 测试报告

- 生成时间：2026-03-24 13:54:35 +08:00
- 模块路径：`/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service`
- 测试报告路径：`/Users/buyangnie/Documents/GitHub/ops-factory/test/report/knowledge-service-test-report_20260324_135435.md`

## 一、测试目标

验证 `knowledge-service` 第一版在以下方面可用：

1. 基于内置测试样本的文档上传导入。
2. 文档转换为 markdown 产物并可导出到指定目录。
3. 文档切片、查询、抓取、统计能力。
4. chunk 的新增、更新关键词、删除后的检索联动。
5. 系统默认配置与能力接口输出。
6. 错误资源访问时的统一返回。

## 二、测试前清理动作

每个集成测试执行前，均自动完成以下清理：

1. 清空 SQLite 中历史测试数据：
   - `embedding_record`
   - `source_profile_binding`
   - `document_chunk`
   - `knowledge_document`
   - `ingestion_job`
   - `knowledge_source`
2. 清空运行时目录中的历史测试产物：
   - `target/test-runtime/upload`
   - `target/test-runtime/artifacts`
   - `target/test-runtime/indexes`
3. 清空 markdown 导出目录：
   - `src/test/resources/outputFiles`

说明：

- 以上清理由集成测试的 `@BeforeEach` 自动执行。
- SQLite schema 与默认 profile 保留，用于保证测试容器启动后的基础结构稳定。

## 三、测试样本说明

测试不再依赖外部 `report-agent` 目录运行，已将代表性样本固化到仓库：

输入目录：
- `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/src/test/resources/inputFiles`

样本文件：
1. `Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.xlsx`
2. `Major_Incident_Analysis_INC20250115001_EN.docx`
3. `SLA_Violation_Analysis_Report_CN.html`
4. `sample-knowledge.pdf`
5. `sample-operations-note.md`
6. `sample-runbook.txt`

调整原则：

1. 删除了同类型重复样本，只保留每类一个代表文件。
2. 补充了此前未覆盖的类型：
   - `pdf`
   - `md`
   - `txt`

## 四、被测功能点列表

### 1. 配置与能力接口

1. `GET /ops-knowledge/capabilities`
2. `GET /ops-knowledge/system/defaults`
3. 默认业务配置值绑定：
   - ingest
   - convert
   - analysis
   - chunking
   - embedding
   - retrieval
   - features

### 2. 基础资源管理

1. `POST /ops-knowledge/sources`
2. `GET /ops-knowledge/sources/{sourceId}`
3. `GET /ops-knowledge/sources/{sourceId}/stats`
4. `GET /ops-knowledge/documents`
5. `GET /ops-knowledge/documents/{documentId}`
6. `GET /ops-knowledge/documents/{documentId}/chunks`
7. `GET /ops-knowledge/stats/overview`

### 3. 导入与转换

1. 通过 `multipart/form-data` 上传多个文件。
2. 使用内置样本完成文档导入。
3. 转换产物生成：
   - `content.txt`
   - `content.md`
4. 支持将导入文档的 markdown 产物导出到指定目录。

### 4. 检索与抓取

1. `POST /ops-knowledge/search`
2. `GET /ops-knowledge/fetch/{chunkId}`
3. search 命中后可 fetch 返回 chunk 正文。
4. fetch 支持邻接上下文参数。

### 5. Chunk 管理

1. `POST /ops-knowledge/documents/{documentId}/chunks`
2. `PATCH /ops-knowledge/chunks/{chunkId}/keywords`
3. `DELETE /ops-knowledge/chunks/{chunkId}`
4. chunk 变更后，search 结果与 fetch 结果联动更新。

### 6. 错误处理

1. 不存在的 `sourceId` 返回 404
2. 不存在的 `documentId` 返回 404
3. 不存在的 `chunkId` 返回 404
4. 不存在的 `jobId` 返回 404

## 五、测试用例列表

### A. 单元与接口层测试

1. `KnowledgePropertiesTest.shouldExposeExpectedDefaultBusinessSettings`
   - 验证默认业务配置值。

2. `SqliteSchemaResourceTest.shouldShipSqliteSchemaForRuntimeBootstrap`
   - 验证 SQLite schema 资源存在且包含关键表。

3. `SystemControllerTest.shouldExposeCapabilitiesForManagementUiAndThirdPartyClients`
   - 验证能力接口输出。

4. `SystemControllerTest.shouldExposeDefaultBusinessConfigurationView`
   - 验证系统默认配置视图输出。

### B. 集成测试

5. `KnowledgeUploadFlowIntegrationTest.shouldIngestUploadedDocumentsAndServeSearchAndFetch`
   - 创建 source
   - 上传内置样本
   - 校验 source stats
   - 校验 documents/chunks 列表
   - 校验 search/fetch
   - 校验全局 overview

6. `KnowledgeUploadFlowIntegrationTest.shouldExportMarkdownArtifactsToOutputFilesDirectory`
   - 上传内置样本
   - 逐个下载 markdown 产物
   - 输出到 `outputFiles`
   - 校验导出文件数量与内容

7. `KnowledgeUploadFlowIntegrationTest.shouldSupportChunkCrudAndReflectChangesInSearch`
   - 手工新增 chunk
   - 更新 keywords
   - fetch 校验关键词变更
   - 删除 chunk
   - search 校验命中结果消失

8. `KnowledgeUploadFlowIntegrationTest.shouldReturnNotFoundForMissingResources`
   - 校验缺失资源的 404 行为

## 六、执行命令与结果

### 1. 全量测试

执行命令：

```bash
cd /Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service
mvn clean test
```

结果：

- 执行通过
- 测试总数：8
- 失败：0
- 错误：0
- 跳过：0

### 2. 打包验证

执行命令：

```bash
cd /Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service
mvn package -DskipTests
```

结果：

- 执行通过
- 产物：
  - `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/target/knowledge-service.jar`

### 3. markdown 导出结果保留

为保留最终导出文件，额外执行：

```bash
cd /Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service
mvn -Dtest=KnowledgeUploadFlowIntegrationTest#shouldExportMarkdownArtifactsToOutputFilesDirectory test
```

结果：

- 执行通过
- `outputFiles` 中已保留导出产物

## 七、markdown 导出结果

输出目录：
- `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/src/test/resources/outputFiles`

导出文件：
1. `Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.md`
2. `Major_Incident_Analysis_INC20250115001_EN.md`
3. `SLA_Violation_Analysis_Report_CN.md`
4. `sample-knowledge.md`
5. `sample-operations-note.md`
6. `sample-runbook.md`

## 八、结论

本轮测试结果为：

1. `knowledge-service` 当前已具备可运行的基础能力闭环。
2. 内置测试样本覆盖了 `xlsx/docx/html/pdf/md/txt` 六类输入。
3. 上传、转换、切片、搜索、抓取、chunk 编辑、导出 markdown、统计与错误处理均已验证通过。
4. 当前全量测试与打包结果均为 100% 通过。

## 九、后续建议

当前测试已经能够支撑 MVP 交付，但后续如果继续演进，建议补充：

1. 重复上传与去重策略测试。
2. 不支持文件类型与空文件上传测试。
3. profile 创建、绑定、更新测试。
4. document 删除后索引与统计联动测试。
5. 真正基于 Lucene 的检索正确性测试。
