# Claudian

**Local-first AI agent framework for Windows**

Claudian is a modular, extensible AI agent framework designed for software engineers who want full control over their local AI assistant. It runs as an always-on daemon on your Windows machine, executing tasks through a skill-based architecture while keeping you in the loop for dangerous operations.

## Key Features

- **Local-First** — Your data stays on your machine; only API calls leave
- **Human-in-the-Loop** — 4-level permission system (ALLOW, CONFIRM, REQUIRE, DENY)
- **MCP Server** — Expose skills as Model Context Protocol tools for external clients
- **Remote Control** — Telegram bot bridge for controlling your PC from anywhere
- **Session Persistence** — Conversations saved to disk and resumable
- **Extensible** — Add new skills by dropping files in `cortex/src/skills/`

## Architecture Overview

```
┌─────────────────────────────────────┐
│        Remote Bridge Layer          │
│      (Telegram / WhatsApp)          │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│             Kernel                  │
│  Session Manager │ Permission Gate  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│          Skill Layer                │
│  Files │ Search │ Shell │ Git      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│          Claude API                 │
└─────────────────────────────────────┘
```

## Quick Start

```bash
cd cortex
npm install
cp .env.example .env   # Add your ANTHROPIC_API_KEY
npm run build
npm start              # Interactive CLI mode
```

## Documentation

For detailed documentation including:
- Full installation guide
- Skills reference
- Permission levels
- MCP server setup
- Telegram bridge configuration
- Adding custom skills

See **[cortex/README.md](cortex/README.md)**

## Roadmap

- [x] Core kernel + foundational skills
- [x] Session persistence
- [x] MCP server integration
- [x] Telegram bridge
- [ ] WhatsApp bridge
- [ ] Browser automation skills
- [ ] Multi-agent orchestration

## License

MIT
