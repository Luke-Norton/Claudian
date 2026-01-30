/**
 * read_file skill - Read file contents with optional line range
 * Permission: ALLOW (safe read-only operation)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

export const readFileSkill: SkillDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file. Returns the file content with line numbers. " +
    "Use start_line and end_line to read a specific range of lines.",
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to read",
      },
      start_line: {
        type: "number",
        description: "Starting line number (1-indexed). Defaults to 1.",
      },
      end_line: {
        type: "number",
        description: "Ending line number (inclusive). Defaults to end of file.",
      },
    },
    required: ["path"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const filePath = params.path as string;
    const startLine = (params.start_line as number) || 1;
    const endLine = params.end_line as number | undefined;

    try {
      // Resolve to absolute path
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

      // Check if file exists
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        return {
          success: false,
          error: `Path is not a file: ${absolutePath}`,
        };
      }

      // Read file content
      const content = await fs.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");

      // Apply line range
      const start = Math.max(1, startLine) - 1;
      const end = endLine ? Math.min(endLine, lines.length) : lines.length;
      const selectedLines = lines.slice(start, end);

      // Format with line numbers
      const formatted = selectedLines
        .map((line, idx) => {
          const lineNum = start + idx + 1;
          const padding = String(end).length;
          return `${String(lineNum).padStart(padding, " ")}│ ${line}`;
        })
        .join("\n");

      return {
        success: true,
        output: formatted,
        metadata: {
          path: absolutePath,
          totalLines: lines.length,
          linesReturned: selectedLines.length,
          range: { start: start + 1, end },
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }
      if (err.code === "EACCES") {
        return {
          success: false,
          error: `Permission denied: ${filePath}`,
        };
      }
      return {
        success: false,
        error: `Failed to read file: ${err.message}`,
      };
    }
  },
};
