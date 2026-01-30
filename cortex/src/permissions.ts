/**
 * Permission Gate - Human-in-the-loop permission system
 */

import * as readline from "readline";
import {
  PermissionLevel,
  PermissionRequest,
  PermissionResponse,
  SkillDefinition,
} from "./types.js";

export interface PermissionGateConfig {
  timeout: number; // Timeout for CONFIRM level (auto-approve after timeout)
  onRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;
}

const DEFAULT_CONFIG: PermissionGateConfig = {
  timeout: 30000,
};

export class PermissionGate {
  private config: PermissionGateConfig;
  private permissionOverrides: Map<string, PermissionLevel> = new Map();

  constructor(config: Partial<PermissionGateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Override the permission level for a specific skill
   */
  setOverride(skillName: string, level: PermissionLevel): void {
    this.permissionOverrides.set(skillName, level);
  }

  /**
   * Get the effective permission level for a skill
   */
  getEffectiveLevel(skill: SkillDefinition): PermissionLevel {
    return this.permissionOverrides.get(skill.name) ?? skill.permission;
  }

  /**
   * Check if a tool call is allowed to proceed
   */
  async checkPermission(
    skill: SkillDefinition,
    params: Record<string, unknown>
  ): Promise<PermissionResponse> {
    const level = this.getEffectiveLevel(skill);
    const request: PermissionRequest = {
      skillName: skill.name,
      parameters: params,
      level,
      timestamp: Date.now(),
    };

    switch (level) {
      case PermissionLevel.ALLOW:
        return { approved: true };

      case PermissionLevel.DENY:
        return {
          approved: false,
          reason: `Skill "${skill.name}" is denied by permission policy`,
        };

      case PermissionLevel.CONFIRM:
        return this.handleConfirm(request);

      case PermissionLevel.REQUIRE:
        return this.handleRequire(request);

      default:
        return {
          approved: false,
          reason: `Unknown permission level: ${level}`,
        };
    }
  }

  /**
   * CONFIRM level: Notify user, auto-approve after timeout
   */
  private async handleConfirm(request: PermissionRequest): Promise<PermissionResponse> {
    // If custom handler is provided, use it
    if (this.config.onRequest) {
      return this.config.onRequest(request);
    }

    // Default: CLI prompt with timeout
    return this.promptWithTimeout(request, true);
  }

  /**
   * REQUIRE level: Block until explicit approval
   */
  private async handleRequire(request: PermissionRequest): Promise<PermissionResponse> {
    // If custom handler is provided, use it
    if (this.config.onRequest) {
      return this.config.onRequest(request);
    }

    // Default: CLI prompt without timeout
    return this.promptWithTimeout(request, false);
  }

  /**
   * CLI prompt for permission
   */
  private async promptWithTimeout(
    request: PermissionRequest,
    autoApprove: boolean
  ): Promise<PermissionResponse> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const paramStr = JSON.stringify(request.parameters, null, 2);
      const timeoutStr = autoApprove
        ? ` (auto-approves in ${this.config.timeout / 1000}s)`
        : "";

      console.log("\n" + "=".repeat(60));
      console.log(`PERMISSION REQUEST: ${request.skillName}${timeoutStr}`);
      console.log("=".repeat(60));
      console.log("Parameters:");
      console.log(paramStr);
      console.log("=".repeat(60));

      let timeoutId: NodeJS.Timeout | undefined;

      if (autoApprove) {
        timeoutId = setTimeout(() => {
          console.log("\n[Auto-approved after timeout]");
          rl.close();
          resolve({ approved: true, reason: "Auto-approved after timeout" });
        }, this.config.timeout);
      }

      rl.question("Approve? [y/N]: ", (answer) => {
        if (timeoutId) clearTimeout(timeoutId);
        rl.close();

        const approved = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
        resolve({
          approved,
          reason: approved ? "User approved" : "User denied",
        });
      });
    });
  }
}
