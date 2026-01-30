/**
 * Git operations skills - Version control integration
 * Provides git_status, git_diff, git_commit, git_log
 */

import { spawn } from "child_process";
import * as path from "path";
import { SkillDefinition, PermissionLevel, SkillResult } from "../types.js";

const MAX_OUTPUT = 50000;

async function runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const workDir = cwd || process.cwd();
    let stdout = "";
    let stderr = "";

    const proc = spawn("git", args, {
      cwd: workDir,
      windowsHide: true,
    });

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT) + "\n... (output truncated)";
        proc.kill();
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    proc.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

export const gitStatusSkill: SkillDefinition = {
  name: "git_status",
  description:
    "Show the working tree status. Lists changed files, staged changes, and untracked files.",
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the git repository. Defaults to current directory.",
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const repoPath = params.path as string | undefined;
    const cwd = repoPath ? path.resolve(process.cwd(), repoPath) : process.cwd();

    const result = await runGit(["status", "--porcelain=v2", "--branch"], cwd);

    if (result.code !== 0) {
      // Check if it's not a git repo
      if (result.stderr.includes("not a git repository")) {
        return {
          success: false,
          error: `Not a git repository: ${cwd}`,
        };
      }
      return {
        success: false,
        error: result.stderr || `git status failed with code ${result.code}`,
      };
    }

    // Parse the porcelain output for a friendlier display
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const branch = lines.find(l => l.startsWith("# branch.head"))?.split(" ")[2] || "unknown";
    const upstream = lines.find(l => l.startsWith("# branch.upstream"))?.split(" ")[2];

    const changes = lines.filter(l => !l.startsWith("#"));
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of changes) {
      if (line.startsWith("?")) {
        untracked.push(line.slice(2));
      } else if (line.startsWith("1") || line.startsWith("2")) {
        const parts = line.split(" ");
        const xy = parts[1];
        const filename = parts.slice(-1)[0];
        if (xy[0] !== ".") staged.push(filename);
        if (xy[1] !== ".") modified.push(filename);
      }
    }

    let output = `Branch: ${branch}`;
    if (upstream) output += ` (tracking: ${upstream})`;
    output += "\n";

    if (staged.length > 0) {
      output += `\nStaged (${staged.length}):\n  ${staged.join("\n  ")}`;
    }
    if (modified.length > 0) {
      output += `\nModified (${modified.length}):\n  ${modified.join("\n  ")}`;
    }
    if (untracked.length > 0) {
      output += `\nUntracked (${untracked.length}):\n  ${untracked.join("\n  ")}`;
    }
    if (staged.length === 0 && modified.length === 0 && untracked.length === 0) {
      output += "\nWorking tree clean";
    }

    return {
      success: true,
      output,
      metadata: {
        branch,
        upstream,
        staged: staged.length,
        modified: modified.length,
        untracked: untracked.length,
      },
    };
  },
};

export const gitDiffSkill: SkillDefinition = {
  name: "git_diff",
  description:
    "Show changes between commits, commit and working tree, etc. " +
    "By default shows unstaged changes. Use staged=true for staged changes.",
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the git repository. Defaults to current directory.",
      },
      file: {
        type: "string",
        description: "Specific file to diff. If not provided, shows all changes.",
      },
      staged: {
        type: "boolean",
        description: "Show staged changes (--cached). Defaults to false.",
      },
      commit: {
        type: "string",
        description: "Compare against a specific commit (e.g., 'HEAD~1', 'main').",
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const repoPath = params.path as string | undefined;
    const file = params.file as string | undefined;
    const staged = params.staged as boolean | undefined;
    const commit = params.commit as string | undefined;

    const cwd = repoPath ? path.resolve(process.cwd(), repoPath) : process.cwd();

    const args = ["diff", "--no-color"];
    if (staged) args.push("--cached");
    if (commit) args.push(commit);
    if (file) args.push("--", file);

    const result = await runGit(args, cwd);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || `git diff failed with code ${result.code}`,
      };
    }

    return {
      success: true,
      output: result.stdout || "(no changes)",
      metadata: {
        staged: staged || false,
        commit,
        file,
      },
    };
  },
};

export const gitLogSkill: SkillDefinition = {
  name: "git_log",
  description:
    "Show commit history. Returns recent commits with hash, author, date, and message.",
  permission: PermissionLevel.ALLOW,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the git repository. Defaults to current directory.",
      },
      count: {
        type: "number",
        description: "Number of commits to show. Defaults to 10.",
      },
      oneline: {
        type: "boolean",
        description: "Use compact one-line format. Defaults to false.",
      },
      file: {
        type: "string",
        description: "Show commits for a specific file.",
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const repoPath = params.path as string | undefined;
    const count = (params.count as number) || 10;
    const oneline = params.oneline as boolean | undefined;
    const file = params.file as string | undefined;

    const cwd = repoPath ? path.resolve(process.cwd(), repoPath) : process.cwd();

    const args = ["log", `-${count}`, "--no-color"];
    if (oneline) {
      args.push("--oneline");
    } else {
      args.push("--format=%H%n%an <%ae>%n%ai%n%s%n%b%n---");
    }
    if (file) args.push("--", file);

    const result = await runGit(args, cwd);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || `git log failed with code ${result.code}`,
      };
    }

    return {
      success: true,
      output: result.stdout || "(no commits)",
      metadata: {
        count,
        oneline: oneline || false,
        file,
      },
    };
  },
};

export const gitCommitSkill: SkillDefinition = {
  name: "git_commit",
  description:
    "Create a new commit with the staged changes. " +
    "Use git_status first to see what will be committed. " +
    "IMPORTANT: This requires explicit user approval.",
  permission: PermissionLevel.REQUIRE,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the git repository. Defaults to current directory.",
      },
      message: {
        type: "string",
        description: "The commit message.",
      },
      add_all: {
        type: "boolean",
        description: "Stage all changes before committing (git add -A). Defaults to false.",
      },
    },
    required: ["message"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const repoPath = params.path as string | undefined;
    const message = params.message as string;
    const addAll = params.add_all as boolean | undefined;

    const cwd = repoPath ? path.resolve(process.cwd(), repoPath) : process.cwd();

    // Optionally stage all changes
    if (addAll) {
      const addResult = await runGit(["add", "-A"], cwd);
      if (addResult.code !== 0) {
        return {
          success: false,
          error: `Failed to stage changes: ${addResult.stderr}`,
        };
      }
    }

    // Check if there are staged changes
    const statusResult = await runGit(["diff", "--cached", "--stat"], cwd);
    if (!statusResult.stdout.trim()) {
      return {
        success: false,
        error: "No staged changes to commit. Use add_all=true or stage files first.",
      };
    }

    // Create the commit
    const result = await runGit(["commit", "-m", message], cwd);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || `git commit failed with code ${result.code}`,
      };
    }

    // Get the commit hash
    const hashResult = await runGit(["rev-parse", "HEAD"], cwd);
    const commitHash = hashResult.stdout.trim().slice(0, 8);

    return {
      success: true,
      output: `Created commit ${commitHash}: ${message}`,
      metadata: {
        hash: hashResult.stdout.trim(),
        message,
        addAll: addAll || false,
      },
    };
  },
};

export const gitAddSkill: SkillDefinition = {
  name: "git_add",
  description:
    "Stage files for commit. Use this before git_commit to select which changes to include.",
  permission: PermissionLevel.CONFIRM,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the git repository. Defaults to current directory.",
      },
      files: {
        type: "string",
        description: "Files to stage (space-separated). Use '.' for all files.",
      },
    },
    required: ["files"],
  },

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const repoPath = params.path as string | undefined;
    const files = params.files as string;

    const cwd = repoPath ? path.resolve(process.cwd(), repoPath) : process.cwd();

    const fileList = files.split(/\s+/).filter(Boolean);
    const result = await runGit(["add", ...fileList], cwd);

    if (result.code !== 0) {
      return {
        success: false,
        error: result.stderr || `git add failed with code ${result.code}`,
      };
    }

    return {
      success: true,
      output: `Staged: ${fileList.join(", ")}`,
      metadata: {
        files: fileList,
      },
    };
  },
};
