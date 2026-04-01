# SOP环境实时诊断报告

## 诊断概述
- **SOP名称**：RCPA进程异常分析
- **触发原因**：RCPA进程STIME为最近时间，疑似发生重启
- **诊断时间**：2026-03-29 14:30:00
- **涉及主机**：RCPA-Node-1 (192.168.1.10)

## 节点执行结果

### 节点1：进程重启判断
- **目标主机**：RCPA-Node-1 (192.168.1.10)
- **执行命令**：`ps -ef|grep /rcpa/openas|grep -v grep`
- **命令输出**：
  ```
  rcpa  1234  1  0  14:25  ?  00:00:03 /rcpa/openas/bin/main
  ```
- **分析结论**：进程STIME为14:25（5分钟前），进程发生了重启。

### 节点4：报错日志分析
- **目标主机**：RCPA-Node-1 (192.168.1.10)
- **执行命令**：`cd /home/rcpa/openas/logs/run;tail -n 500 run.log|grep -v 'is not match'|grep -v 'parameter format error'`
- **命令输出**：
  ```
  2026-03-29 14:24:55 ERROR [main] Connection refused to GMDB host 192.168.1.3:5432
  2026-03-29 14:24:56 ERROR [main] Retry connection failed, exiting...
  ```
- **分析结论**：日志显示在14:24:55出现GMDB连接拒绝错误，随后进程退出。根因为GMDB数据库连接异常导致进程崩溃重启。

## 综合分析
RCPA进程于14:25发生重启，根因为GMDB数据库（192.168.1.3:5432）连接被拒绝。错误发生在14:24:55，进程在连续重试失败后退出并于14:25自动重启。

## 处理建议
1. 检查GMDB数据库（192.168.1.3）服务状态和端口5432监听情况
2. 检查网络连通性：从RCPA主机 ping 192.168.1.3
3. 检查GMDB连接数是否已达到上限
4. 确认GMDB认证配置是否正确
