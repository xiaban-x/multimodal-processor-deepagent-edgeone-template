# 多模态文件处理助手

基于 EdgeOne Pages Agent 平台的 AI 多文件分析工作台。支持批量上传文档（PDF、图片、CSV、文本），AI 自动提取结构化信息并生成跨文件关联洞察。

## 功能特性

- **多文件批量处理** — 同时上传和分析多个文件
- **智能分析** — AI 根据文件类型生成针对性的结构化提取
- **跨文件洞察** — 自动发现多文档间的关联模式和共性
- **双语支持** — 中文 / English 界面一键切换，AI 输出跟随语言偏好
- **实时进度** — SSE 流式输出 + 每个文件独立的生命周期追踪
- **Token 统计** — 每次请求的 AI Token 消耗监控

## 架构

```
前端 (Next.js)
  └─ POST /process (SSE 流)
       └─ model.stream() → 逐文件分析（Markdown）
  └─ POST /summarize
       └─ model.invoke() → 跨文件综合总结
  └─ POST /stop
       └─ abortActiveRun() → 优雅取消
```

### Agent 端点

| 端点 | 功能 |
|------|------|
| `/process` | 主文件分析（SSE 流式输出） |
| `/summarize` | 跨文件综合总结 |
| `/test` | 模型连通性测试 |
| `/health` | 服务健康检查 |
| `/stop` | 取消正在进行的处理 |

### 设计要点

- **直接使用 `model.stream()`** — 避免 DeepAgent 内置工具干扰
- **`ChatOpenAI` 直接实例化** — 规避 `initChatModel` 的环境变量检查
- **不设 temperature 参数** — 兼容所有模型提供方
- **统一 `_shared.ts`** — 模型缓存、Logger、环境变量校验、SSE 工具

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cat > .env << EOF
AI_GATEWAY_API_KEY=your_api_key
AI_GATEWAY_BASE_URL=your_base_url
AI_MODEL=@Pages/deepseek-v4-flash
EOF

# 启动开发服务器（需要 EdgeOne CLI）
edgeone pages dev

# 修改 agents/ 下文件后需强制重建：
rm -rf .edgeone/agent-node && edgeone pages dev
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | AI Gateway API Key |
| `AI_GATEWAY_BASE_URL` | 是 | AI Gateway Base URL |
| `AI_MODEL` | 否 | 模型名称（默认 `@Pages/deepseek-v4-flash`） |

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 运行时 | EdgeOne Pages (Cloud Functions) | agent-node 容器 |
| 前端 | Next.js 16 + React 19 + Tailwind CSS | App Router |
| AI | LangChain (`@langchain/openai`) | ChatOpenAI 流式调用 |
| 通信 | Server-Sent Events (SSE) | 实时进度推送 |
| 国际化 | 自定义 React Context (zh/en) | 一键切换 |

## 支持的文件类型

| 类型 | 格式 | AI 分析方式 |
|------|------|-------------|
| 文档 | PDF, DOCX, TXT, MD | 内容提取 + 结构化摘要 |
| 图片 | PNG, JPG, SVG | 视觉描述 + 文字识别 |
| 数据 | CSV, XLSX, JSON | 数据概览 + 统计分析 |
| 代码 | JS, TS, PY 等 | 代码解读 + 功能说明 |

## 项目结构

```
multimodal-processor-edgeone/
├── agents/               # Agent 端点
│   ├── _shared.ts        # 公共工具（模型、日志、SSE）
│   ├── process.ts        # 主文件处理（流式分析）
│   ├── summarize.ts      # 跨文件综合总结
│   ├── test.ts           # 模型连通性测试
│   ├── health.ts         # 健康检查
│   └── stop.ts           # 取消处理
├── app/                  # Next.js 前端
│   ├── page.tsx          # 主页面（文件上传 + 分析结果）
│   └── components/
│       ├── file-upload.tsx      # 文件上传区域（拖拽 + 点击）
│       ├── file-queue.tsx       # 文件处理队列
│       ├── analysis-result.tsx  # 单文件分析结果
│       ├── summary-panel.tsx    # 跨文件总结面板
│       └── processing-log.tsx   # 处理日志
├── components/ui/         # 通用 UI 组件
├── lib/
│   ├── i18n.tsx          # 中英文翻译
│   └── utils.ts
├── edgeone.json          # EdgeOne 部署配置
└── package.json
```

## 使用流程

```
1. 拖拽或点击上传多个文件
2. 系统自动识别文件类型并加入处理队列
3. 点击「开始分析」→ SSE 流式返回每个文件的分析结果
4. 所有文件分析完毕后，可点击「生成总结」获取跨文件洞察
5. 支持随时取消正在进行的分析
```

## 部署

```bash
edgeone pages deploy
```

部署后即可使用，无需额外配置。
