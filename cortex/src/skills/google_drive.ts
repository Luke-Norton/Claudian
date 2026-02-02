/**
 * google_drive skill - Interact with Google Drive via rclone
 * Permission: ALLOW (uses pre-configured rclone)
 */

import { spawn } from "child_process";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

const REMOTE_NAME = "gdrive";
const RCLONE_TIMEOUT = 60000; // 60 seconds

/**
 * Execute an rclone command and return the output
 */
async function runRclone(args: string[]): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn("rclone", args, {
      shell: true,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, output: "", error: "Command timed out" });
    }, RCLONE_TIMEOUT);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Exit code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, output: "", error: err.message });
    });
  });
}

export const googleDriveSkill: SkillDefinition = {
  name: "google_drive",
  description:
    "Interact with Google Drive. Can list files, search, download, upload, and manage files. " +
    "Uses rclone with the 'gdrive' remote.",
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The action to perform",
        enum: ["list", "search", "download", "upload", "delete", "mkdir", "info"],
      },
      path: {
        type: "string",
        description: "Path in Google Drive (e.g., 'Documents/file.txt' or just 'Documents'). Default is root.",
      },
      query: {
        type: "string",
        description: "Search query for 'search' action (searches file names)",
      },
      local_path: {
        type: "string",
        description: "Local file path for download/upload actions",
      },
      recursive: {
        type: "boolean",
        description: "List recursively (for 'list' action). Default false.",
      },
    },
    required: ["action"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const action = params.action as string;
    const drivePath = (params.path as string) || "";
    const query = params.query as string | undefined;
    const localPath = params.local_path as string | undefined;
    const recursive = params.recursive as boolean | undefined;

    const remotePath = drivePath ? `${REMOTE_NAME}:${drivePath}` : `${REMOTE_NAME}:`;

    switch (action) {
      case "list": {
        const args = ["lsf", remotePath, "--format", "pst"];
        if (recursive) {
          args.push("-R");
        }

        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Failed to list files" };
        }

        if (!result.output) {
          return { success: true, output: "(empty folder)" };
        }

        // Parse and format output
        const lines = result.output.split("\n").filter(Boolean);
        const formatted = lines.map((line) => {
          const parts = line.split(";");
          const path = parts[0] || "";
          const size = parts[1] || "";
          const time = parts[2] || "";
          const isDir = path.endsWith("/");
          return `${isDir ? "[DIR] " : "      "}${path}${!isDir && size ? ` (${size})` : ""}`;
        });

        return {
          success: true,
          output: `Files in ${drivePath || "root"}:\n${formatted.join("\n")}`,
          metadata: { count: lines.length },
        };
      }

      case "search": {
        if (!query) {
          return { success: false, error: "Query parameter required for search" };
        }

        // Use rclone ls with grep-like filter
        const args = ["lsf", `${REMOTE_NAME}:`, "-R", "--format", "p"];
        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Search failed" };
        }

        const lines = result.output.split("\n").filter(Boolean);
        const matches = lines.filter((line) =>
          line.toLowerCase().includes(query.toLowerCase())
        );

        if (matches.length === 0) {
          return { success: true, output: `No files found matching "${query}"` };
        }

        return {
          success: true,
          output: `Found ${matches.length} files matching "${query}":\n${matches.slice(0, 50).join("\n")}${matches.length > 50 ? "\n...(truncated)" : ""}`,
          metadata: { count: matches.length },
        };
      }

      case "download": {
        if (!drivePath) {
          return { success: false, error: "Path parameter required for download" };
        }
        if (!localPath) {
          return { success: false, error: "local_path parameter required for download" };
        }

        const args = ["copy", remotePath, localPath, "--progress"];
        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Download failed" };
        }

        return {
          success: true,
          output: `Downloaded ${drivePath} to ${localPath}`,
        };
      }

      case "upload": {
        if (!localPath) {
          return { success: false, error: "local_path parameter required for upload" };
        }

        const args = ["copy", localPath, remotePath, "--progress"];
        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Upload failed" };
        }

        return {
          success: true,
          output: `Uploaded ${localPath} to ${drivePath || "root"}`,
        };
      }

      case "delete": {
        if (!drivePath) {
          return { success: false, error: "Path parameter required for delete" };
        }

        const args = ["delete", remotePath];
        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Delete failed" };
        }

        return {
          success: true,
          output: `Deleted ${drivePath}`,
        };
      }

      case "mkdir": {
        if (!drivePath) {
          return { success: false, error: "Path parameter required for mkdir" };
        }

        const args = ["mkdir", remotePath];
        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Failed to create folder" };
        }

        return {
          success: true,
          output: `Created folder: ${drivePath}`,
        };
      }

      case "info": {
        const args = ["about", `${REMOTE_NAME}:`];
        const result = await runRclone(args);

        if (!result.success) {
          return { success: false, error: result.error || "Failed to get info" };
        }

        return {
          success: true,
          output: `Google Drive Info:\n${result.output}`,
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}. Valid: list, search, download, upload, delete, mkdir, info`,
        };
    }
  },
};
