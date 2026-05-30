# Multimodal Processor

AI-powered document processing agent built on EdgeOne Makers. Upload files (PDF, Word, Excel, images, video, CSV, text) and get intelligent analysis with interactive processing options.

## Features

- **Smart File Analysis** — Auto-detects file type and provides tailored processing options
- **Skills-Based Architecture** — Dynamically loads only relevant processing skills per file type (saves ~40% tokens)
- **Interactive Suggestions** — Clickable action cards after every analysis (powered by `suggest_actions` tool)
- **Sandbox Execution** — Real file processing via EdgeOne sandbox (Python, shell commands, code interpreter)
- **File Delivery** — Generated files (PDF reports, converted images) delivered as downloadable links
- **Bilingual UI** — Full Chinese/English interface with locale-aware AI output
- **Real-time Streaming** — SSE streaming with tool execution progress and live code output

## Architecture

```
Frontend (Next.js 16 + React 19)
  └─ POST /chat (SSE stream)
       └─ Claude Agent SDK query() loop
            ├─ EdgeOne sandbox MCP server  (via context.tools.toClaudeMcpServer())
            │    ├─ code_interpreter (Python: Pillow, pandas, matplotlib, etc.)
            │    ├─ commands (shell: ffprobe, ffmpeg, base64, etc.)
            │    └─ files_read / files_write / files_list / …
            └─ Custom tools MCP server     (via createSdkMcpServer())
                 ├─ suggest_actions → UI action cards
                 └─ deliver_file → downloadable file output
  └─ POST /stop
       └─ AbortController → graceful cancellation
```

### SSE Event Types

| Event | Payload | Description |
|-------|---------|-------------|
| `text_delta` | `{ delta }` | Incremental assistant text |
| `tool_called` | `{ tool, input }` | Tool invocation started |
| `code_output` | `{ stdout }` | Python/code stdout |
| `code_error` | `{ stderr }` | Python/code stderr or exception |
| `suggest_actions` | `{ actions[] }` | Clickable action cards |
| `file_output` | `{ filename, base64, description }` | Downloadable file |

### Skills System

The system prompt is built dynamically based on uploaded file types:

| File Type | Loaded Skill | Capabilities |
|-----------|-------------|--------------|
| Images (.jpg/.png/.webp) | `SKILL_IMAGE` | Format conversion, compression, resize, watermark |
| CSV | `SKILL_CSV` | Statistics, visualization, export, profiling |
| PDF | `SKILL_PDF` | Text extraction, table extraction, merge |
| Word (.docx) | `SKILL_WORD` | Text extraction, convert to PDF |
| Excel (.xlsx) | `SKILL_EXCEL` | Sheet reading, stats, charts, CSV export |
| Video (.mp4/.mov) | `SKILL_VIDEO` | Metadata extraction, thumbnails |
| Text/MD/JSON | `SKILL_TEXT` | Summarize, reformat, translate, structure analysis |
| Mixed (multiple types) | `SKILL_MIXED` | Cross-file analysis, merge, compare |

PDF Generation skill (`SKILL_PDF_GENERATION`) is auto-loaded when PDF output may be needed. It injects ready-to-run Python templates using matplotlib + PdfPages with full CJK font support.

### Agent Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/chat` | Main processing agent (SSE streaming, tool-use loop) |
| `/stop` | Cancel active processing |
| `/test` | Model connectivity test |
| `/gateway_test` | AI Gateway latency/timeout diagnostics |
| `/health` | Health check |
| `/sandbox_test` | Sandbox connectivity diagnostics |

## Getting Started

### Prerequisites

- Node.js 18+
- EdgeOne CLI (`npm i -g @edgeone/cli`)

### Setup

```bash
# Install dependencies
npm install

# Create .env file
cat > .env << EOF
AI_GATEWAY_API_KEY=your_api_key
AI_GATEWAY_BASE_URL=your_base_url
EOF

# Start development server
edgeone makers dev
```

### Development

```bash
# Type check
npx tsc --noEmit

# Build
edgeone makers build

# Test sandbox connectivity
curl -X POST http://localhost:8088/sandbox_test -H 'Content-Type: application/json' -d '{}'

# Test model connectivity
curl -X POST http://localhost:8088/test -H 'Content-Type: application/json' -d '{"message":"hello"}'
```

## Deployment

Deploy to EdgeOne Makers:

```bash
edgeone makers deploy
```

Sandbox credentials and project ID are automatically injected by the deployment pipeline. No manual configuration needed.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway API key |
| `AI_GATEWAY_BASE_URL` | Yes | AI Gateway base URL |

### Obtaining Environment Variables

Both variables are provided by the **EdgeOne Makers** platform:

1. Open the [EdgeOne console](https://console.cloud.tencent.com/edgeone) and navigate to **EdgeOne Makers**.
2. Create or open your project, then go to **Settings → Environment Variables**.
3. Copy the auto-generated values for `AI_GATEWAY_API_KEY` and `AI_GATEWAY_BASE_URL` into your local `.env` file.

> These values are project-scoped credentials issued by the EdgeOne AI Gateway. They are automatically injected into the runtime environment on deployment — you only need them locally for `edgeone makers dev`.

## Tech Stack

- **Runtime**: EdgeOne Makers Agent (Cloud Functions + Sandbox)
- **Frontend**: Next.js 16 + React 19 + Tailwind CSS
- **AI**: Anthropic Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with dual MCP server pattern
- **Sandbox**: EdgeOne sandbox via `context.tools.toClaudeMcpServer()` (code_interpreter, commands, files)
- **Streaming**: Server-Sent Events (SSE)
- **i18n**: Custom React Context (zh/en)

## Project Structure

```
├── agents/
│   ├── chat/
│   │   ├── index.ts      # Main agent: session mgmt, file upload, SSE loop
│   │   ├── skills.ts     # Skills system: dynamic system prompt builder
│   │   ├── templates.ts  # PDF/chart Python code templates (CJK font support)
│   │   └── tools.ts      # Helpers: shellQuote, canInlineFallbackFile, buildDefaultActions
│   ├── _shared.ts        # SSE helpers (sseEvent, createSSEResponse), logger
│   ├── _model.ts         # Model name resolution, gateway env mapping
│   ├── stop.ts           # Cancel active run
│   ├── test.ts           # Model connectivity test
│   ├── gateway_test.ts   # AI Gateway latency diagnostics
│   ├── health.ts         # Health check
│   └── sandbox_test.ts   # Sandbox diagnostics
├── app/
│   ├── page.tsx          # Main page: file upload, activity feed, action cards
│   └── layout.tsx        # Root layout with i18n provider
├── lib/
│   └── i18n.tsx          # Translations (zh/en)
└── edgeone.json          # EdgeOne platform config
```

## License

MIT
