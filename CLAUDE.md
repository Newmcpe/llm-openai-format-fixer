# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev        # Start dev server with hot reload
bun run start      # Start production server
bun run typecheck  # Run TypeScript type checking
bun test           # Run tests
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `SERVICE_NAME` - Service identifier (default: "llm-openai-proxy")
- `SERVICE_VERSION` - Version string (default: "v1")
- `MODELS` - Comma-separated list of model IDs (default: "custom-llm")
- `CUSTOM_LLM_URL` - Upstream LLM API URL (enables proxy mode when set)
- `CUSTOM_LLM_KEY` - API key for upstream LLM
- `PROXY_KEY` - Optional key to protect proxy endpoints (checked via `x-proxy-key` header or `x-api-key`/`Authorization`
  for Anthropic endpoint)

## Architecture

This is an OpenAI-compatible API proxy built with Bun and Hono. It translates between different LLM API formats.

### Two Operating Modes

1. **Echo Mode** (default): When `CUSTOM_LLM_URL` is not set, returns input as output (useful for testing)
2. **Proxy Mode**: When `CUSTOM_LLM_URL` is set, forwards requests to upstream LLM and translates responses

### API Endpoints

- `GET /v1/models` - List available models
- `POST /v1/responses` - OpenAI Responses API format
- `POST /v1/chat/completions` - OpenAI Chat Completions API format
- `POST /v1/messages` - Anthropic Messages API format (converted to/from OpenAI format upstream)

### Key Components

- `src/services/llmService.ts` - Core service with `EchoLlmService` and `ProxyLlmService` implementations. Contains
  format conversion logic between OpenAI and Anthropic APIs.
- `src/services/factory.ts` - Creates appropriate service based on config
- `src/controllers/apiController.ts` - Route handlers with auth and validation
- `src/utils/responses.ts` - Response builders and type definitions
- `src/config/env.ts` - Environment configuration loading

### Format Conversion

The proxy handles bidirectional conversion:

- Anthropic Messages API requests are converted to OpenAI Chat Completions format before forwarding
- OpenAI responses are converted back to Anthropic format (including streaming SSE translation)
- Tool calls are normalized between formats
