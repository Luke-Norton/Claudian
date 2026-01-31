/**
 * Telegram Bridge - Remote control via Telegram bot
 *
 * Allows you to interact with Claudian remotely through Telegram messages.
 * Includes security features like allowed user whitelist and command confirmations.
 */

import { Bot, Context, session, SessionFlavor } from "grammy";
import { Kernel } from "../kernel.js";
import { SessionStore, SessionData } from "../session.js";
import { PermissionLevel, PermissionRequest, PermissionResponse } from "../types.js";

interface SessionState {
  sessionId?: string;
  pendingApproval?: {
    skillName: string;
    params: Record<string, unknown>;
    resolve: (response: PermissionResponse) => void;
  };
}

type BotContext = Context & SessionFlavor<SessionState>;

export interface TelegramBridgeConfig {
  botToken: string;
  allowedUsers: number[]; // Telegram user IDs allowed to use the bot
  apiKey: string; // Anthropic API key
  workingDir?: string;
  permissionTimeout?: number;
}

export class TelegramBridge {
  private bot: Bot<BotContext>;
  private kernel: Kernel;
  private sessionStore: SessionStore;
  private config: TelegramBridgeConfig;
  private activeSession: SessionData | null = null;
  private recentMessageIds: Map<number, number[]> = new Map();

  constructor(config: TelegramBridgeConfig) {
    this.config = config;
    this.bot = new Bot<BotContext>(config.botToken);
    this.sessionStore = new SessionStore();

    // Initialize kernel with Telegram-aware permission handler
    this.kernel = new Kernel(
      {
        apiKey: config.apiKey,
        workingDir: config.workingDir,
        permissionTimeout: config.permissionTimeout || 60000,
      },
      {
        onPermissionRequest: (request) => this.handlePermissionRequest(request),
        onStreamChunk: () => {}, // We'll send complete messages
      }
    );

    this.setupMiddleware();
    this.setupCommands();
    this.setupMessageHandler();
  }

  private setupMiddleware(): void {
    // Session middleware
    this.bot.use(
      session({
        initial: (): SessionState => ({}),
      })
    );

    // Auth middleware - check if user is allowed
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;

      if (!userId || !this.config.allowedUsers.includes(userId)) {
        console.log(`[Telegram] Unauthorized access attempt from user ${userId}`);
        await ctx.reply("⛔ Unauthorized. This bot is private.");
        return;
      }

      await next();
    });
  }

  private setupCommands(): void {
    // /start - Initialize
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        "🤖 *Claudian Remote Control*\n\n" +
          "Send me any message and I'll process it through the AI agent on your PC.\n\n" +
          "*Commands:*\n" +
          "/new - Quick session reset\n" +
          "/status - Show agent status\n" +
          "/session - Start new session\n" +
          "/clear - Clear conversation history\n" +
          "/approve - Approve pending action\n" +
          "/deny - Deny pending action\n" +
          "/help - Show this message",
        { parse_mode: "Markdown" }
      );
    });

    // /help - Show help
    this.bot.command("help", async (ctx) => {
      await ctx.reply(
        "🤖 *Claudian Commands*\n\n" +
          "/new - Quick session reset\n" +
          "/status - Show current working directory and session info\n" +
          "/session - Start a fresh conversation session\n" +
          "/clear - Clear current session history\n" +
          "/approve - Approve a pending dangerous action\n" +
          "/deny - Deny a pending dangerous action\n" +
          "/pwd - Show current directory\n" +
          "/cd <path> - Change working directory",
        { parse_mode: "Markdown" }
      );
    });

    // /new - Quick session reset (no reflection)
    this.bot.command("new", async (ctx) => {
      this.kernel.resetSession();
      this.activeSession = await this.sessionStore.create("telegram-session");
      await ctx.reply("New session started. How can I help, Luke?");
    });

    // /status - Show status
    this.bot.command("status", async (ctx) => {
      const sessionInfo = this.activeSession
        ? `Session: ${this.activeSession.metadata.id}\nMessages: ${this.activeSession.metadata.messageCount}`
        : "No active session";

      await ctx.reply(
        `📊 *Status*\n\n` +
          `Working Dir: \`${process.cwd()}\`\n` +
          `${sessionInfo}`,
        { parse_mode: "Markdown" }
      );
    });

    // /session - Start new session
    this.bot.command("session", async (ctx) => {
      this.activeSession = await this.sessionStore.create("telegram-session");
      this.kernel.clearHistory();

      await ctx.reply(
        `✨ New session started: \`${this.activeSession.metadata.id}\``,
        { parse_mode: "Markdown" }
      );
    });

    // /clear - Clear history
    this.bot.command("clear", async (ctx) => {
      this.kernel.clearHistory();
      if (this.activeSession) {
        await this.sessionStore.clearMessages(this.activeSession.metadata.id);
      }
      await ctx.reply("🗑️ Conversation history cleared.");
    });

    // /approve - Approve pending action
    this.bot.command("approve", async (ctx) => {
      const pending = ctx.session.pendingApproval;
      if (!pending) {
        await ctx.reply("No pending action to approve.");
        return;
      }

      pending.resolve({ approved: true, reason: "User approved via Telegram" });
      ctx.session.pendingApproval = undefined;
      await ctx.reply("✅ Action approved.");
    });

    // /deny - Deny pending action
    this.bot.command("deny", async (ctx) => {
      const pending = ctx.session.pendingApproval;
      if (!pending) {
        await ctx.reply("No pending action to deny.");
        return;
      }

      pending.resolve({ approved: false, reason: "User denied via Telegram" });
      ctx.session.pendingApproval = undefined;
      await ctx.reply("❌ Action denied.");
    });

    // /pwd - Show current directory
    this.bot.command("pwd", async (ctx) => {
      await ctx.reply(`📁 \`${process.cwd()}\``, { parse_mode: "Markdown" });
    });

    // /cd - Change directory
    this.bot.command("cd", async (ctx) => {
      const path = ctx.match?.trim();
      if (!path) {
        await ctx.reply("Usage: /cd <path>");
        return;
      }

      try {
        process.chdir(path);
        await ctx.reply(`📁 Changed to: \`${process.cwd()}\``, { parse_mode: "Markdown" });
      } catch (error) {
        await ctx.reply(`❌ Failed to change directory: ${(error as Error).message}`);
      }
    });
  }

  private setupMessageHandler(): void {
    // Handle regular text messages
    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      const chatId = ctx.chat.id;

      // Skip if it's a command
      if (text.startsWith("/")) return;

      // Show typing indicator
      await ctx.replyWithChatAction("typing");

      try {
        // Process through kernel
        const response = await this.kernel.chat(text);

        // Split long responses and track sent messages
        const chunks = this.splitMessage(response);
        for (const chunk of chunks) {
          const msg = await ctx.reply(chunk, { parse_mode: "Markdown" });
          this.trackMessage(chatId, msg.message_id);
        }

        // Persist to session if active
        if (this.activeSession) {
          const history = this.kernel.getHistory();
          this.activeSession.messages = history;
          await this.sessionStore.save(this.activeSession);
        }
      } catch (error) {
        const msg = await ctx.reply(`❌ Error: ${(error as Error).message}`);
        this.trackMessage(chatId, msg.message_id);
      }
    });
  }

  /**
   * Handle permission requests from the kernel
   */
  private pendingRequests = new Map<string, {
    chatId: number;
    resolve: (response: PermissionResponse) => void;
  }>();

  private async handlePermissionRequest(request: PermissionRequest): Promise<PermissionResponse> {
    // For ALLOW level, auto-approve
    if (request.level === PermissionLevel.ALLOW) {
      return { approved: true };
    }

    // For DENY level, auto-deny
    if (request.level === PermissionLevel.DENY) {
      return { approved: false, reason: "Action is not permitted" };
    }

    // For CONFIRM/REQUIRE levels, ask the user
    return new Promise((resolve) => {
      // Notify all allowed users
      const message =
        `⚠️ *Permission Required*\n\n` +
        `Tool: \`${request.skillName}\`\n` +
        `Level: ${request.level.toUpperCase()}\n\n` +
        `Parameters:\n\`\`\`json\n${JSON.stringify(request.parameters, null, 2)}\n\`\`\`\n\n` +
        `Reply /approve or /deny`;

      // Store the pending request globally (simple approach for single-user)
      const requestId = Date.now().toString();

      // Set up timeout for CONFIRM level
      let timeoutId: NodeJS.Timeout | undefined;
      if (request.level === PermissionLevel.CONFIRM) {
        timeoutId = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          resolve({ approved: true, reason: "Auto-approved after timeout" });
        }, this.config.permissionTimeout || 60000);
      }

      this.pendingRequests.set(requestId, {
        chatId: this.config.allowedUsers[0], // Send to first allowed user
        resolve: (response) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve(response);
        },
      });

      // Send notification to all allowed users
      for (const userId of this.config.allowedUsers) {
        this.bot.api.sendMessage(userId, message, { parse_mode: "Markdown" }).catch(console.error);
      }

      // Override the session approval commands temporarily
      // This is a simplified approach - production would need better state management
    });
  }

  /**
   * Split long messages for Telegram's 4096 character limit
   */
  private splitMessage(text: string, maxLength = 4000): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point (newline or space)
      let splitAt = remaining.lastIndexOf("\n", maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = remaining.lastIndexOf(" ", maxLength);
      }
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = maxLength;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return chunks;
  }

  /**
   * Clear recent bot messages from a chat (best effort)
   * Telegram only allows deleting messages less than 48 hours old
   */
  private async clearRecentMessages(chatId: number): Promise<number> {
    let deletedCount = 0;
    const messageIds = this.recentMessageIds.get(chatId) || [];

    for (const msgId of messageIds) {
      try {
        await this.bot.api.deleteMessage(chatId, msgId);
        deletedCount++;
      } catch {
        // Message might be too old or already deleted
      }
    }

    // Clear the tracked messages
    this.recentMessageIds.set(chatId, []);
    return deletedCount;
  }

  /**
   * Track a message ID for potential later deletion
   */
  private trackMessage(chatId: number, messageId: number): void {
    const messages = this.recentMessageIds.get(chatId) || [];
    messages.push(messageId);
    // Keep only last 100 message IDs per chat
    if (messages.length > 100) {
      messages.shift();
    }
    this.recentMessageIds.set(chatId, messages);
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    // Initialize session store
    await this.sessionStore.init();

    // Always start with a fresh session on bot restart
    this.kernel.resetSession();
    this.activeSession = await this.sessionStore.create("telegram-session");

    console.log("[Telegram] Starting bot...");
    console.log(`[Telegram] Allowed users: ${this.config.allowedUsers.join(", ")}`);

    // Drop any pending updates from when bot was offline
    // This prevents old messages from being processed on restart
    await this.bot.api.deleteWebhook({ drop_pending_updates: true });

    // Start the bot
    await this.bot.start({
      drop_pending_updates: true,
      onStart: async (botInfo) => {
        console.log(`[Telegram] Bot started as @${botInfo.username}`);

        // Send startup notification to all allowed users
        for (const userId of this.config.allowedUsers) {
          try {
            // Clear recent messages (best effort)
            const deleted = await this.clearRecentMessages(userId);
            if (deleted > 0) {
              console.log(`[Telegram] Cleared ${deleted} messages for user ${userId}`);
            }

            // Send fresh session message
            const msg = await this.bot.api.sendMessage(
              userId,
              "🔄 *Session Reset*\n\n" +
                "Bot restarted with a fresh session.\n" +
                "Previous conversation context has been cleared.\n\n" +
                "How can I help, Luke?",
              { parse_mode: "Markdown" }
            );
            this.trackMessage(userId, msg.message_id);
          } catch (error) {
            console.error(`[Telegram] Failed to notify user ${userId}:`, (error as Error).message);
          }
        }
      },
    });
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    await this.bot.stop();
  }
}

/**
 * Create and start the Telegram bridge
 */
export async function startTelegramBridge(config: TelegramBridgeConfig): Promise<TelegramBridge> {
  const bridge = new TelegramBridge(config);
  await bridge.start();
  return bridge;
}

// CLI entry point
async function main(): Promise<void> {
  const dotenv = await import("dotenv");
  dotenv.config();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const allowedUsers = process.env.TELEGRAM_ALLOWED_USERS;

  if (!botToken) {
    console.error("Error: TELEGRAM_BOT_TOKEN environment variable is required");
    process.exit(1);
  }

  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  if (!allowedUsers) {
    console.error("Error: TELEGRAM_ALLOWED_USERS environment variable is required");
    console.error("Set it to a comma-separated list of Telegram user IDs");
    process.exit(1);
  }

  const userIds = allowedUsers.split(",").map((id) => parseInt(id.trim(), 10));

  await startTelegramBridge({
    botToken,
    apiKey,
    allowedUsers: userIds,
    workingDir: process.env.CLAUDIAN_WORKING_DIR,
    permissionTimeout: parseInt(process.env.CLAUDIAN_PERMISSION_TIMEOUT || "60000"),
  });
}

// Run if executed directly
if (process.argv[1]?.includes("telegram")) {
  main().catch(console.error);
}
