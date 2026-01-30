# Claudian

**Local-first AI agent framework for Windows**

Claudian is a modular, extensible AI agent framework designed for software engineers who want full control over their local AI assistant. It runs as an always-on daemon on your Windows machine, executing tasks through the Model Context Protocol (MCP) while keeping you in the loop for dangerous operations.

## Features

- **Local-First**: Your data never leaves your machine except for API calls
- **Human-in-the-Loop**: Permission system with 4 levels (ALLOW, CONFIRM, REQUIRE, DENY)
- **MCP Server**: Expose skills as MCP tools for external clients
- **Remote Control**: Telegram bot bridge for controlling your PC remotely
- **Session Persistence**: Conversations are saved to disk and can be resumed
- **Extensible**: Add new skills by dropping files in `src/skills/`

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REMOTE BRIDGE LAYER                             │
│                  (Telegram / WhatsApp Message Gateway)                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ Commands / Responses
┌────────────────────────────────▼────────────────────────────────────────┐
│                              KERNEL                                     │
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │ Session        │  │ Permission      │  │ Session Store           │  │
│  │ Manager        │  │ Gate (HITL)     │  │ (persistent)            │  │
│  │                │  │                 │  │                         │  │
│  │ • Conversation │  │ • ALLOW         │  │ • JSON file storage     │  │
│  │ • Tool state   │  │ • CONFIRM       │  │ • Auto-resume           │  │
│  │ • Streaming    │  │ • REQUIRE       │  │ • Session history       │  │
│  └────────────────┘  │ • DENY          │  └─────────────────────────┘  │
│                      └─────────────────┘                                │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ Tool Calls
┌────────────────────────────────▼────────────────────────────────────────┐
│                           SKILL LAYER                                   │
│                    (MCP-Compatible Tool Definitions)                    │
│                                                                         │
│  File Operations    Search         Shell          Git                   │
│  ┌────────────┐   ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ read_file  │   │ search   │  │ run_shell│  │ git_status/diff/log  │ │
│  │ write_file │   │ (ALLOW)  │  │ (REQUIRE)│  │ git_add/commit       │ │
│  │ edit_file  │   └──────────┘  └──────────┘  └──────────────────────┘ │
│  └────────────┘                                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ Streaming + Tool Use
┌────────────────────────────────▼────────────────────────────────────────┐
│                          CLAUDE API                                     │
│   • Streaming responses • Prompt caching • Parallel tool execution      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- Windows 10/11
- Claude API key

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/claudian.git
cd claudian/cortex

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Build
npm run build
```

### Running

```bash
# Interactive CLI mode
npm start

# As MCP server (for external clients)
npm run start:mcp

# With Telegram remote control
npm run start:telegram
```

## Project Structure

```
cortex/
├── src/
│   ├── kernel.ts           # Main daemon entry point
│   ├── session.ts          # Persistent session storage
│   ├── permissions.ts      # HITL permission gate
│   ├── mcp-server.ts       # MCP server for external clients
│   ├── types.ts            # Core type definitions
│   ├── skills/
│   │   ├── index.ts        # Skill registry
│   │   ├── read_file.ts    # Read files (ALLOW)
│   │   ├── write_file.ts   # Write files (CONFIRM)
│   │   ├── edit_file.ts    # Edit files (CONFIRM)
│   │   ├── search.ts       # Search files/content (ALLOW)
│   │   ├── run_shell.ts    # PowerShell execution (REQUIRE)
│   │   └── git.ts          # Git operations (mixed)
│   └── bridges/
│       └── telegram.ts     # Telegram bot bridge
├── dist/                   # Compiled JS
├── .claudian/
│   └── sessions/           # Persisted conversation sessions
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Skills Reference

### File Operations

| Skill | Permission | Description |
|-------|------------|-------------|
| `read_file` | ALLOW | Read file contents with optional line range |
| `write_file` | CONFIRM | Write or create files (creates parent dirs) |
| `edit_file` | CONFIRM | Make targeted string replacements |

### Search

| Skill | Permission | Description |
|-------|------------|-------------|
| `search` | ALLOW | Find files by glob or search content by regex |

### Shell

| Skill | Permission | Description |
|-------|------------|-------------|
| `run_shell` | REQUIRE | Execute PowerShell commands (safety filtered) |

### Git Operations

| Skill | Permission | Description |
|-------|------------|-------------|
| `git_status` | ALLOW | Show working tree status |
| `git_diff` | ALLOW | Show changes (staged or unstaged) |
| `git_log` | ALLOW | Show commit history |
| `git_add` | CONFIRM | Stage files for commit |
| `git_commit` | REQUIRE | Create a commit |

## Permission Levels

| Level | Behavior | Use Case |
|-------|----------|----------|
| `ALLOW` | Auto-approve, execute immediately | Read-only operations |
| `CONFIRM` | Notify user, auto-approve after timeout | File modifications |
| `REQUIRE` | Block until explicit user approval | Shell commands, commits |
| `DENY` | Never execute | Dangerous operations |

## MCP Server Mode

Run Claudian as an MCP server to allow external clients (like Claude Desktop) to use its tools:

```bash
npm run start:mcp
```

Configure in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "claudian": {
      "command": "node",
      "args": ["C:/path/to/claudian/cortex/dist/mcp-server.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## Telegram Bridge

Control your PC remotely via Telegram:

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Get your user ID from [@userinfobot](https://t.me/userinfobot)
3. Configure `.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_ALLOWED_USERS=your_user_id
   ```
4. Start the bridge:
   ```bash
   npm run start:telegram
   ```

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Initialize and show help |
| `/status` | Show agent status and session info |
| `/session` | Start a new conversation session |
| `/clear` | Clear conversation history |
| `/approve` | Approve a pending dangerous action |
| `/deny` | Deny a pending dangerous action |
| `/pwd` | Show current working directory |
| `/cd <path>` | Change working directory |

## Session Persistence

Conversations are automatically saved to `.claudian/sessions/` as JSON files. Sessions include:

- Full message history
- Metadata (created/updated timestamps, working directory)
- Can be exported/imported for backup

## Adding Custom Skills

Create a new file in `src/skills/`:

```typescript
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

export const myCustomSkill: SkillDefinition = {
  name: "my_skill",
  description: "What this skill does",
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "The input parameter",
      },
    },
    required: ["input"],
  },
  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const input = params.input as string;
    // Your implementation here
    return {
      success: true,
      output: `Processed: ${input}`,
    };
  },
};
```

Then register it in `src/skills/index.ts`:

```typescript
import { myCustomSkill } from "./my_skill.js";
// Add to coreSkills array
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Your Claude API key |
| `CLAUDIAN_PERMISSION_TIMEOUT` | No | 30000 | Timeout for CONFIRM level (ms) |
| `CLAUDIAN_WORKING_DIR` | No | cwd | Working directory |
| `TELEGRAM_BOT_TOKEN` | For Telegram | - | Telegram bot token |
| `TELEGRAM_ALLOWED_USERS` | For Telegram | - | Allowed user IDs (comma-separated) |

## Security Considerations

- **Shell Command Filtering**: Dangerous patterns (format drive, recursive delete) are blocked
- **User Whitelist**: Telegram bridge only responds to configured user IDs
- **Permission Gate**: All tool calls pass through the permission system
- **Local Storage**: Sessions are stored locally, not uploaded anywhere

## Roadmap

- [x] V0.1: Core kernel + foundational skills
- [x] V0.2: Session persistence
- [x] V0.3: MCP server integration
- [x] V0.4: Telegram bridge
- [ ] V0.5: WhatsApp bridge
- [ ] V0.6: Browser automation skills
- [ ] V0.7: Multi-agent orchestration
- [ ] V0.8: Plugin marketplace

## License

MIT
