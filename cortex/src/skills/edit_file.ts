/**
 * edit_file skill - Make targeted edits to files
 * Permission: CONFIRM (modifies filesystem, needs notification)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

export const editFileSkill: SkillDefinition = {
  name: "edit_file",
  description:
    "Make a targeted edit to a file by replacing a specific string with new content. " +
    "The old_string must match exactly (including whitespace). " +
    "Use this for surgical edits rather than rewriting entire files.",
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact string to find and replace (must be unique in the file)",
      },
      new_string: {
        type: "string",
        description: "The string to replace it with",
      },
      replace_all: {
        type: "boolean",
        description: "If true, replace all occurrences. If false (default), the old_string must be unique.",
      },
    },
    required: ["path", "old_string", "new_string"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const filePath = params.path as string;
    const oldString = params.old_string as string;
    const newString = params.new_string as string;
    const replaceAll = (params.replace_all as boolean) || false;

    try {
      // Resolve to absolute path
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

      // Read the file
      const content = await fs.readFile(absolutePath, "utf-8");

      // Check if old_string exists
      if (!content.includes(oldString)) {
        return {
          success: false,
          error: `String not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
        };
      }

      // Check for uniqueness if not replace_all
      if (!replaceAll) {
        const occurrences = content.split(oldString).length - 1;
        if (occurrences > 1) {
          return {
            success: false,
            error: `String appears ${occurrences} times in file. Use replace_all=true or provide more context to make it unique.`,
          };
        }
      }

      // Perform the replacement
      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);

      // Write the file
      await fs.writeFile(absolutePath, newContent, "utf-8");

      const replacements = replaceAll
        ? content.split(oldString).length - 1
        : 1;

      return {
        success: true,
        output: `Made ${replacements} replacement(s) in ${absolutePath}`,
        metadata: {
          path: absolutePath,
          replacements,
          oldLength: oldString.length,
          newLength: newString.length,
          sizeDelta: (newString.length - oldString.length) * replacements,
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
        error: `Failed to edit file: ${err.message}`,
      };
    }
  },
};
