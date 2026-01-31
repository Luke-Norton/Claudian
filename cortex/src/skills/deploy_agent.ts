/**
 * deploy_special_agent skill - Orchestrates specialized sub-agents
 * Permission: CONFIRM (spawns sub-conversations with tool access)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  SkillDefinition,
  PermissionLevel,
  SkillResult,
  AgentManifest,
  AgentDeploymentResult,
  ToolCall,
} from "../types.js";

// Lazy imports to avoid circular dependency with index.ts
let _getSkill: typeof import("./index.js").getSkill;
let _getSkillsAsTools: typeof import("./index.js").getSkillsAsTools;

async function getSkillRegistry() {
  if (!_getSkill || !_getSkillsAsTools) {
    const indexModule = await import("./index.js");
    _getSkill = indexModule.getSkill;
    _getSkillsAsTools = indexModule.getSkillsAsTools;
  }
  return { getSkill: _getSkill, getSkillsAsTools: _getSkillsAsTools };
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// Get the special_agents directory path
function getAgentsDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // In dist/skills/, go up to dist/, then to special_agents/
  // But the JSON files are copied to dist/special_agents/ during build
  // Actually, we need to read from the source or handle this properly
  // For simplicity, we'll use a path relative to cwd or check both locations
  return path.resolve(process.cwd(), "src", "special_agents");
}

/**
 * Load an agent manifest from the special_agents directory
 */
async function loadAgentManifest(agentName: string): Promise<AgentManifest | null> {
  const agentsDir = getAgentsDir();

  // Normalize agent name to filename (lowercase, underscores)
  const normalizedName = agentName.toLowerCase().replace(/\s+/g, "_");
  const manifestPath = path.join(agentsDir, `${normalizedName}.json`);

  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as AgentManifest;
    return manifest;
  } catch (error) {
    // Try exact filename match
    try {
      const files = await fs.readdir(agentsDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const filePath = path.join(agentsDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const manifest = JSON.parse(content) as AgentManifest;
          if (manifest.name.toLowerCase() === agentName.toLowerCase()) {
            return manifest;
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return null;
  }
}

/**
 * List all available agents
 */
async function listAvailableAgents(): Promise<string[]> {
  const agentsDir = getAgentsDir();
  try {
    const files = await fs.readdir(agentsDir);
    const agents: string[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await fs.readFile(path.join(agentsDir, file), "utf-8");
          const manifest = JSON.parse(content) as AgentManifest;
          agents.push(manifest.name);
        } catch {
          // Skip invalid files
        }
      }
    }

    return agents;
  } catch {
    return [];
  }
}

/**
 * Filter tools to only those allowed by the agent
 */
async function filterToolsForAgent(requiredSkills: string[]): Promise<Anthropic.Tool[]> {
  const { getSkillsAsTools } = await getSkillRegistry();
  const allTools = getSkillsAsTools();
  return allTools.filter((tool) => requiredSkills.includes(tool.name)) as Anthropic.Tool[];
}

/**
 * Execute a tool call for the sub-agent
 */
async function executeToolCall(call: ToolCall, allowedSkills: string[]): Promise<ToolResultBlockParam> {
  // Verify skill is allowed
  if (!allowedSkills.includes(call.name)) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Error: Skill "${call.name}" is not authorized for this agent`,
      is_error: true,
    };
  }

  const { getSkill } = await getSkillRegistry();
  const skill = getSkill(call.name);
  if (!skill) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Error: Unknown skill "${call.name}"`,
      is_error: true,
    };
  }

  try {
    // For sub-agents, we auto-approve ALLOW and CONFIRM level skills
    // REQUIRE level skills still need approval (handled by parent kernel)
    if (skill.permission === PermissionLevel.DENY) {
      return {
        type: "tool_result",
        tool_use_id: call.id,
        content: `Error: Skill "${call.name}" is denied`,
        is_error: true,
      };
    }

    const result = await skill.execute(call.input);
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: result.success ? result.output || "(no output)" : `Error: ${result.error}`,
      is_error: !result.success,
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Execution failed: ${(error as Error).message}`,
      is_error: true,
    };
  }
}

/**
 * Run a specialized agent with its mission
 */
async function runAgent(
  manifest: AgentManifest,
  mission: string,
  apiKey: string
): Promise<AgentDeploymentResult> {
  const client = new Anthropic({ apiKey });
  const maxIterations = manifest.max_iterations || DEFAULT_MAX_ITERATIONS;
  const tools = await filterToolsForAgent(manifest.required_skills);
  const skillsInvoked: string[] = [];

  // Build the agent's system prompt
  const systemPrompt = `${manifest.system_prompt}

---
MISSION BRIEFING:
${mission}
---

Execute this mission using your available tools. When complete, provide your final report.`;

  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Mission: ${mission}\n\nProceed with reconnaissance and report back.`,
    },
  ];

  let iterations = 0;
  let finalResult = "";

  while (iterations < maxIterations) {
    iterations++;

    try {
      const response = await client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages,
      });

      // Extract text and tool calls
      const textBlocks: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textBlocks.push(block.text);
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // Add assistant response to messages
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // If no tool calls, mission complete
      if (toolCalls.length === 0) {
        finalResult = textBlocks.join("\n");
        break;
      }

      // Execute tool calls
      const toolResults: ToolResultBlockParam[] = [];
      for (const call of toolCalls) {
        if (!skillsInvoked.includes(call.name)) {
          skillsInvoked.push(call.name);
        }
        const result = await executeToolCall(call, manifest.required_skills);
        toolResults.push(result);
      }

      // Add tool results to messages
      messages.push({
        role: "user",
        content: toolResults,
      });

      // Check for end condition
      if (response.stop_reason === "end_turn" && toolCalls.length === 0) {
        finalResult = textBlocks.join("\n");
        break;
      }
    } catch (error) {
      return {
        success: false,
        agent_name: manifest.name,
        mission,
        error: `Agent execution failed: ${(error as Error).message}`,
        iterations_used: iterations,
        skills_invoked: skillsInvoked,
      };
    }
  }

  // Check if we hit max iterations without completing
  if (iterations >= maxIterations && !finalResult) {
    return {
      success: false,
      agent_name: manifest.name,
      mission,
      error: `Agent reached maximum iterations (${maxIterations}) without completing mission`,
      iterations_used: iterations,
      skills_invoked: skillsInvoked,
    };
  }

  return {
    success: true,
    agent_name: manifest.name,
    mission,
    result: finalResult,
    iterations_used: iterations,
    skills_invoked: skillsInvoked,
  };
}

export const deploySpecialAgentSkill: SkillDefinition = {
  name: "deploy_special_agent",
  description:
    "Deploy a specialized sub-agent to execute a specific mission. " +
    "Each agent has unique expertise and access to specific skills. " +
    "Available agents: Property Scout (real estate), Code Reviewer (code analysis). " +
    "Use list_agents=true to see all available agents. " +
    "Use this when a task requires specialized, focused execution.",
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      agent_name: {
        type: "string",
        description:
          "The name of the special agent to deploy (e.g., 'Property Scout')",
      },
      mission_objective: {
        type: "string",
        description:
          "The specific mission or task for the agent to complete. Be detailed and specific.",
      },
      list_agents: {
        type: "boolean",
        description:
          "If true, returns a list of available agents instead of deploying one.",
      },
    },
    required: ["agent_name", "mission_objective"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const listAgents = params.list_agents as boolean | undefined;

    // List available agents
    if (listAgents) {
      const agents = await listAvailableAgents();
      if (agents.length === 0) {
        return {
          success: true,
          output: "No special agents are currently available.",
        };
      }
      return {
        success: true,
        output: `Available Special Agents:\n${agents.map((a) => `- ${a}`).join("\n")}`,
      };
    }

    const agentName = params.agent_name as string;
    const missionObjective = params.mission_objective as string;

    if (!agentName || !missionObjective) {
      return {
        success: false,
        error: "Both agent_name and mission_objective are required",
      };
    }

    // Load agent manifest
    const manifest = await loadAgentManifest(agentName);
    if (!manifest) {
      const available = await listAvailableAgents();
      return {
        success: false,
        error: `Agent "${agentName}" not found. Available agents: ${available.join(", ") || "none"}`,
      };
    }

    // Verify required skills exist
    const { getSkill } = await getSkillRegistry();
    for (const skillName of manifest.required_skills) {
      const skill = getSkill(skillName);
      if (!skill) {
        return {
          success: false,
          error: `Agent requires skill "${skillName}" which is not available`,
        };
      }
    }

    // Get API key from environment
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "ANTHROPIC_API_KEY not found in environment",
      };
    }

    // Deploy the agent
    console.log(`\n[SPECIAL AGENT] Deploying ${manifest.name}...`);
    console.log(`[SPECIAL AGENT] Mission: ${missionObjective}`);
    console.log(`[SPECIAL AGENT] Authorized skills: ${manifest.required_skills.join(", ")}`);

    const result = await runAgent(manifest, missionObjective, apiKey);

    if (result.success) {
      console.log(`[SPECIAL AGENT] Mission complete. Iterations: ${result.iterations_used}`);

      const output = [
        `=== AGENT REPORT: ${result.agent_name} ===`,
        `Mission: ${result.mission}`,
        `Status: SUCCESS`,
        `Iterations: ${result.iterations_used}`,
        `Skills Used: ${result.skills_invoked.join(", ") || "none"}`,
        ``,
        `--- RESULTS ---`,
        result.result,
      ].join("\n");

      return {
        success: true,
        output,
        metadata: {
          agent_name: result.agent_name,
          iterations: result.iterations_used,
          skills_invoked: result.skills_invoked,
        },
      };
    } else {
      console.log(`[SPECIAL AGENT] Mission failed: ${result.error}`);

      return {
        success: false,
        error: `Agent ${result.agent_name} failed: ${result.error}`,
        metadata: {
          agent_name: result.agent_name,
          iterations: result.iterations_used,
          skills_invoked: result.skills_invoked,
        },
      };
    }
  },
};
