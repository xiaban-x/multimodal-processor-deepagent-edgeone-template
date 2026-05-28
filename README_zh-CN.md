# 多模态文件处理助手

基于 EdgeOne Makers 的 AI 文档处理 Agent。支持上传 PDF、Word、Excel、图片、视频、CSV、文本文件，自动分析并提供智能处理选项。

## 功能特性

- **智能文件分析** — 自动检测文件类型，提供针对性处理建议
- **Skills 动态加载** — 根据文件类型按需加载处理技能，节省 ~40% token 消耗
- **交互式推荐** — 每次分析后展示可点击的操作卡片（基于 `suggest_actions` 工具）
- **沙箱执行** — 通过 EdgeOne 沙箱执行真实文件处理（Python、Shell 命令、代码解释器）
- **文件交付** — 生成的文件（PDF 报告、转换后的图片）以可下载链接形式交付
- **中英双语** — 完整的中英文界面，AI 输出自动适配语言
- **实时流式** — SSE 流式传输 + 工具执行进度展示

## 架构

```
前端 (Next.js 16 + React 19)
  └─ POST /chat (SSE 流)
       └─ Anthropic SDK tool-use 循环
            ├─ code_interpreter (Python: Pillow, pandas, matplotlib 等)
            ├─ commands (Shell: ffprobe, ffmpeg, base64 等)
            ├─ files (通过沙箱读写文件)
            ├─ suggest_actions → 前端操作卡片
            └─ deliver_file → 可下载文件输出
  └─ POST /stop
       └─ abortActiveRun() → 优雅取消
```

### Skills 技能系统

系统提示词根据上传文件类型动态构建：

| 文件类型 | 加载的技能 | 能力 |
|---------|-----------|------|
| 图片 (.jpg/.png/.webp) | `SKILL_IMAGE` | 格式转换、压缩、调整尺寸、OCR、水印 |
| CSV | `SKILL_CSV` | 统计分析、数据可视化、导出、数据画像 |
| PDF | `SKILL_PDF` | 文字提取、表格提取、合并 |
| Word (.docx) | `SKILL_WORD` | 文字提取、转换为 PDF |
| Excel (.xlsx) | `SKILL_EXCEL` | 多 Sheet 读取、统计、图表、导出 CSV |
| 视频 (.mp4/.mov) | `SKILL_VIDEO` | 元数据提取、缩略图 |
| 文本/MD/JSON | `SKILL_TEXT` | 摘要、格式转换、翻译、结构分析 |
| 混合（多种类型） | `SKILL_MIXED` | 跨文件分析、合并、对比 |

当用户可能需要生成 PDF 时，自动加载 PDF 生成技能。

### Agent 端点

| 端点 | 功能 |
|------|------|
| `/chat` | 主处理 Agent（SSE 流式、工具循环） |
| `/stop` | 取消当前处理 |
| `/test` | 模型连通性测试 |
| `/health` | 服务健康检查 |
| `/sandbox_test` | 沙箱连通性诊断 |

## 快速开始

### 前置要求

- Node.js 18+
- EdgeOne CLI (`npm i -g @edgeone/cli`)

### 安装

```bash
# 安装依赖
npm install

# 创建 .env 文件
cat > .env << EOF
AI_GATEWAY_API_KEY=your_api_key
AI_GATEWAY_BASE_URL=your_base_url
EOF

# 启动开发服务器
edgeone makers dev
```

### 开发

```bash
# 类型检查
npx tsc --noEmit

# 构建
edgeone makers build

# 测试沙箱连通性
curl -X POST http://localhost:8088/sandbox_test -H 'Content-Type: application/json' -d '{}'
```

## 部署

部署到 EdgeOne Makers：

```bash
edgeone makers deploy
```

沙箱凭证和项目 ID 由部署流水线自动注入，无需手动配置。

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | AI 网关 API Key |
| `AI_GATEWAY_BASE_URL` | 是 | AI 网关地址 |

## 技术栈

- **运行时**：EdgeOne Makers Agent（云函数 + 沙箱）
- **前端**：Next.js 16 + React 19 + Tailwind CSS
- **AI**：Anthropic SDK（`@anthropic-ai/sdk`）手写 tool-use 循环
- **沙箱**：EdgeOne Sandbox（code_interpreter、commands、files）
- **流式传输**：Server-Sent Events (SSE)
- **国际化**：自定义 React Context (zh/en)

## 项目结构

```
├── agents/              # EdgeOne Agent 端点
│   ├── chat/
│   │   └── index.ts    # 主 Agent：技能系统 + tool-use 循环 + SSE
│   ├── _shared.ts      # SSE 工具函数、日志
│   ├── _model.ts       # 模型名称解析
│   ├── stop.ts         # 取消活跃请求
│   ├── test.ts         # 模型连通性测试
│   ├── health.ts       # 健康检查
│   └── sandbox_test.ts # 沙箱诊断
├── app/                 # Next.js 前端
│   ├── page.tsx         # 主页：文件上传、活动流、操作卡片
│   └── layout.tsx       # 根布局 + i18n Provider
├── lib/                 # 工具库
│   └── i18n.tsx         # 翻译文件 (zh/en)
└── edgeone.json         # EdgeOne 平台配置
```

## 许可证

MIT
