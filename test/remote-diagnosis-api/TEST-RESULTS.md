# Gateway 远程诊断 API 接口用例执行结果

**执行时间**: 2026-03-29 20:38:30
**执行命令**: `GOOSED_BIN=echo npx vitest run --config vitest.config.ts remote-diagnosis-api/`
**总耗时**: 36.03s
**测试结果**: 3 个文件 / 74 个用例 / **全部通过**

---

## 1. 主机管理 hosts.test.ts (29 tests) - PASS

| # | 用例名 | 分类 | 结果 |
|---|--------|------|------|
| 1 | returns an empty or non-empty hosts array | GET /hosts/ 列表 | PASS |
| 2 | requires admin role | GET /hosts/ 权限 | PASS |
| 3 | requires valid secret key | GET /hosts/ 鉴权 | PASS |
| 4 | supports tag filtering via ?tags= | GET /hosts/?tags= 过滤 | PASS |
| 5 | returns host details for existing host | GET /hosts/{id} 查询 | PASS |
| 6 | returns error for non-existent host | GET /hosts/{id} 不存在(500) | PASS |
| 7 | requires admin role | GET /hosts/{id} 权限 | PASS |
| 8 | creates a host with all fields | POST /hosts/ 全字段创建 | PASS |
| 9 | creates a host with defaults for optional fields | POST /hosts/ 默认值 | PASS |
| 10 | new host appears in listing | POST + GET 列表验证 | PASS |
| 11 | credential is masked in create response | POST 凭据掩码 | PASS |
| 12 | requires admin role | POST /hosts/ 权限 | PASS |
| 13 | updates individual fields | PUT /hosts/{id} 部分更新 | PASS |
| 14 | updates tags | PUT /hosts/{id} 更新标签 | PASS |
| 15 | updates credential (masked in response) | PUT /hosts/{id} 凭据更新 | PASS |
| 16 | updatedAt changes after update | PUT updatedAt 时间戳变化 | PASS |
| 17 | returns error for non-existent host | PUT /hosts/{id} 不存在(400) | PASS |
| 18 | requires admin role | PUT /hosts/{id} 权限 | PASS |
| 19 | deletes an existing host | DELETE /hosts/{id} 删除 | PASS |
| 20 | returns 404 for non-existent host | DELETE /hosts/{id} 不存在 | PASS |
| 21 | delete is idempotent - second delete returns 404 | DELETE 幂等性 | PASS |
| 22 | requires admin role | DELETE /hosts/{id} 权限 | PASS |
| 23 | returns tags array | GET /hosts/tags 标签列表 | PASS |
| 24 | includes tags from newly created hosts | GET /hosts/tags 新标签 | PASS |
| 25 | requires admin role | GET /hosts/tags 权限 | PASS |
| 26 | returns test result structure for a host (expected to fail) | POST /hosts/{id}/test 连通性 | PASS |
| 27 | returns failure for non-existent host | POST /hosts/{id}/test 不存在 | PASS |
| 28 | requires admin role | POST /hosts/{id}/test 权限 | PASS |
| 29 | completes the full CRUD cycle | 全生命周期 | PASS |

### 覆盖的 API 接口
- `GET    /ops-gateway/hosts/` — 列表(含 tag 过滤)
- `GET    /ops-gateway/hosts/{id}` — 按 ID 查询
- `POST   /ops-gateway/hosts/` — 创建主机
- `PUT    /ops-gateway/hosts/{id}` — 更新主机
- `DELETE /ops-gateway/hosts/{id}` — 删除主机
- `GET    /ops-gateway/hosts/tags` — 获取标签列表
- `POST   /ops-gateway/hosts/{id}/test` — SSH 连通性测试

---

## 2. SOP管理 sops.test.ts (23 tests) - PASS

| # | 用例名 | 分类 | 结果 |
|---|--------|------|------|
| 1 | returns a sops array | GET /sops/ 列表 | PASS |
| 2 | requires admin role | GET /sops/ 权限 | PASS |
| 3 | requires valid secret key | GET /sops/ 鉴权 | PASS |
| 4 | returns SOP details for existing SOP | GET /sops/{id} 查询 | PASS |
| 5 | returns error for non-existent SOP | GET /sops/{id} 不存在(500) | PASS |
| 6 | requires admin role | GET /sops/{id} 权限 | PASS |
| 7 | creates a SOP with all fields | POST /sops/ 全字段创建 | PASS |
| 8 | creates a SOP with defaults for optional fields | POST /sops/ 默认值 | PASS |
| 9 | new SOP appears in listing | POST + GET 列表验证 | PASS |
| 10 | auto-generates a UUID as id | POST UUID 自动生成 | PASS |
| 11 | requires admin role | POST /sops/ 权限 | PASS |
| 12 | updates individual fields | PUT /sops/{id} 部分更新 | PASS |
| 13 | updates version | PUT /sops/{id} 更新版本 | PASS |
| 14 | updates trigger condition | PUT /sops/{id} 更新触发条件 | PASS |
| 15 | updates nodes | PUT /sops/{id} 更新节点 | PASS |
| 16 | returns error for non-existent SOP | PUT /sops/{id} 不存在(400) | PASS |
| 17 | requires admin role | PUT /sops/{id} 权限 | PASS |
| 18 | deletes an existing SOP | DELETE /sops/{id} 删除 | PASS |
| 19 | returns 404 for non-existent SOP | DELETE /sops/{id} 不存在 | PASS |
| 20 | delete is idempotent - second delete returns 404 | DELETE 幂等性 | PASS |
| 21 | requires admin role | DELETE /sops/{id} 权限 | PASS |
| 22 | completes the full CRUD cycle | 全生命周期 | PASS |
| 23 | can re-create a SOP after deletion | 删除后重建 | PASS |

### 覆盖的 API 接口
- `GET    /ops-gateway/sops/` — SOP 列表
- `GET    /ops-gateway/sops/{id}` — 按 ID 查询
- `POST   /ops-gateway/sops/` — 创建 SOP
- `PUT    /ops-gateway/sops/{id}` — 更新 SOP
- `DELETE /ops-gateway/sops/{id}` — 删除 SOP

---

## 3. 白名单管理 whitelist.test.ts (22 tests) - PASS

| # | 用例名 | 分类 | 结果 |
|---|--------|------|------|
| 1 | returns a whitelist object with commands array | GET /command-whitelist/ 列表 | PASS |
| 2 | contains default commands on first load | GET 默认命令验证 | PASS |
| 3 | each default command has expected fields | GET 字段完整性 | PASS |
| 4 | requires admin role | GET /command-whitelist/ 权限 | PASS |
| 5 | requires valid secret key | GET /command-whitelist/ 鉴权 | PASS |
| 6 | adds a new command to the whitelist | POST /command-whitelist/ 添加 | PASS |
| 7 | new command appears in whitelist | POST + GET 验证 | PASS |
| 8 | adds a command with enabled=false | POST 禁用命令 | PASS |
| 9 | adds a command without optional fields | POST 最小参数 | PASS |
| 10 | can add multiple commands | POST 批量添加 | PASS |
| 11 | requires admin role | POST /command-whitelist/ 权限 | PASS |
| 12 | updates description | PUT /command-whitelist/{pattern} 更新 | PASS |
| 13 | toggles enabled status | PUT enabled 切换 | PASS |
| 14 | update is persisted | PUT 持久化验证 | PASS |
| 15 | returns 404 for non-existent pattern | PUT 不存在 | PASS |
| 16 | requires admin role | PUT /command-whitelist/{pattern} 权限 | PASS |
| 17 | deletes an existing command | DELETE /command-whitelist/{pattern} | PASS |
| 18 | returns 404 for non-existent pattern | DELETE 不存在 | PASS |
| 19 | delete is idempotent - second delete returns 404 | DELETE 幂等性 | PASS |
| 20 | requires admin role | DELETE /command-whitelist/{pattern} 权限 | PASS |
| 21 | completes the full CRUD cycle | 全生命周期 | PASS |
| 22 | does not affect default commands when adding new ones | 默认命令完整性 | PASS |

### 覆盖的 API 接口
- `GET    /ops-gateway/command-whitelist/` — 获取白名单
- `POST   /ops-gateway/command-whitelist/` — 添加命令
- `PUT    /ops-gateway/command-whitelist/{pattern}` — 更新命令
- `DELETE /ops-gateway/command-whitelist/{pattern}` — 删除命令

---

## 测试覆盖维度

| 维度 | 说明 |
|------|------|
| **CRUD** | Create/Read/Update/Delete 完整覆盖 |
| **权限控制** | admin vs non-admin (403), 无效 secret key (401) |
| **异常处理** | 不存在资源 (404/500/400), 幂等删除 |
| **数据验证** | 字段完整性, 默认值, 凭据掩码, 时间戳变化 |
| **业务逻辑** | Tag 过滤, 默认命令完整性, 删除后重建 |
| **全生命周期** | Create - Read - Update - Read - Delete - Read 验证 |
