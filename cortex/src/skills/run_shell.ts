/**
 * run_shell skill - Execute PowerShell commands
 * Permission: REQUIRE (potentially dangerous, needs explicit approval)
 */

import { spawn } from "child_process";
import * as path from "path";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_LENGTH = 50000; // 50KB

// Commands that are always blocked
const BLOCKED_PATTERNS = [
  /format\s+[a-z]:/i, // format drive
  /remove-item\s+.*-recurse.*-force.*[a-z]:\\/i, // recursive delete from root
  /rm\s+-rf\s+\//i, // unix-style recursive delete
  /del\s+\/[sf].*\*\.\*/i, // delete all files
  /reg\s+delete\s+hklm/i, // registry deletion
];

export const runShellSkill: SkillDefinition = {
  name: "run_shell",
  description:
    "Execute a PowerShell command on the local Windows system. " +
    "Commands are run in a new PowerShell process. " +
    "Use this for system operations, running scripts, git commands, etc. " +
    "IMPORTANT: This requires explicit user approval before execution.",
  permission: PermissionLevel.REQUIRE,
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The PowerShell command to execute",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command. Defaults to current directory.",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds. Defaults to 30000 (30 seconds).",
      },
    },
    required: ["command"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const command = params.command as string;
    const cwd = params.cwd as string | undefined;
    const timeout = (params.timeout as number) || DEFAULT_TIMEOUT;

    // Check for blocked patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          success: false,
          error: `Command blocked by safety filter: matches pattern ${pattern}`,
        };
      }
    }

    // Resolve working directory
    const workingDir = cwd
      ? path.isAbsolute(cwd)
        ? cwd
        : path.resolve(process.cwd(), cwd)
      : process.cwd();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      const proc = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
        cwd: workingDir,
        windowsHide: true,
        env: { ...process.env },
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)";
          proc.kill();
        }
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_LENGTH) {
          stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)";
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);

        if (killed) {
          resolve({
            success: false,
            error: `Command timed out after ${timeout}ms`,
            output: stdout || undefined,
          });
          return;
        }

        if (code === 0) {
          resolve({
            success: true,
            output: stdout || "(no output)",
            metadata: {
              exitCode: code,
              cwd: workingDir,
            },
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Command exited with code ${code}`,
            output: stdout || undefined,
            metadata: {
              exitCode: code,
              cwd: workingDir,
            },
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `Failed to spawn process: ${err.message}`,
        });
      });
    });
  },
};
