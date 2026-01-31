/**
 * Claudian Kernel - Core daemon that orchestrates AI sessions
 *
 * The kernel:
 * - Maintains stateful conversation sessions with Claude
 * - Routes tool calls to skills via the permission gate
 * - Handles streaming responses for low-latency UX
 * - Supports prompt caching for cost optimization
 * - Integrates with the hybrid memory system
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { getSkill, getSkillsAsTools, getAllSkills } from "./skills/index.js";
import { PermissionGate } from "./permissions.js";
import { initMemoryManager, MemoryManager } from "./memory/index.js";
import {
  KernelConfig,
  KernelEvents,
  ToolCall,
  SkillResult,
} from "./types.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 8192;

const SYSTEM_PROMPT = `You are Claudian, a local AI assistant running on the user's Windows machine.

You have access to tools that let you interact with the local filesystem and execute commands.
Always be helpful, accurate, and security-conscious.

Guidelines:
- Use tools to gather information before making assumptions
- For file operations, prefer reading first to understand context
- For shell commands, explain what you're about to do before executing
- If a task seems dangerous, warn the user and ask for confirmation
- Keep responses concise but informative
- Use store_memory to save important facts you learn about the user or project
- Use query_memory when you need context from previous conversations

Available capabilities:
- Read files with line numbers
- Search for files by pattern or content
- Execute PowerShell commands (requires approval)
- Store and query long-term memories`;

export class Kernel {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private permissionGate: PermissionGate;
  private memoryManager: MemoryManager;
  private conversationHistory: MessageParam[] = [];
  private events: KernelEvents;
  private isProcessing = false;
  private enableReflection: boolean;

  constructor(config: KernelConfig, events: KernelEvents = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = DEFAULT_MAX_TOKENS;
    this.events = events;
    this.enableReflection = config.autoExtractMemories ?? true;

    this.permissionGate = new PermissionGate({
      timeout: config.permissionTimeout || 30000,
      onRequest: events.onPermissionRequest,
    });

    // Initialize memory manager with new SQLite-based config
    this.memoryManager = initMemoryManager({
      apiKey: config.apiKey,
      memoryDir: config.memoryDir,
      enableEmbeddings: true,
    });

    if (config.workingDir) {
      process.chdir(config.workingDir);
    }

    this.log("info", `Kernel initialized with model: ${this.model}`);
    this.log("info", `Working directory: ${process.cwd()}`);
    this.log("info", `Available skills: ${getAllSkills().map((s) => s.name).join(", ")}`);
  }

  /**
   * Send a message to the AI and process the response
   * Returns the final text response after all tool calls are resolved
   */
  async chat(userMessage: string): Promise<string> {
    if (this.isProcessing) {
      throw new Error("Kernel is already processing a message");
    }

    this.isProcessing = true;

    try {
      // Add user message to history
      this.conversationHistory.push({
        role: "user",
        content: userMessage,
      });

      // Process the conversation (may involve multiple rounds of tool calls)
      const response = await this.processConversation();
      return response;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * End the current session and trigger reflection
   * This runs reflectAndSummarize to extract and store key information
   */
  async endSession(): Promise<void> {
    if (!this.enableReflection || this.conversationHistory.length < 2) {
      this.log("info", "Session ended (no reflection needed)");
      this.startNewSession();
      return;
    }

    this.log("info", "Ending session and running reflection...");

    try {
      // Clone history for reflection
      const historySnapshot = [...this.conversationHistory];

      // Run reflection (this extracts facts and saves episode)
      const result = await this.memoryManager.reflectAndSummarize(historySnapshot);

      if (result) {
        this.log("info", `Reflection complete: ${result.keyTakeaways.length} takeaways, ${result.extractedFacts.length} facts extracted`);
      }
    } catch (error) {
      this.log("warn", `Reflection failed: ${(error as Error).message}`);
    }

    // Start fresh session
    this.startNewSession();
  }

  /**
   * Start a new session (clears history, generates new session ID)
   */
  private startNewSession(): void {
    this.conversationHistory = [];
    this.memoryManager.newSession();
    this.log("info", "New session started");
  }

  /**
   * Process the conversation, handling tool calls in a loop
   */
  private async processConversation(): Promise<string> {
    const tools = getSkillsAsTools();
    let finalResponse = "";

    // Build augmented system prompt with core context
    // Note: Only core facts are auto-loaded, not the full knowledge base
    let augmentedPrompt = SYSTEM_PROMPT;
    try {
      augmentedPrompt = await this.memoryManager.buildAugmentedPrompt(SYSTEM_PROMPT);
    } catch (error) {
      this.log("warn", `Failed to augment prompt with memories: ${(error as Error).message}`);
    }

    while (true) {
      // Make API call with streaming
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: [
          {
            type: "text",
            text: augmentedPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: tools as Anthropic.Tool[],
        messages: this.conversationHistory,
      });

      // Collect the response
      const response = await stream.finalMessage();

      // Extract text and tool use blocks
      const textBlocks: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
          this.events.onStreamChunk?.(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // Add assistant response to history
      this.conversationHistory.push({
        role: "assistant",
        content: response.content,
      });

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        finalResponse = textBlocks.join("\n");
        break;
      }

      // Execute tool calls and collect results
      const toolResults = await this.executeToolCalls(toolCalls);

      // Add tool results to history
      this.conversationHistory.push({
        role: "user",
        content: toolResults,
      });

      // Check if we should stop (stop_reason == "end_turn" with tool calls means continue)
      if (response.stop_reason === "end_turn" && toolCalls.length === 0) {
        finalResponse = textBlocks.join("\n");
        break;
      }
    }

    return finalResponse;
  }

  /**
   * Execute tool calls with permission checks
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResultBlockParam[]> {
    const results: ToolResultBlockParam[] = [];

    // Execute tools in parallel (but respect permission checks)
    const executions = toolCalls.map(async (call) => {
      this.events.onToolCall?.(call);
      this.log("info", `Tool call: ${call.name}`);

      const skill = getSkill(call.name);
      if (!skill) {
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: `Error: Unknown tool "${call.name}"`,
          is_error: true,
        };
      }

      // Check permission
      const permission = await this.permissionGate.checkPermission(skill, call.input);
      if (!permission.approved) {
        this.log("warn", `Tool call denied: ${call.name} - ${permission.reason}`);
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: `Permission denied: ${permission.reason}`,
          is_error: true,
        };
      }

      // Execute the skill
      try {
        const result: SkillResult = await skill.execute(call.input);
        this.log("info", `Tool result: ${call.name} - success=${result.success}`);

        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: result.success
            ? result.output || "(no output)"
            : `Error: ${result.error}`,
          is_error: !result.success,
        };
      } catch (error) {
        this.log("error", `Tool execution failed: ${call.name} - ${error}`);
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: `Execution failed: ${(error as Error).message}`,
          is_error: true,
        };
      }
    });

    const settled = await Promise.all(executions);
    results.push(...settled);

    return results;
  }

  /**
   * Clear conversation history (start fresh)
   * @deprecated Use endSession() instead for proper reflection
   */
  clearHistory(): void {
    this.conversationHistory = [];
    this.log("info", "Conversation history cleared");
  }

  /**
   * Get current conversation history
   */
  getHistory(): MessageParam[] {
    return [...this.conversationHistory];
  }

  /**
   * Get memory manager instance (for direct access if needed)
   */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  /**
   * Simple logging utility
   */
  private log(level: "debug" | "info" | "warn" | "error", message: string): void {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    switch (level) {
      case "error":
        console.error(`${prefix} ${message}`);
        break;
      case "warn":
        console.warn(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
}

/**
 * Create and start the kernel daemon
 */
export async function startDaemon(config: KernelConfig): Promise<Kernel> {
  const kernel = new Kernel(config, {
    onToolCall: (call) => {
      console.log(`\n[TOOL] ${call.name}(${JSON.stringify(call.input)})`);
    },
    onStreamChunk: (chunk) => {
      process.stdout.write(chunk);
    },
    onError: (error) => {
      console.error(`\n[ERROR] ${error.message}`);
    },
  });

  return kernel;
}

// CLI entry point
async function main(): Promise<void> {
  // Load environment variables
  const dotenv = await import("dotenv");
  dotenv.config();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  const kernel = await startDaemon({
    apiKey,
    workingDir: process.env.CLAUDIAN_WORKING_DIR,
    permissionTimeout: parseInt(process.env.CLAUDIAN_PERMISSION_TIMEOUT || "30000"),
  });

  console.log("\nClaudian Kernel started. Type your message (or 'exit' to quit):\n");

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question("\nYou: ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit") {
        console.log("Ending session...");
        await kernel.endSession();
        console.log("Goodbye!");
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === "clear") {
        await kernel.endSession();
        console.log("Session ended and history cleared.");
        prompt();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      try {
        console.log("\nClaudian:");
        const response = await kernel.chat(trimmed);
        // Response is already printed via streaming, but add newline if needed
        if (!response.endsWith("\n")) {
          console.log();
        }
      } catch (error) {
        console.error(`\nError: ${(error as Error).message}`);
      }

      prompt();
    });
  };

  prompt();
}

// Run if executed directly
main().catch(console.error);
