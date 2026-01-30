/**
 * search skill - Search for files by pattern or content by regex
 * Permission: ALLOW (safe read-only operation)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

const MAX_RESULTS = 100;
const MAX_CONTENT_MATCHES = 50;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB - skip larger files for content search

// Directories to skip
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".cache",
  ".next",
  ".nuxt",
]);

export const searchSkill: SkillDefinition = {
  name: "search",
  description:
    "Search for files or content in the filesystem. " +
    'Use type="files" to find files matching a glob pattern (e.g., "**/*.ts"). ' +
    'Use type="content" to search file contents with a regex pattern.',
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          'For files: glob pattern (e.g., "**/*.ts", "src/**/*.js"). ' +
          'For content: regex pattern (e.g., "function\\s+\\w+", "TODO:").',
      },
      path: {
        type: "string",
        description: "Directory to search in. Defaults to current working directory.",
      },
      type: {
        type: "string",
        description: 'Search type: "files" to find files, "content" to search within files.',
        enum: ["files", "content"],
      },
    },
    required: ["pattern", "type"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const pattern = params.pattern as string;
    const searchType = params.type as "files" | "content";
    const searchPath = params.path as string | undefined;

    const basePath = searchPath
      ? path.isAbsolute(searchPath)
        ? searchPath
        : path.resolve(process.cwd(), searchPath)
      : process.cwd();

    try {
      if (searchType === "files") {
        return await searchFiles(basePath, pattern);
      } else {
        return await searchContent(basePath, pattern);
      }
    } catch (error) {
      return {
        success: false,
        error: `Search failed: ${(error as Error).message}`,
      };
    }
  },
};

async function searchFiles(basePath: string, pattern: string): Promise<SkillResult> {
  const results: string[] = [];
  const globRegex = globToRegex(pattern);

  async function walkDir(dir: string, relativePath: string = ""): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walkDir(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        if (globRegex.test(relPath)) {
          results.push(relPath);
        }
      }
    }
  }

  await walkDir(basePath);

  return {
    success: true,
    output:
      results.length > 0
        ? results.join("\n")
        : "No files found matching pattern",
    metadata: {
      pattern,
      basePath,
      matchCount: results.length,
      truncated: results.length >= MAX_RESULTS,
    },
  };
}

async function searchContent(basePath: string, pattern: string): Promise<SkillResult> {
  const matches: Array<{ file: string; line: number; content: string }> = [];
  let regex: RegExp;

  try {
    regex = new RegExp(pattern, "gi");
  } catch (err) {
    return {
      success: false,
      error: `Invalid regex pattern: ${(err as Error).message}`,
    };
  }

  async function walkDir(dir: string, relativePath: string = ""): Promise<void> {
    if (matches.length >= MAX_CONTENT_MATCHES) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= MAX_CONTENT_MATCHES) break;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walkDir(fullPath, relPath);
        }
      } else if (entry.isFile()) {
        // Skip binary and large files
        const ext = path.extname(entry.name).toLowerCase();
        if (isBinaryExtension(ext)) continue;

        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;

          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length && matches.length < MAX_CONTENT_MATCHES; i++) {
            regex.lastIndex = 0; // Reset regex state
            if (regex.test(lines[i])) {
              matches.push({
                file: relPath,
                line: i + 1,
                content: lines[i].trim().slice(0, 200),
              });
            }
          }
        } catch {
          // Skip files we can't read
        }
      }
    }
  }

  await walkDir(basePath);

  const output = matches
    .map((m) => `${m.file}:${m.line}: ${m.content}`)
    .join("\n");

  return {
    success: true,
    output: output || "No matches found",
    metadata: {
      pattern,
      basePath,
      matchCount: matches.length,
      truncated: matches.length >= MAX_CONTENT_MATCHES,
    },
  };
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/<<GLOBSTAR>>/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function isBinaryExtension(ext: string): boolean {
  const binaryExts = new Set([
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".woff", ".woff2", ".ttf", ".eot",
    ".pyc", ".class", ".o", ".obj",
  ]);
  return binaryExts.has(ext);
}
