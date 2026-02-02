# 🧠 CORTEX

<div align="center">

```
   ██████╗ ██████╗ ██████╗ ████████╗███████╗██╗  ██╗
  ██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝
  ██║     ██║   ██║██████╔╝   ██║   █████╗   ╚███╔╝
  ██║     ██║   ██║██╔══██╗   ██║   ██╔══╝   ██╔██╗
  ╚██████╗╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗
   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
```

**The skeleton for your AI Iron Man suit.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Claude](https://img.shields.io/badge/Claude-Anthropic-orange?logo=anthropic&logoColor=white)](https://anthropic.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<img src="https://media.giphy.com/media/l0HlNQ03J5JxX6lva/giphy.gif" width="300" alt="Iron Man Suit Up">

*Your local-first AI agent framework. Clone it. Extend it. Make it yours.*

[Quick Start](#-quick-start) • [Skills](#-skills) • [Browser Automation](#-browser-automation) • [Memory System](#-memory-system) • [Add Your Own](#-adding-custom-skills)

</div>

---

## 🤔 What is this?

Cortex is a **bare-bones AI agent framework** designed to be the foundation for your personal AI assistant. Think of it as the nervous system - we give you the brain (Claude), the hands (skills), and the memory (persistence). You add the personality.

```
You: "Hey, can you check my GitHub notifications, summarize them,
      and draft responses to any urgent ones?"

Cortex: *opens your actual Chrome browser*
        *logs in with YOUR cookies*
        *does the thing*
        *comes back with results*
```

**It's not a product. It's a starting point.**

---

## ✨ What's in the Box

<table>
<tr>
<td width="50%">

### 🛠️ 15 Core Skills
- **File Ops**: Read, write, edit, search
- **Git**: Status, diff, log, add, commit
- **Shell**: PowerShell with safety rails
- **Memory**: Store, query, forget
- **Web**: Full browser automation
- **Agents**: Deploy specialized sub-agents

</td>
<td width="50%">

### 🔒 Human-in-the-Loop
```
ALLOW   → Just do it
CONFIRM → "Hey, I'm about to..." (auto-approves)
REQUIRE → "Can I?" (waits for you)
DENY    → Nope, never
```

</td>
</tr>
<tr>
<td width="50%">

### 🧠 Memory That Persists
- SQLite + semantic embeddings
- Core facts auto-load every conversation
- Query memories on demand
- Session summaries for context

</td>
<td width="50%">

### 🌐 Multiple Interfaces
- **CLI**: Interactive terminal
- **MCP**: Plug into Claude Desktop
- **Telegram**: Control from your phone

</td>
</tr>
</table>

---

## 🚀 Quick Start

```bash
# Clone it
git clone https://github.com/yourusername/cortex.git
cd cortex

# Install
npm install

# Configure (add your ANTHROPIC_API_KEY)
cp .env.example .env

# Build & Run
npm run build
npm start
```

<details>
<summary>📱 Want Telegram control?</summary>

```bash
# Add to .env:
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ALLOWED_USERS=your_user_id

# Run
npm run start:telegram
```

</details>

---

## 🎯 Skills

| Skill | Permission | What it does |
|-------|:----------:|--------------|
| `read_file` | 🟢 | Read any file |
| `write_file` | 🟡 | Create/overwrite files |
| `edit_file` | 🟡 | Find & replace in files |
| `search` | 🟢 | Glob patterns + regex content search |
| `run_shell` | 🔴 | PowerShell (dangerous patterns blocked) |
| `git_status` | 🟢 | Working tree status |
| `git_diff` | 🟢 | See changes |
| `git_log` | 🟢 | Commit history |
| `git_add` | 🟡 | Stage files |
| `git_commit` | 🔴 | Create commits |
| `store_memory` | 🟢 | Save facts for later |
| `query_memory` | 🟢 | Semantic search your memories |
| `forget_memory` | 🟢 | Delete memories |
| `browse_web` | 🟡 | Full browser automation |
| `deploy_special_agent` | 🟢 | Spawn focused sub-agents |

🟢 ALLOW &nbsp;&nbsp; 🟡 CONFIRM &nbsp;&nbsp; 🔴 REQUIRE

---

## 🌐 Browser Automation

This isn't your grandma's web scraper. **Full Playwright-powered browser control.**

### Modes

| Mode | What happens |
|------|--------------|
| `headless` | Fast, invisible (default) |
| `visible` | Watch it work |
| `chrome` | Launch Chrome (temp profile) |
| `connect` | **Control YOUR Chrome with all your logins** 🔥 |

### The Magic: Connect Mode

```powershell
# Step 1: Launch Chrome with debugging
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# Step 2: Agent connects to YOUR browser
# Now it has all your cookies, logins, everything
```

### Actions Available

```
navigate, click, double_click, type, fill, clear, press,
scroll, scroll_to, hover, select, check, uncheck,
screenshot, wait, extract, get_text, get_attribute,
get_url, get_title, go_back, go_forward, reload,
new_tab, switch_tab, close_tab, list_tabs,
evaluate (run JS), handle_dialog
```

### Example: Check Gmail

```json
{
  "mode": "connect",
  "actions": [
    { "action": "navigate", "url": "https://mail.google.com" },
    { "action": "wait", "selector": "div[role='main']" },
    { "action": "extract" }
  ]
}
```

If you're logged in, it just works. No auth setup needed.

---

## 🧠 Memory System

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR BRAIN                           │
├─────────────────────────────────────────────────────────┤
│  CORE FACTS          │  KNOWLEDGE         │  EPISODES  │
│  (auto-loaded)       │  (query on demand) │  (history) │
│                      │                    │            │
│  "User prefers       │  "React component  │  Session   │
│   dark mode"         │   patterns..."     │  summaries │
│                      │                    │            │
│  "Working on         │  "API endpoint     │  What we   │
│   Project X"         │   documentation"   │  talked    │
│                      │                    │  about     │
└──────────────────────┴────────────────────┴────────────┘
```

**Core facts** load automatically every conversation. Everything else is pulled on-demand via `query_memory` to save tokens.

---

## 🤖 Special Agents

Deploy focused sub-agents for specific tasks:

```json
{
  "agent": "code_reviewer",
  "mission": "Review the auth module for security issues"
}
```

Built-in agents:
- **Auditor**: Project health checks
- **Code Reviewer**: Security, bugs, performance analysis

Add your own in `src/special_agents/` as JSON manifests.

---

## 🔧 Adding Custom Skills

Drop a file in `src/skills/`:

```typescript
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

export const mySkill: SkillDefinition = {
  name: "my_skill",
  description: "Does something cool",
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "The thing" },
    },
    required: ["input"],
  },
  async execute(params): Promise<SkillResult> {
    // Your code here
    return { success: true, output: "Done!" };
  },
};
```

Register in `src/skills/index.ts`. That's it.

---

## 📁 Project Structure

```
cortex/
├── src/
│   ├── kernel.ts              # The brain
│   ├── permissions.ts         # Human-in-the-loop gate
│   ├── session.ts             # Conversation persistence
│   ├── mcp-server.ts          # MCP protocol support
│   ├── skills/
│   │   ├── index.ts           # Skill registry
│   │   ├── read_file.ts       # File reading
│   │   ├── write_file.ts      # File writing
│   │   ├── edit_file.ts       # File editing
│   │   ├── search.ts          # File/content search
│   │   ├── run_shell.ts       # Shell execution
│   │   ├── git.ts             # Git operations
│   │   ├── web_browser.ts     # Browser automation
│   │   ├── deploy_agent.ts    # Sub-agent deployment
│   │   └── memory/            # Memory skills
│   ├── memory/
│   │   ├── manager.ts         # Memory orchestration
│   │   ├── db.ts              # SQLite backend
│   │   └── embedding-service.ts
│   ├── special_agents/        # Agent manifests (JSON)
│   └── bridges/
│       └── telegram.ts        # Telegram bot
├── .claudian/
│   ├── sessions/              # Saved conversations
│   └── memories.db            # SQLite memory store
└── package.json
```

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Your Claude API key |
| `CLAUDIAN_PERMISSION_TIMEOUT` | | Auto-approve timeout (ms, default: 30000) |
| `CLAUDIAN_WORKING_DIR` | | Default working directory |
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_USERS` | For Telegram | Your Telegram user ID |

---

## 🗺️ What's NOT Included (Yet)

This is a **skeleton**. Intentionally minimal. Some things you might want to add:

- 📅 Calendar integration
- 📧 Email access
- 🔔 Notifications/reminders
- ⏰ Scheduled tasks
- 🎤 Voice interface
- 🏠 Smart home control

The architecture supports all of this. We just didn't build it for you.

---

## 🤝 Philosophy

1. **Local-first**: Your data stays on your machine
2. **Extensible**: Skills are just TypeScript files
3. **Safe by default**: Human approval for dangerous ops
4. **Minimal**: We give you the foundation, not the whole house

---

## 📜 License

MIT - Do whatever you want with it.

---

<div align="center">

**Built for developers who want AI that actually does things.**

<img src="https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif" width="200" alt="Coding">

*Now go build something cool.*

</div>
