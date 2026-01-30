/**
 * MCP Server - Expose Claudian skills via Model Context Protocol
 *
 * This allows external MCP clients to use Claudian's skills as tools.
 * The server runs on stdio or can be configured for other transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getAllSkills, getSkill } from "./skills/index.js";
import { PermissionGate } from "./permissions.js";
import { PermissionLevel } from "./types.js";

export interface MCPServerConfig {
  name?: string;
  version?: string;
  permissionTimeout?: number;
  autoApproveAllowLevel?: boolean; // Auto-approve ALLOW level tools
}

const DEFAULT_CONFIG: MCPServerConfig = {
  name: "claudian",
  version: "0.1.0",
  permissionTimeout: 30000,
  autoApproveAllowLevel: true,
};

export class ClaudianMCPServer {
  private server: Server;
  private permissionGate: PermissionGate;
  private config: MCPServerConfig;

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.server = new Server(
      {
        name: this.config.name!,
        version: this.config.version!,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.permissionGate = new PermissionGate({
      timeout: this.config.permissionTimeout,
    });

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const skills = getAllSkills();

      const tools: Tool[] = skills.map((skill) => ({
        name: skill.name,
        description: `${skill.description} [Permission: ${skill.permission.toUpperCase()}]`,
        inputSchema: {
          type: "object" as const,
          properties: skill.parameters.properties,
          required: skill.parameters.required,
        },
      }));

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const params = (args || {}) as Record<string, unknown>;

      const skill = getSkill(name);
      if (!skill) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Unknown tool "${name}"`,
            },
          ],
          isError: true,
        };
      }

      // Check permission (skip check for ALLOW level if configured)
      if (!(this.config.autoApproveAllowLevel && skill.permission === PermissionLevel.ALLOW)) {
        const permission = await this.permissionGate.checkPermission(skill, params);
        if (!permission.approved) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Permission denied: ${permission.reason}`,
              },
            ],
            isError: true,
          };
        }
      }

      // Execute the skill
      try {
        const result = await skill.execute(params);

        if (result.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: result.output || "(no output)",
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${result.error}`,
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Execution failed: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Start the MCP server with stdio transport
   */
  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error(`[MCP] Claudian MCP server started (${this.config.name} v${this.config.version})`);
    console.error(`[MCP] Available tools: ${getAllSkills().map((s) => s.name).join(", ")}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    await this.server.close();
  }
}

/**
 * Create and start an MCP server
 */
export async function startMCPServer(config?: Partial<MCPServerConfig>): Promise<ClaudianMCPServer> {
  const server = new ClaudianMCPServer(config);
  await server.startStdio();
  return server;
}

// CLI entry point for MCP server mode
async function main(): Promise<void> {
  const dotenv = await import("dotenv");
  dotenv.config();

  await startMCPServer({
    permissionTimeout: parseInt(process.env.CLAUDIAN_PERMISSION_TIMEOUT || "30000"),
  });
}

// Run if executed directly
if (process.argv[1]?.includes("mcp-server")) {
  main().catch((error) => {
    console.error("[MCP] Fatal error:", error);
    process.exit(1);
  });
}
