# Multimodal File Processor

AI-powered document processing agent built on EdgeOne Makes. Upload files (PDF, Word, Excel, images, video, CSV, text) and get intelligent analysis with interactive processing options.

## Features

- **Smart File Analysis** — Auto-detects file type and provides tailored processing options
- **Skills-Based Architecture** — Dynamically loads only relevant processing skills per file type (saves ~40% tokens)
- **Interactive Suggestions** — Clickable action cards after every analysis (powered by `suggest_actions` tool)
- **Sandbox Execution** — Real file processing via EdgeOne sandbox (Python, shell commands, code interpreter)
- **File Delivery** — Generated files (PDF reports, converted images) delivered as downloadable links
- **Bilingual UI** — Full Chinese/English interface with locale-aware AI output
- **Real-time Streaming** — SSE streaming with tool execution progress

## Architecture

```
Frontend (Next.js 16 + React 19)
  └─ POST /chat (SSE stream)
       └─ Anthropic SDK tool-use loop
            ├─ code_interpreter (Python: Pillow, pandas, matplotlib, etc.)
            ├─ commands (shell: ffprobe, ffmpeg, base64, etc.)
            ├─ files (read/write/list via sandbox)
            ├─ suggest_actions → UI action cards
            └─ deliver_file → downloadable file output
  └─ POST /stop
       └─ abortActiveRun() → graceful cancellation
```

### Skills System

The system prompt is built dynamically based on uploaded file types:

| File Type | Loaded Skill | Capabilities |
|-----------|-------------|--------------|
| Images (.jpg/.png/.webp) | `SKILL_IMAGE` | Format conversion, compression, resize, OCR, watermark |
| CSV | `SKILL_CSV` | Statistics, visualization, export, profiling |
| PDF | `SKILL_PDF` | Text extraction, table extraction, merge |
| Word (.docx) | `SKILL_WORD` | Text extraction, convert to PDF |
| Excel (.xlsx) | `SKILL_EXCEL` | Sheet reading, stats, charts, CSV export |
| Video (.mp4/.mov) | `SKILL_VIDEO` | Metadata extraction, thumbnails |
| Text/MD/JSON | `SKILL_TEXT` | Summarize, reformat, translate, structure analysis |
| Mixed (multiple types) | `SKILL_MIXED` | Cross-file analysis, merge, compare |

PDF Generation skill is auto-loaded when the user might need PDF output.

### Agent Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/chat` | Main processing agent (SSE streaming, tool-use loop) |
| `/stop` | Cancel active processing |
| `/test` | Model connectivity test |
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
edgeone pages dev
```

### Development

```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Test sandbox connectivity
curl -X POST http://localhost:8088/sandbox_test -H 'Content-Type: application/json' -d '{}'
```

## Deployment

Deploy to EdgeOne Makes:

```bash
edgeone pages deploy
```

Sandbox credentials and project ID are automatically injected by the deployment pipeline. No manual configuration needed.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway API key |
| `AI_GATEWAY_BASE_URL` | Yes | AI Gateway base URL |

## Tech Stack

- **Runtime**: EdgeOne Makes Agent (Cloud Functions + Sandbox)
- **Frontend**: Next.js 16 + React 19 + Tailwind CSS
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) with manual tool-use loop
- **Sandbox**: EdgeOne sandbox (code_interpreter, commands, files)
- **Streaming**: Server-Sent Events (SSE)
- **i18n**: Custom React Context (zh/en)

## Project Structure

```
├── agents/              # EdgeOne agent endpoints
│   ├── chat/
│   │   └── index.ts    # Main agent: skills system + tool-use loop + SSE
│   ├── _shared.ts      # SSE helpers, logger
│   ├── _model.ts       # Model name resolution
│   ├── stop.ts         # Cancel active run
│   ├── test.ts         # Model connectivity test
│   ├── health.ts       # Health check
│   └── sandbox_test.ts # Sandbox diagnostics
├── app/                 # Next.js frontend
│   ├── page.tsx         # Main page: file upload, activity feed, action cards
│   └── layout.tsx       # Root layout with i18n provider
├── lib/                 # Utilities
│   └── i18n.tsx         # Translations (zh/en)
└── edgeone.json         # EdgeOne platform config
```

## License

MIT
