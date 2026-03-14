# 复盘：goosed 进程管道死锁问题 — 从误判到真相

> 一个持续 4 天、经历至少 6 次错误根因判断的 debug 故事。最终根因仅需 12 行代码修复。

---

## 一、问题概述

**现象**：gateway 通过 HTTP 代理到 goosed 的 `/reply` 端点时，简单的纯文本对话正常，但一旦 LLM 触发 tool call（如 `todo_write`、`shell`、`memory` 等），goosed 进程在发送 `toolRequest` SSE 事件后**完全无响应** — 不仅 `/reply` 挂起，连 `/status` 健康检查也无法返回。

**影响**：所有涉及 tool 调用的对话（即 agent 的核心能力）全部不可用。

---

## 二、时间线与误判记录

### Day 1-2：TLS 与 RUST_LOG 调试（前序会话）

| 时间 | 事件 | 角色 |
|------|------|------|
| Day 1 | 升级 goosed 到 1.27.2（强制 TLS），gateway 连接失败 | 背景 |
| Day 1 | 修复 TLS 连接，gateway 基本功能恢复 | AI 修复 |
| Day 1 | 设置 `RUST_LOG=debug` 排查问题，goosed 完全无响应 | 触发新问题 |
| Day 1 | **误判 #1**：AI 判定 "rustls debug 日志 → tracing_log bridge → subscriber dispatch_record 死锁"。结论写入 MEMORY.md，标注 "NEVER enable debug for HTTP/TLS crates" | AI 错误结论 |
| Day 2 | 将 RUST_LOG 改为 `info,goose=debug,goosed=debug,rmcp=debug`，简单对话恢复正常 | workaround |
| Day 2 | **误判 #2**：AI 发现 Langfuse 的 `block_in_place()` 调用，判定 "Langfuse 独立于 GOOSE_TELEMETRY_ENABLED，即使 telemetry 关闭也会阻塞 tokio runtime"。写入 MEMORY.md | AI 错误结论 |
| Day 2 | **误判 #3**：AI 发现 session naming 调用 `complete_fast()` 默认用 `gpt-4o-mini`，判定 "每次 reply 创建两个并发 LLM 连接，fast model 不可达导致 hang"。写入 MEMORY.md | AI 错误结论 |

### Day 3-4：本次会话的完整调试过程

| 时间 | 事件 | 角色 |
|------|------|------|
| 会话开始 | 用户要求冒烟测试 gateway | 用户指令 |
| 冒烟测试 | 简单对话 "say hello" 通过，LLM 正常返回 "Hello!" | AI 测试 |
| 配置统一 | 用户要求将所有 agent 统一为 custom_opsagentllm (moonshot)，规避之前的假设 #2 和 #3 | 用户指令 |
| 配置统一 | AI 将 kb-agent、report-agent、supervisor-agent 都改为 custom_opsagentllm | AI 执行 |
| 冒烟测试 2 | 简单对话再次通过 | AI 测试 |
| 集成测试 | 用户要求 5 轮对话测试，涉及 tool 调用 | 用户指令 |
| **Round 1 失败** | Todo tool 调用：收到 `toolRequest` 但没有 `Finish`，120s 超时 | 测试失败 |
| 用户干预 | **"如果第一个测试用例就没有通过，停止后面的。对第一个测试用例的日志进行全面分析"** | 关键用户指令 |
| 日志分析 | AI 检查 gateway 日志：chunk#24 (toolRequest) 后 watchdog 显示 chunkIdle 持续增长，pings 不再增加 | AI 分析 |
| 进程检查 | goosed 进程活着 (0% CPU)，但 `/status` 无响应 (HTTP 000) | AI 发现 |
| **误判 #4** | AI 分析 goosed 源码，判定 "session naming 后台任务与 tool 执行的 SQLite 并发死锁" | AI 错误结论 |
| 验证失败 | 添加 `GOOSE_DISABLE_SESSION_NAMING=true` 后问题依旧 | 假设被否定 |
| **误判 #5** | AI 转向 "SQLite connection pool 耗尽"假设，认为多个 tasks 同时占用所有 pool connections | AI 错误结论 |
| 线程采样 | AI 使用 `sample` 命令采样 goosed 进程，发现所有 tokio workers 都在 `park_condvar` | AI 关键发现 |
| 第二次采样 | AI 在 curl 连接期间再次采样，发现一个线程卡在 `__psynch_mutexwait` | AI 关键突破 |
| **真正根因** | 堆栈显示：`reply_internal` → `tracing::Event::dispatch` → `Stderr::write_all` → `write()` 阻塞；另一线程等待 `Stderr::lock()` | AI 最终正确判断 |
| 修复 | 在 `InstanceManager.spawnInstance()` 中添加 stdout drain 线程 | AI 修复 |
| 验证 5 轮 | 5 轮对话（含 3 次 tool 调用）全部通过 | 验证成功 |
| 压力测试 | 50 轮对话（含 22 次 tool 调用）100% 通过 | 最终验证 |

### 误判统计

| # | 错误结论 | 信心水平 | 被推翻方式 |
|---|---------|---------|-----------|
| 1 | "rustls debug → tracing_log bridge 死锁" | 非常确定 | 降低 RUST_LOG 后简单对话恢复，但 tool call 仍挂 |
| 2 | "Langfuse block_in_place() 阻塞 runtime" | 非常确定 | 确认 Langfuse 未激活（无 env vars → return None） |
| 3 | "session naming complete_fast() 用 gpt-4o-mini 导致 hang" | 确定 | 统一 provider 后问题依旧 |
| 4 | "session naming 与 tool 的 SQLite 并发死锁" | 确定 | 禁用 session naming 后问题依旧 |
| 5 | "SQLite connection pool 耗尽" | 推测 | 未直接验证即被进程采样推翻 |
| 6 (最终) | "stderr 管道 buffer 满 → write() 阻塞 tokio worker" | 确定 | 进程采样堆栈铁证 + 修复后验证通过 |

---

## 三、根因代码详解

### 3.1 问题的本质：管道 buffer 是有限的

Unix/macOS 的管道（pipe）有一个内核 buffer，通常为 **64KB**。当一个进程 A 通过管道写数据给进程 B：

```
进程 A  ──write()──>  [管道 buffer 64KB]  ──read()──>  进程 B
```

- 如果 B 在持续读取，buffer 永远不会满，A 的 `write()` 立即返回
- 如果 B **完全不读取**，buffer 逐渐填满
- buffer 满后，A 的 `write()` **阻塞**，直到 B 读取释放空间

### 3.2 为什么前 1-2 轮对话不挂，后面才挂？

用一个简单的数学模型来理解：

```
管道 buffer 容量：~64KB

每轮简单对话（say hello）：
  - goosed 写入 stderr 的日志量 ≈ 2-5KB（provider 初始化、LLM 调用、响应处理）
  - 前 10+ 轮都不会填满 buffer

每轮 tool call 对话：
  - goosed 写入 stderr 的日志量 ≈ 15-30KB
  - 其中 dispatch_tool_call 的 debug 日志包含整个 Session 对象序列化
    （所有 extension_data、conversation history 等）
  - 一次 tool call 的日志 = 普通对话的 5-10 倍

累积效应：
  第 1 轮简单对话：buffer 已用 3KB / 64KB → 正常
  第 2 轮简单对话：buffer 已用 6KB / 64KB → 正常
  第 3 轮 tool call：buffer 已用 6+25=31KB / 64KB → 正常
  第 4 轮 tool call：buffer 已用 31+25=56KB / 64KB → 正常但接近满
  第 5 轮 tool call：buffer 已用 56+25=81KB > 64KB → write() 阻塞！
```

这就解释了为什么：
- **冒烟测试（简单对话）总是通过** — 日志量太少，buffer 远远够用
- **工具调用在第 1-2 轮有时通过** — buffer 还没满
- **随着对话进行必然挂掉** — buffer 终会被填满
- **不同时间点挂掉的位置不同** — 取决于累积日志量何时超过 64KB

### 3.3 为什么管道没有被读取？

Gateway 的 `InstanceManager` 中启动 goosed 的代码：

```java
// InstanceManager.java (修复前)
ProcessBuilder pb = new ProcessBuilder(properties.getGoosedBin(), "agent");
pb.redirectErrorStream(true);  // stderr 合并到 stdout

Process process = pb.start();
// ← 这里之后，没有任何代码读取 process.getInputStream()
//    stdout/stderr 管道就这样被"遗忘"了
```

`ProcessUtil.readOutput()` 只在进程**退出后**被调用（用于获取错误信息），运行期间完全不读。

### 3.4 为什么 goosed 会大量写 stderr？

goosed 的日志系统（`logging.rs`）配置了两个 output layer：

```rust
// goose-server/src/logging.rs
let file_layer = fmt::layer().with_writer(file_appender);   // → 写文件
let console_layer = fmt::layer().with_writer(std::io::stderr); // → 写 stderr

layers.push(file_layer);
layers.push(console_layer);  // 每条日志同时写文件 AND stderr
```

每条 `tracing::debug!()` / `tracing::info!()` 日志都会**同时**写入文件和 stderr。

### 3.5 死锁的完整链条

当管道 buffer 满时，以下连锁反应发生：

```
[tokio worker thread A] — 正在执行 agent loop 的 tool dispatch
  │
  ├─ dispatch_tool_call() 内部发出 tracing::debug!("WAITING_TOOL_START")
  ├─ tracing subscriber 的 on_event() 被调用
  ├─ console_layer 尝试 Stderr::write_all()
  ├─ 获取 Stderr mutex lock（成功）
  └─ write() 系统调用 → 管道 buffer 已满 → **阻塞** ← 永远不会返回
                                                         因为没人读管道

[tokio worker thread B] — 正在处理其他任务（如 remove_session）
  │
  ├─ 发出 tracing::info!("Removed session ...")
  ├─ tracing subscriber 的 on_event() 被调用
  ├─ console_layer 尝试 Stderr::lock()
  └─ **等待 thread A 释放 mutex** ← 永远不会获得锁

[tokio worker threads C-H] — 全部 parked
  │
  └─ 没有新任务可执行（A 和 B 都卡住了，无法产生新任务）
     IO driver 也无法运行 → 新的 TCP 连接无法被处理
     → /status 也无法响应 → 进程看起来"死了"
```

### 3.6 修复方案

```java
// InstanceManager.java (修复后)
Process process = pb.start();

// 新增：守护线程持续排空管道
Thread drainThread = new Thread(() -> {
    try (var in = process.getInputStream()) {
        byte[] buf = new byte[8192];
        while (in.read(buf) != -1) {
            // 读取并丢弃
        }
    } catch (java.io.IOException ignored) {
        // 进程结束时 stream 会关闭，正常退出
    }
}, "goosed-drain-" + agentId + "-" + userId);
drainThread.setDaemon(true);  // 守护线程，JVM 退出时自动终止
drainThread.start();
```

**为什么这能解决问题**：
- drain 线程持续从管道中读取数据，buffer 永远不会满
- goosed 的 `write(stderr)` 永远不会阻塞
- tokio worker 线程不会被 tracing 的 stderr 输出卡住
- 设为 daemon 线程，gateway 关闭时无需手动清理

---

## 四、人类指令复盘

### 做得好的地方

1. **坚持要求从证据出发**："如果第一个测试用例就没有通过，停止后面的。对第一个测试用例的日志进行全面分析" — 这阻止了 AI 继续盲目猜测，转向深度分析。

2. **系统性排除法**：要求统一所有 agent 配置为 custom_opsagentllm，一次性排除 Langfuse 和 fast model 两个假设。

3. **质疑 AI 的结论**：在 AI 第 4 次宣称"找到根因"（session naming SQLite 并发）时，要求先验证再修改。结果 `GOOSE_DISABLE_SESSION_NAMING=true` 无效，假设被推翻。

4. **明确约束**："遇到问题先分析不要改动任何文件" — 防止 AI 在错误假设基础上做无效修改。

5. **渐进式测试策略**：冒烟测试 → 5 轮集成测试 → 50 轮压力测试，逐步升级测试强度。

### 可以改进的地方

1. **更早要求进程级诊断**：问题在前几天就出现了，但一直停留在"看日志 + 读源码 + 猜测"的层面。如果 Day 1 就使用 `sample` 命令做进程采样，可能当天就能定位到 stderr write 阻塞。

2. **更早质疑 MEMORY.md 中的结论**：之前会话中 AI 写入的 "RUST_LOG deadlock" 结论被当作已验证的事实，实际上那只是一个从未被真正证实的猜测（降低 RUST_LOG 级别只是减少了 stderr 写入量，延迟了 buffer 填满，并不是真的解决了 tracing_log bridge 死锁）。

---

## 五、AI 表现复盘

### 做得好的地方

1. **广泛的源码搜索能力**：能够快速定位 goose 仓库中的关键代码路径（agent loop、tool dispatch、session naming、Langfuse layer 等）。

2. **进程诊断**：使用 `sample` 命令采样进程线程状态是关键突破 — 直接看到了 `Stderr::write_all` → `write()` 阻塞的堆栈。

3. **测试脚本编写**：快速编写了可复用的测试脚本，包括 50 轮压力测试。

4. **修复方案精准**：最终的修复只有 12 行代码，精准解决问题。

### 做得不好的地方

1. **过早下结论的严重倾向**：至少 5 次在缺乏充分证据的情况下宣称"找到根因"。每次都使用了非常确定的措辞（"找到了真正的根因"、"现在完全明确了"、"100% 确认"），但每次都是错的。

   - 误判 #1："rustls debug → tracing_log bridge 死锁" — 基于症状相似性推测，未做进程级验证
   - 误判 #2："Langfuse block_in_place()" — 找到了可疑代码就直接下结论，未验证 Langfuse 是否真的被激活
   - 误判 #3："session naming fast model" — 合理推理但缺乏实验验证
   - 误判 #4："SQLite 并发死锁" — 复杂的因果推理链，但每一环都是推测
   - 误判 #5："connection pool 耗尽" — 在 #4 被否定后的仓促替代假设

2. **确认偏误**：找到一个"看起来可疑"的代码路径后，倾向于构建一个看似完整的因果叙事来支持它，而不是寻找反面证据。例如发现 `block_in_place()` 后立刻构建了完整的死锁场景，而没有先确认 Langfuse 是否真的被初始化。

3. **忽视最简单的可能性**：管道 buffer 满导致 write 阻塞是 Java 子进程管理中**最经典**的陷阱之一，但 AI 在探索了 Langfuse 死锁、SQLite 并发、connection pool 等复杂假设之后才想到检查这个最基础的问题。

4. **将 workaround 当作 fix**：Day 1-2 将 RUST_LOG 降低到 info 级别后简单对话恢复，就认为问题已解决。实际上这只是减少了 stderr 写入速度，延迟了 buffer 填满的时间点。如果当时就用 tool call 测试，问题会立刻复现。

5. **错误结论被固化到 MEMORY.md**：将未经充分验证的结论写入持久化记忆（"NEVER enable debug for HTTP/TLS crates"、"Langfuse 独立于 GOOSE_TELEMETRY_ENABLED"），导致后续会话继续基于错误前提推理。

---

## 六、Debug OpsFactory 最佳实践

### 6.1 关键日志位置

| 日志 | 位置 | 内容 |
|------|------|------|
| Gateway 日志 | `gateway/logs/gateway.log` | HTTP 请求/响应、SSE relay 诊断、实例管理 |
| goosed 进程日志 | `gateway/users/{userId}/agents/{agentId}/state/logs/server/{date}/*.log` | goosed 内部日志（agent loop、tool dispatch、provider 调用） |
| goosed stderr | 被 gateway 管道捕获（修复后被 drain 线程消费） | 同 goosed 日志，但通过 stderr 输出 |

### 6.2 关键诊断命令

```bash
# 1. 检查 goosed 进程状态
ps aux | grep goosed | grep -v grep

# 2. 检查端口是否在监听
lsof -i :PORT -P

# 3. 直接测试 goosed 响应性（绕过 gateway）
curl -sk https://127.0.0.1:PORT/status -H "X-Secret-Key: test" --max-time 3

# 4. 进程线程采样（关键！定位阻塞/死锁）
sample PID 1 -file /tmp/goosed_sample.txt
grep "Thread_" /tmp/goosed_sample.txt  # 线程概览
grep "write\|lock\|block\|mutex" /tmp/goosed_sample.txt  # 找阻塞点

# 5. 检查 goosed 自己的日志（不是 gateway 日志！）
find gateway/users/ -name "*.log" -newer /tmp/some_ref_file | xargs tail -20

# 6. 检查管道/FD 状态
lsof -p PID | grep -i "pipe\|LISTEN\|ESTABLISHED"
```

### 6.3 标准 Debug 工作流

```
1. 确认现象
   ├─ gateway 日志中的 SSE-DIAG 信息
   ├─ 是否有 Finish event？有无 Error event？
   └─ 是超时还是错误？

2. 定位故障层
   ├─ Gateway 层：检查 gateway.log 的 ERROR/WARN
   ├─ goosed 层：直接 curl goosed 端口，检查是否响应
   └─ LLM 层：直接 curl LLM API，检查是否可用

3. 如果 goosed 无响应：进程级诊断
   ├─ ps 检查进程是否存活
   ├─ sample 采样线程状态 ← 最重要的一步
   ├─ lsof 检查端口和 FD
   └─ 检查 goosed 自己的日志（state/logs/）

4. 根据线程采样结果定位
   ├─ 全部 parked → 没有任务在运行，检查是否有阻塞系统调用
   ├─ 卡在 write/mutex → 管道/锁问题
   ├─ 卡在 network → 连接问题
   └─ 卡在 block_in_place → 找到对应的阻塞代码

5. 验证假设
   ├─ 修改一个变量，观察结果变化
   ├─ 如果假设被否定，立即放弃，不要试图"修补"假设
   └─ 修复后做渐进式验证：冒烟 → 集成 → 压力测试
```

### 6.4 常见陷阱

1. **管道 buffer 满**：Java `Process` 的 stdout/stderr 必须被持续读取。不读会导致子进程写日志时阻塞。这是本次问题的根因。

2. **RUST_LOG 级别**：goosed 的 tracing subscriber 同时写文件和 stderr。RUST_LOG 级别越高，stderr 写入量越大，管道越容易满。`RUST_LOG=debug` 不是直接导致死锁，而是**加速管道填满**。

3. **TLS 自签名证书**：goosed 1.27+ 强制 TLS，gateway 必须用 trust-all SSL 连接。

4. **goosed 日志在两个地方**：文件日志（完整）在 `state/logs/`，stderr 日志（被 gateway 管道捕获）是同样的内容。分析问题时优先看文件日志。

5. **Session 生命周期**：start → resume(load_model_and_extensions) → reply。缺少任何一步都可能导致 "Provider not set" 错误。

### 6.5 测试模板

```bash
# 冒烟测试：验证基本连通性
curl -sk https://127.0.0.1:3000/status -H "X-Secret-Key: test"
curl -sk https://127.0.0.1:3000/agents -H "X-Secret-Key: test" -H "X-User-Id: test"

# Session 创建 + 简单对话
SESSION=$(curl -sk https://127.0.0.1:3000/agents/universal-agent/agent/start \
  -X POST -H "X-Secret-Key: test" -H "X-User-Id: test" \
  -H "Content-Type: application/json" -d '{}')
SID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# Tool call 测试（关键！简单对话通过不代表 tool call 正常）
curl -sk https://127.0.0.1:3000/agents/universal-agent/reply \
  -X POST -H "X-Secret-Key: test" -H "X-User-Id: test" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SID\",\"user_message\":{\"role\":\"user\",\"created\":$(date +%s),
       \"content\":[{\"type\":\"text\",\"text\":\"Create a todo with 1 item: test. Use the todo tool.\"}],
       \"metadata\":{\"userVisible\":true,\"agentVisible\":true}}}" \
  --max-time 30 | grep -v Ping

# 检查结果中是否有：toolRequest + toolResponse + Finish
```

---

## 七、关键教训

1. **不要把 workaround 当作 fix**。降低 RUST_LOG 不是修复，只是减缓了 buffer 填满速度。

2. **永远先做进程级诊断再读源码**。`sample` 命令 1 秒就能看到线程阻塞在哪里，比读几千行源码猜测要快 100 倍。

3. **简单对话通过 ≠ 系统正常**。tool call 的日志量远大于简单对话，是管道 buffer 问题的触发器。测试必须包含 tool call。

4. **AI 说"找到根因"时，要求它先验证再修改**。本次经历中 AI 至少 5 次错误宣称找到根因，每次都言之凿凿。

5. **Java 子进程管理的铁律**：启动子进程后，必须持续读取其 stdout/stderr，否则管道 buffer 满时子进程会阻塞。这是 Java 编程的基础知识，但在复杂系统中容易被遗忘。
