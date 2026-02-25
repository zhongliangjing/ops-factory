# Ops Factory 依赖清单

本文档汇总了 Ops Factory 项目各组件的所有安装部署依赖。

## 系统级依赖

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| **Node.js** | >= 18.0.0 | 运行 Gateway、构建 Web App 和 SDK |
| **npm** | 随 Node.js 安装 | 包管理器 |
| **goosed** | — | Goose AI Agent 运行时二进制文件，需在 PATH 中可用 |
| **Docker** & **Docker Compose** | — | 运行 Langfuse（可观测性）和 OnlyOffice（文档预览） |

---

## 1. Gateway (`gateway/`)

Node.js HTTP 网关服务，管理 per-user agent 实例、请求代理和路由。

### 运行时依赖 (dependencies)

| 包名 | 版本 | 说明 |
|------|------|------|
| `http-proxy` | ^1.18.1 | HTTP 请求代理，用于将请求转发到各 goosed 实例 |
| `yaml` | ^2.8.2 | YAML 文件解析，读取 agent 配置文件 |

### 开发依赖 (devDependencies)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@types/http-proxy` | ^1.17.16 | http-proxy 的 TypeScript 类型定义 |
| `@types/node` | ^22.13.1 | Node.js 的 TypeScript 类型定义 |
| `tsx` | ^4.19.2 | TypeScript 执行器，用于开发模式运行 |
| `typescript` | ^5.7.3 | TypeScript 编译器 |
| `vitest` | ^4.0.18 | 单元测试框架 |

---

## 2. Web App (`web-app/`)

React 前端应用，提供聊天、会话管理、文件浏览和 Agent 配置界面。

### 运行时依赖 (dependencies)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@goosed/sdk` | file:../typescript-sdk | 本地 TypeScript SDK，与 Gateway 通信 |
| `react` | ^18.2.0 | UI 框架 |
| `react-dom` | ^18.2.0 | React DOM 渲染器 |
| `react-router-dom` | ^6.20.0 | 前端路由 |
| `react-markdown` | ^9.0.1 | Markdown 渲染组件 |
| `remark-gfm` | ^4.0.0 | GitHub Flavored Markdown 支持 |
| `highlight.js` | ^11.11.1 | 代码语法高亮 |
| `lucide-react` | ^0.563.0 | 图标库 |
| `i18next` | ^25.8.13 | 国际化框架 |
| `react-i18next` | ^16.5.4 | React i18next 集成 |
| `i18next-browser-languagedetector` | ^8.2.1 | 浏览器语言自动检测 |

### 开发依赖 (devDependencies)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@vitejs/plugin-react` | ^4.2.1 | Vite 的 React 插件 |
| `@testing-library/react` | ^16.3.2 | React 组件测试工具 |
| `@testing-library/jest-dom` | ^6.9.1 | Jest DOM 匹配器扩展 |
| `@types/jest` | ^30.0.0 | Jest 类型定义 |
| `@types/react` | ^18.2.43 | React 类型定义 |
| `@types/react-dom` | ^18.2.17 | React DOM 类型定义 |
| `jsdom` | ^27.4.0 | 浏览器环境模拟（测试用） |
| `typescript` | ^5.3.2 | TypeScript 编译器 |
| `vite` | ^5.0.8 | 前端构建工具与开发服务器 |
| `vitest` | ^4.0.17 | 单元测试框架 |

---

## 3. TypeScript SDK (`typescript-sdk/`)

`@goosed/sdk` 客户端库，提供对 Goose API 的编程访问。

### 运行时依赖 (dependencies)

无（SDK 仅使用 Node.js 内置模块）。

### 开发依赖 (devDependencies)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@types/node` | ^20.0.0 | Node.js 类型定义 |
| `tsx` | ^4.0.0 | TypeScript 执行器（运行测试） |
| `typescript` | ^5.0.0 | TypeScript 编译器 |

---

## 4. Test (`test/`)

集成测试和 E2E 测试。

### 开发依赖 (devDependencies)

| 包名 | 版本 | 说明 |
|------|------|------|
| `@playwright/test` | ^1.58.2 | E2E 浏览器自动化测试框架 |
| `tsx` | ^4.19.2 | TypeScript 执行器 |
| `typescript` | ^5.7.3 | TypeScript 编译器 |
| `vitest` | ^4.0.18 | 集成测试框架 |

---

## 5. Docker 服务

### Langfuse（LLM 可观测性平台）

在 `langfuse/docker-compose.yml` 中定义：

| 服务 | 镜像 | 端口 | 说明 |
|------|------|------|------|
| `langfuse-db` | `postgres:16-alpine` | 5432 | Langfuse 后端数据库 |
| `langfuse` | `langfuse/langfuse:2` | 3100 → 3000 | Langfuse Web 界面与 API |

### OnlyOffice（文档预览）

| 服务 | 端口 | 说明 |
|------|------|------|
| OnlyOffice Document Server | 8080 | Office 文档在线预览（需单独通过 Docker 启动） |

---

## 快速安装

```bash
# 1. 安装各组件 npm 依赖
cd gateway && npm install && cd ..
cd typescript-sdk && npm install && npm run build && cd ..
cd web-app && npm install && cd ..
cd test && npm install && cd ..

# 2. 启动 Docker 服务（Langfuse）
cd langfuse && docker compose up -d && cd ..

# 3. 一键启动所有服务
./scripts/ctl.sh startup
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_HOST` | `0.0.0.0` | Gateway 绑定地址 |
| `GATEWAY_PORT` | `3000` | Gateway 端口 |
| `GATEWAY_SECRET_KEY` | `test` | Gateway 与 Web App 之间的共享认证密钥 |
| `GOOSED_BIN` | `goosed` | goosed 二进制路径 |
| `PROJECT_ROOT` | 自动检测 | 项目根目录 |
| `VITE_GATEWAY_URL` | `http://127.0.0.1:3000` | Web App 使用的 Gateway URL |
| `OFFICE_PREVIEW_ENABLED` | `true` | 是否启用 OnlyOffice 文档预览 |
| `IDLE_TIMEOUT_MS` | `900000` | 用户实例空闲超时时间（毫秒） |
