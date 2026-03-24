# knowledge-service 真实场景测试报告

- 生成时间：2026-03-24 14:00:34 +08:00
- 模块路径：`/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service`
- 报告路径：`/Users/buyangnie/Documents/GitHub/ops-factory/test/report/knowledge-service-test-report_20260324_140034.md`

## 一、测试目标

本轮测试目标是尽可能按真实使用场景验证 `knowledge-service`：

1. 服务以真实 Spring Boot HTTP 服务启动。
2. 客户端通过真实 HTTP 接口访问，而不是仅通过进程内调用。
3. 文档通过真实 `multipart/form-data` 上传导入。
4. 文档转换为 markdown 后，下载并输出到指定目录。
5. 搜索、抓取、chunk 编辑、统计、错误处理等核心功能全链路可用。

## 二、测试前清理策略

每个集成测试执行前，都会清空本轮测试数据，避免历史残留影响结果。

### 1. SQLite 运行时数据清理

清理表：

1. `embedding_record`
2. `source_profile_binding`
3. `document_chunk`
4. `knowledge_document`
5. `ingestion_job`
6. `knowledge_source`

### 2. 文件型运行时数据清理

清理目录：

1. `target/test-runtime/upload`
2. `target/test-runtime/artifacts`
3. `target/test-runtime/indexes`
4. `target/test-runtime-http/upload`
5. `target/test-runtime-http/artifacts`
6. `target/test-runtime-http/indexes`
7. `src/test/resources/outputFiles`

说明：

- 以上动作满足“测试前清空 index 和之前测试数据”的要求。
- SQLite schema 与服务启动所需目录结构保留，由测试启动阶段自动重建。

## 三、测试样本

测试不依赖外部目录运行，样本已固化到仓库。

输入目录：
- `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/src/test/resources/inputFiles`

样本文件列表：

1. `Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.xlsx`
2. `Major_Incident_Analysis_INC20250115001_EN.docx`
3. `SLA_Violation_Analysis_Report_CN.html`
4. `sample-knowledge.pdf`
5. `sample-operations-note.md`
6. `sample-runbook.txt`

样本覆盖的文档类型：

1. `xlsx`
2. `docx`
3. `html`
4. `pdf`
5. `md`
6. `txt`

样本调整策略：

1. 删除同类型重复文档，避免冗余。
2. 保留每类一个代表样本。
3. 补充此前未覆盖的 `pdf/md/txt` 类型。

## 四、被测功能点清单

### A. 系统配置与能力接口

1. `GET /ops-knowledge/capabilities`
2. `GET /ops-knowledge/system/defaults`
3. 默认业务配置绑定：
   - ingest
   - convert
   - analysis
   - chunking
   - metadata
   - embedding
   - indexing
   - retrieval
   - fetch
   - retrieve
   - features

### B. Source 管理

1. `POST /ops-knowledge/sources`
2. `GET /ops-knowledge/sources/{sourceId}`
3. `GET /ops-knowledge/sources/{sourceId}/stats`

### C. Document 导入与读取

1. `POST /ops-knowledge/sources/{sourceId}/documents:ingest`
2. `GET /ops-knowledge/documents`
3. `GET /ops-knowledge/documents/{documentId}`
4. `GET /ops-knowledge/documents/{documentId}/chunks`
5. `GET /ops-knowledge/documents/{documentId}/artifacts/markdown`

### D. 转换与导出

1. docx 转 markdown
2. html 转 markdown
3. xlsx 转 markdown
4. pdf 转 markdown
5. md 原样归一化输出
6. txt 转 markdown
7. markdown 产物写入 `outputFiles`

### E. Chunk 能力

1. `POST /ops-knowledge/documents/{documentId}/chunks`
2. `PATCH /ops-knowledge/chunks/{chunkId}/keywords`
3. `DELETE /ops-knowledge/chunks/{chunkId}`
4. chunk 变更后检索联动

### F. Retrieval 能力

1. `POST /ops-knowledge/search`
2. `GET /ops-knowledge/fetch/{chunkId}`
3. `GET /ops-knowledge/stats/overview`

### G. 错误处理

1. 不存在的 source 返回 404
2. 不存在的 document 返回 404
3. 不存在的 chunk 返回 404
4. 不存在的 job 返回 404

### H. 真实 HTTP 场景

1. 随机端口启动服务
2. 真实 HTTP JSON 调用
3. 真实 `multipart/form-data` 上传
4. 非 `MockMvc` 的外部客户端访问

## 五、测试用例列表

### 1. 单元/轻量接口测试

1. `KnowledgePropertiesTest.shouldExposeExpectedDefaultBusinessSettings`
2. `SqliteSchemaResourceTest.shouldShipSqliteSchemaForRuntimeBootstrap`
3. `SystemControllerTest.shouldExposeCapabilitiesForManagementUiAndThirdPartyClients`
4. `SystemControllerTest.shouldExposeDefaultBusinessConfigurationView`

### 2. 进程内集成测试

5. `KnowledgeUploadFlowIntegrationTest.shouldIngestUploadedDocumentsAndServeSearchAndFetch`
6. `KnowledgeUploadFlowIntegrationTest.shouldExportMarkdownArtifactsToOutputFilesDirectory`
7. `KnowledgeUploadFlowIntegrationTest.shouldSupportChunkCrudAndReflectChangesInSearch`
8. `KnowledgeUploadFlowIntegrationTest.shouldReturnNotFoundForMissingResources`

### 3. 真实 HTTP 集成测试

9. `KnowledgeRealHttpIntegrationTest.shouldBehaveLikeARealClientUsingHttpAndMultipartUpload`

该用例验证：

1. Spring Boot 以随机端口启动
2. 客户端通过真实 HTTP 创建 source
3. 客户端通过真实 multipart 上传内置文档
4. 客户端通过真实 HTTP 获取 documents/chunks/stats
5. 客户端通过真实 HTTP 搜索与 fetch
6. 客户端通过真实 HTTP 下载 markdown 并写入 `outputFiles`

## 六、执行命令与结果

### 1. 全量测试

执行命令：

```bash
cd /Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service
mvn clean test
```

结果：

- 通过
- 测试总数：9
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

- 通过
- 构建产物：
  - `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/target/knowledge-service.jar`

### 3. 保留导出结果

为保证 `outputFiles` 中保留最终导出的 markdown 文件，额外执行：

```bash
cd /Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service
mvn -Dtest=KnowledgeRealHttpIntegrationTest#shouldBehaveLikeARealClientUsingHttpAndMultipartUpload test
```

结果：

- 通过
- 导出文件已保留在 `outputFiles`

## 七、真实场景测试中发现并修复的问题

本轮“真实 HTTP”测试额外暴露并验证修复了一个问题：

### 1. multipart 文件大小限制问题

问题现象：

- 在真实 HTTP multipart 上传下，大于 1MB 的 `xlsx` 文件会被 Tomcat 默认限制拒绝。

错误表现：

- 返回 400
- 错误信息为单文件大小超限

修复方式：

- 在 `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/src/main/resources/application.yaml` 中增加：
  - `spring.servlet.multipart.max-file-size: 100MB`
  - `spring.servlet.multipart.max-request-size: 100MB`

修复结论：

- 真实 HTTP 上传已可通过
- 大文件样本已成功导入与转换

## 八、markdown 导出结果

输出目录：
- `/Users/buyangnie/Documents/GitHub/ops-factory/knowledge-service/src/test/resources/outputFiles`

最终保留的导出文件：

1. `Comprehensive_Quality_Report_20260204_132159_EN_matplotlib_chart.md`
2. `Major_Incident_Analysis_INC20250115001_EN.md`
3. `SLA_Violation_Analysis_Report_CN.md`
4. `sample-knowledge.md`
5. `sample-operations-note.md`
6. `sample-runbook.md`

## 九、结论

本轮测试结论如下：

1. `knowledge-service` 已完成“接近真实场景”的基础验证。
2. 文档上传已覆盖真实 HTTP multipart 行为，而不只是在测试框架内伪造调用。
3. `xlsx/docx/html/pdf/md/txt` 六类输入已全部完成导入、转换与导出验证。
4. search、fetch、chunk CRUD、stats、404 错误路径已验证通过。
5. 全量测试与打包结果均为 100% 通过。

## 十、后续建议

虽然本轮已经更接近真实场景，但如果继续提高可信度，下一步建议补：

1. 重复上传与去重策略测试
2. 不支持文件类型与空文件上传测试
3. profile 创建、绑定、更新测试
4. document 删除后的索引联动测试
5. Lucene 真索引替换后对应的检索正确性测试
