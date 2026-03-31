---
name: sop-diagnosis-execution
description: 当QoS智能体完成根因分析后，根据故障类型匹配SOP流程，自动登录目标主机执行诊断命令，收集信息并分析，最终出具环境实时诊断报告。当用户要求"环境诊断"、"执行SOP"、"实时诊断"、"环境排查"时使用。
version: 1.0.0
---

# SOP 环境实时诊断

## 概述
根据故障根因匹配预定义的 SOP 流程，自动在目标主机上执行诊断命令，收集并分析结果，生成环境实时诊断报告。

## 执行流程

### 步骤1：匹配SOP
根据当前故障根因分析的结果，调用 `sop-executor__list_sops` 获取可用SOP列表。
根据 `triggerCondition` 字段匹配最适合的SOP，记录 `sopId`。
如无匹配SOP，告知用户当前无对应SOP，结束流程。

### 步骤2：获取SOP详情
调用 `sop-executor__get_sop_detail(sopId)` 获取完整SOP流程定义。

### 步骤3：按SOP流程逐步执行
从 type=start 的节点开始，对每个节点执行以下操作：

#### 对每个SOP节点：

1. **获取目标主机**：调用 `sop-executor__get_hosts(tags=node.hostTags)` 获取匹配标签的目标主机列表

2. **构造命令（泛化机制）**：
   - 读取节点的 `command` 模板和 `commandVariables` 定义
   - **优先使用上下文推断**：根据当前诊断上下文（根因分析结果、环境信息等）推断变量值
   - **其次使用默认值**：对无法推断的变量使用 `commandVariables` 中的 `defaultValue`
   - **允许自主调整**：可根据实际情况适当调整命令参数（如增大 tail 行数、修改过滤条件），但**命令主体必须在白名单内**
   - 替换 `{{变量名}}` 占位符，生成最终命令

3. **执行命令**：对每台匹配主机调用 `sop-executor__execute_remote_command(hostId, command)`

4. **收集输出**：汇总所有主机的命令执行结果
   - 每次调用 `execute_remote_command` 的原始输出会自动保存为附件文件，用户可在聊天中直接下载查看
   - 你无需手动保存每条命令的原始输出，但需要在分析中引用关键信息

5. **分析输出**：根据节点的 `analysisInstruction` 和 `outputFormat` 分析命令输出
   - 可结合上下文中已有的诊断信息进行综合分析

6. **分支判断**：根据分析结果和节点的 `transitions` 条件，决定下一个执行节点
   - 如果 `transitions` 中有多个 nextNodes 匹配，这些节点应依次执行
   - 可根据实际情况**跳过不必要的节点**或**补充额外检查**（体现泛化能力）

### 步骤4：生成诊断报告
将所有节点的执行结果和分析汇总，按模板生成环境实时诊断报告。

## 输出报告格式
报告保存为: `./output/sop-diagnosis-report-{yyyyMMddHHmmss}.md`

报告结构：
```markdown
# SOP环境实时诊断报告

## 诊断概述
- **SOP名称**：{sopName}
- **触发原因**：{triggerReason}
- **诊断时间**：{timestamp}
- **涉及主机**：{hostList}

## 节点执行结果

### 节点1：{nodeName}
- **目标主机**：{hostName} ({ip})
- **执行命令**：`{command}`
- **命令输出**：
  ```
  {output}
  ```
- **分析结论**：{analysis}

### 节点2：{nodeName}
...

## 综合分析
{overallAnalysis}

## 处理建议
{suggestions}
```

## 安全约束
- 所有执行的命令必须在命令白名单内，白名单外的命令将被系统拒绝
- 只执行只读类诊断命令（ps, tail, grep, cat, ls, df, free, netstat, top等）
- 不执行任何修改类命令（rm, mv, chmod, reboot, service等）

## 异常处理
- 主机连接失败：记录失败信息，继续执行其他主机
- 命令执行超时：标记超时，继续执行其他节点
- 命令被白名单拒绝：记录拒绝原因，尝试使用替代命令
- SOP匹配失败：告知用户，建议手动排查
