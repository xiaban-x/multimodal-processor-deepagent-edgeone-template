# Multimodal File Processor

AI-powered multi-file analysis workbench built on EdgeOne Pages Agent platform. Upload documents (PDF, images, CSV, text) and get structured analysis with cross-file insights.

## Features

- **Multi-file Processing** — Batch upload and analyze multiple files simultaneously
- **Intelligent Analysis** — AI generates detailed per-file extraction based on file type
- **Cross-file Insights** — Automatic correlation and pattern discovery across documents
- **Bilingual Support** — Full Chinese/English UI with locale-aware AI output
- **Real-time Progress** — SSE streaming with per-file lifecycle tracking
- **Token Usage Tracking** — Monitor AI token consumption per request

## Architecture

```
Frontend (Next.js)
  └─ POST /process (SSE stream)
       └─ model.stream() → per-file analysis markdown
  └─ POST /summarize
       └─ model.invoke() → cross-file summary
  └─ POST /stop
       └─ abortActiveRun() → graceful cancellation
```

### Agent Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/process` | Main file analysis (SSE streaming) |
| `/summarize` | Cross-file summary generation |
| `/test` | Model connectivity test |
| `/health` | Service health check |
| `/stop` | Cancel active processing |

### Key Design Decisions

- **Direct `model.stream()`** instead of `createDeepAgent` — avoids built-in tool interference (see [docs](../docs/deepagents-builtin-tools-interference.md))
- **`ChatOpenAI` direct instantiation** — avoids `initChatModel` OPENAI_API_KEY env check issues
- **No temperature parameter** — compatible with all model providers
- **Shared `_shared.ts`** — unified model caching, logger, env validation, SSE helpers

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
AI_MODEL=@Pages/deepseek-v4-flash
EOF

# Start development server
edgeone dev
```

### Development

```bash
# Type check
npx tsc --noEmit

# Build
npm run build
```

## Deployment

Deploy to EdgeOne Pages:

```bash
edgeone deploy
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | AI Gateway API key |
| `AI_GATEWAY_BASE_URL` | Yes | AI Gateway base URL |
| `AI_MODEL` | No | Model name (default: `@Pages/deepseek-v4-flash`) |

## Tech Stack

- **Runtime**: EdgeOne Pages (Cloud Functions)
- **Frontend**: Next.js 16 + React 19 + Tailwind CSS
- **AI**: LangChain (`@langchain/openai`)
- **Streaming**: Server-Sent Events (SSE)
- **i18n**: Custom React Context (zh/en)

## Project Structure

```
├── agents/           # EdgeOne agent endpoints
│   ├── _shared.ts    # Shared utilities (model, logger, SSE)
│   ├── process.ts    # Main file processing (streaming)
│   ├── summarize.ts  # Cross-file summarization
│   ├── test.ts       # Model connectivity test
│   ├── health.ts     # Health check
│   └── stop.ts       # Cancel active run
├── app/              # Next.js frontend
│   ├── page.tsx      # Main page with file processing UI
│   └── components/   # File upload, queue, results, logs
├── components/ui/    # Reusable UI primitives
├── lib/              # Utilities (i18n, cn)
└── edgeone.json      # EdgeOne platform config
```

## License

MIT
