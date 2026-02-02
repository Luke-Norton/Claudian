<div align="center">

# CLAUDIAN

```
     ████████╗██╗  ██╗███████╗
     ╚══██╔══╝██║  ██║██╔════╝
        ██║   ███████║█████╗
        ██║   ██╔══██║██╔══╝
        ██║   ██║  ██║███████╗
        ╚═╝   ╚═╝  ╚═╝╚══════╝
 █████╗ ██╗    ██████╗ ██████╗ ██████╗ ██╗   ██╗
██╔══██╗██║    ██╔══██╗██╔═══██╗██╔══██╗╚██╗ ██╔╝
███████║██║    ██████╔╝██║   ██║██║  ██║ ╚████╔╝
██╔══██║██║    ██╔══██╗██║   ██║██║  ██║  ╚██╔╝
██║  ██║██║    ██████╔╝╚██████╔╝██████╔╝   ██║
╚═╝  ╚═╝╚═╝    ╚═════╝  ╚═════╝ ╚═════╝    ╚═╝
```

<br>

<img src="https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif" width="400" alt="J.A.R.V.I.S.">

<br>

### Build your own J.A.R.V.I.S.

*An open-source framework for creating AI agents that actually do things on your computer.*

<br>

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Claude](https://img.shields.io/badge/Powered%20by-Claude-orange)](https://anthropic.com/)
[![Windows](https://img.shields.io/badge/Platform-Windows-blue?logo=windows)](https://www.microsoft.com/windows)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

<br>

[**Get Started →**](#-get-started) · [**What Can It Do?**](#-what-can-it-do) · [**Documentation**](cortex/README.md)

</div>

---

<br>

## 🎯 The Pitch

You know how in Iron Man, Tony Stark has J.A.R.V.I.S. handling everything? Pulling up schematics, running diagnostics, controlling the suit, ordering pizza?

**This is the open-source skeleton for that.**

We're not giving you a finished product. We're giving you the **foundation** to build your own AI assistant that:

- 🖥️ **Controls your actual computer** — Files, shell, git, browser
- 🧠 **Remembers things** — Persistent memory across conversations
- 🔒 **Asks before doing dangerous stuff** — You stay in control
- 📱 **Works remotely** — Control it from Telegram while you're out
- 🔌 **Extensible AF** — Add new skills in minutes

<br>

<div align="center">
<img src="https://media.giphy.com/media/3o7btNhMBytxAM6YBa/giphy.gif" width="300" alt="Tony Stark">

*"Sometimes you gotta run before you can walk."*
</div>

<br>

---

## 🤖 What Can It Do?

<table>
<tr>
<td width="33%" valign="top">

### 📁 File Operations
Read, write, edit, and search through your files. Create projects, modify configs, grep through codebases.

</td>
<td width="33%" valign="top">

### 🌐 Browser Control
Full automation. Click, type, scroll, screenshot. Connect to YOUR Chrome with all your logins intact.

</td>
<td width="33%" valign="top">

### 🐙 Git Integration
Status, diff, log, add, commit. Manage your repos without touching the terminal.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### 💻 Shell Access
Run PowerShell commands with built-in safety rails. Dangerous patterns are blocked.

</td>
<td width="33%" valign="top">

### 🧠 Memory System
SQLite + embeddings. Remembers facts, preferences, project context across sessions.

</td>
<td width="33%" valign="top">

### 🤖 Sub-Agents
Deploy specialized agents for code review, auditing, or whatever you build.

</td>
</tr>
</table>

<br>

---

## 🚀 Get Started

```bash
# Clone the repo
git clone https://github.com/yourusername/claudian.git
cd claudian/cortex

# Install dependencies
npm install

# Add your API key
cp .env.example .env
# Edit .env → ANTHROPIC_API_KEY=sk-ant-...

# Build and run
npm run build
npm start
```

**That's it.** You're talking to your AI.

<br>

<details>
<summary>📱 <b>Want to control it from your phone?</b></summary>

<br>

Set up Telegram:

```bash
# Add to .env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ALLOWED_USERS=your_telegram_id

# Run with Telegram bridge
npm run start:telegram
```

Now you can message your PC from anywhere.

</details>

<details>
<summary>🔌 <b>Want to use it with Claude Desktop?</b></summary>

<br>

Run as MCP server:

```bash
npm run start:mcp
```

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "claudian": {
      "command": "node",
      "args": ["C:/path/to/claudian/cortex/dist/mcp-server.js"]
    }
  }
}
```

</details>

<br>

---

## 📂 What's Inside

```
claudian/
└── cortex/                 # The brain
    ├── src/
    │   ├── kernel.ts       # Main orchestrator
    │   ├── skills/         # All the abilities (15 built-in)
    │   ├── memory/         # Persistent memory system
    │   ├── bridges/        # Telegram, etc.
    │   └── special_agents/ # Sub-agent configs
    └── README.md           # Full documentation
```

**→ [Read the full docs](cortex/README.md)**

<br>

---

## 🛡️ Safety First

We built this with a **human-in-the-loop** philosophy:

| Level | What happens |
|-------|--------------|
| 🟢 **ALLOW** | Just does it (reading files, searching) |
| 🟡 **CONFIRM** | Tells you what it's about to do, proceeds unless you stop it |
| 🔴 **REQUIRE** | Asks for permission and waits (shell commands, commits) |
| ⛔ **DENY** | Blocked entirely |

You're always in control. The AI can't `rm -rf /` without you saying yes.

<br>

---

## 🗺️ Roadmap

- [x] Core kernel + skills
- [x] Session persistence
- [x] Memory system
- [x] MCP server
- [x] Telegram bridge
- [x] Browser automation (with connect mode!)
- [x] Sub-agent deployment
- [ ] Voice interface
- [ ] Calendar/email integration
- [ ] Scheduled tasks
- [ ] More bridges (Discord, Slack, etc.)

<br>

---

## 🤝 Philosophy

1. **Local-first** — Your data stays on your machine
2. **Open** — MIT license, do whatever you want
3. **Extensible** — Skills are just TypeScript files
4. **Safe** — Humans approve dangerous operations
5. **Minimal** — A foundation, not a finished house

<br>

---

## 📜 License

MIT — Go nuts.

<br>

---

<div align="center">

<img src="https://media.giphy.com/media/JqDeI2yjpSRgdh35oe/giphy.gif" width="250" alt="Let's do this">

<br>

### Ready to build your AI assistant?

**[→ Get started with Cortex](cortex/README.md)**

<br>

*Built by developers, for developers.*

*Now go build something legendary.*

</div>
