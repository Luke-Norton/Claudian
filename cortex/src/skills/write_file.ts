/**
 * write_file skill - Write or create files
 * Permission: CONFIRM (modifies filesystem, needs notification)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

export const writeFileSkill: SkillDefinition = {
  name: "write_file",
  description:
    "Write content to a file. Creates the file if it doesn't exist, or overwrites if it does. " +
    "Parent directories will be created automatically if needed.",
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
      append: {
        type: "boolean",
        description: "If true, append to the file instead of overwriting. Defaults to false.",
      },
    },
    required: ["path", "content"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const filePath = params.path as string;
    const content = params.content as string;
    const append = (params.append as boolean) || false;

    try {
      // Resolve to absolute path
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

      // Create parent directories if needed
      const dir = path.dirname(absolutePath);
      await fs.mkdir(dir, { recursive: true });

      // Check if file exists for metadata
      let existed = false;
      let previousSize = 0;
      try {
        const stat = await fs.stat(absolutePath);
        existed = true;
        previousSize = stat.size;
      } catch {
        // File doesn't exist, that's fine
      }

      // Write the file
      if (append) {
        await fs.appendFile(absolutePath, content, "utf-8");
      } else {
        await fs.writeFile(absolutePath, content, "utf-8");
      }

      // Get new file stats
      const newStat = await fs.stat(absolutePath);

      return {
        success: true,
        output: append
          ? `Appended ${content.length} characters to ${absolutePath}`
          : `Wrote ${content.length} characters to ${absolutePath}`,
        metadata: {
          path: absolutePath,
          existed,
          previousSize,
          newSize: newStat.size,
          append,
        },
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EACCES") {
        return {
          success: false,
          error: `Permission denied: ${filePath}`,
        };
      }
      return {
        success: false,
        error: `Failed to write file: ${err.message}`,
      };
    }
  },
};
