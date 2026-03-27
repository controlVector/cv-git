# Local AI Providers

CV-Git supports local LLM inference and embeddings with no cloud dependency.

## What Local AI Powers

- **Embeddings** — Vector representations for semantic code search and RAG context
- **Chat/LLM** — Code analysis, summaries, explanations, reviews, and generation

## Supported Providers

| Provider | Chat | Embeddings | Platform | Setup |
|---|---|---|---|---|
| Ollama | Yes | Yes | Linux, macOS, Windows | `ollama serve` |
| LM Studio | Yes | Yes | Linux, macOS, Windows | `lms server start` |

## Quick Setup

```bash
cv ai setup
```

This interactive wizard detects running providers, lists available models, and saves your preferences.

## Recommended Models

### LM Studio

| Use Case | Model | Notes |
|---|---|---|
| Chat (code) | `lmstudio-community/qwen2.5-coder-7b-instruct-gguf` | Code-focused, fast |
| Chat (general) | `lmstudio-community/meta-llama-3.1-8b-instruct-gguf` | General purpose |
| Embeddings | `nomic-ai/nomic-embed-text-v1.5-gguf` | 768-dim, recommended |

### Ollama

| Use Case | Model | Notes |
|---|---|---|
| Chat (code) | `qwen2.5-coder:14b` | Best local coding model |
| Chat (general) | `llama3.1:8b` | General purpose |
| Embeddings | `nomic-embed-text` | 768-dim, recommended |

## Starting LM Studio Server

- **GUI:** Open LM Studio → Developer tab → Start Server
- **CLI:** `lms server start`
- **Headless:** Enable in LM Studio Settings → Local LLM Service
- Default URL: `http://localhost:1234/v1`

## Starting Ollama

```bash
ollama serve
# Pull an embedding model
ollama pull nomic-embed-text
# Pull a chat model
ollama pull qwen2.5-coder:14b
```

Default URL: `http://localhost:11434`

## Check Status

```bash
cv ai status    # Show configured provider and connectivity
cv doctor       # Full system diagnostics including AI providers
```

## Switch Providers

Re-run the setup wizard to change your provider or models:

```bash
cv ai setup
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CV_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `CV_LMSTUDIO_URL` | `http://localhost:1234/v1` | LM Studio server URL |
| `OLLAMA_HOST` | — | Alternative Ollama URL (standard Ollama env var) |
