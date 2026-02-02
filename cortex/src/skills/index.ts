/**
 * Skill Registry - Central registry for all available skills
 * Supports both static imports and dynamic loading
 */

import { SkillDefinition } from "../types.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

// Registry of all available skills
const skillRegistry = new Map<string, SkillDefinition>();

/**
 * Check if an object is a valid SkillDefinition
 */
function isSkillDefinition(obj: unknown): obj is SkillDefinition {
  if (!obj || typeof obj !== "object") return false;
  const skill = obj as Record<string, unknown>;
  return (
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    typeof skill.permission === "string" &&
    typeof skill.parameters === "object" &&
    typeof skill.execute === "function"
  );
}

/**
 * Dynamically load all skills from the skills directory
 * This is called once during initialization
 */
async function loadSkillsFromDirectory(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // In production, we're in dist/skills, source is src/skills
  // The compiled .js files are what we import
  const skillsDir = __dirname;

  // Get all .js files in the skills directory (excluding index.js)
  const files = fs.readdirSync(skillsDir).filter((file) => {
    return (
      file.endsWith(".js") &&
      file !== "index.js" &&
      !fs.statSync(path.join(skillsDir, file)).isDirectory()
    );
  });

  // Also check subdirectories for index.js files (like memory/)
  const subdirs = fs.readdirSync(skillsDir).filter((file) => {
    const fullPath = path.join(skillsDir, file);
    return fs.statSync(fullPath).isDirectory() && file !== "node_modules";
  });

  // Load skills from root-level files
  for (const file of files) {
    try {
      const modulePath = pathToFileURL(path.join(skillsDir, file)).href;
      const module = await import(modulePath);

      // Look for skill exports in the module
      for (const [exportName, exportValue] of Object.entries(module)) {
        if (isSkillDefinition(exportValue)) {
          if (!skillRegistry.has(exportValue.name)) {
            skillRegistry.set(exportValue.name, exportValue);
          }
        }
      }
    } catch (error) {
      console.error(`[Skills] Failed to load ${file}:`, (error as Error).message);
    }
  }

  // Load skills from subdirectory index files
  for (const subdir of subdirs) {
    const indexPath = path.join(skillsDir, subdir, "index.js");
    if (fs.existsSync(indexPath)) {
      try {
        const modulePath = pathToFileURL(indexPath).href;
        const module = await import(modulePath);

        for (const [exportName, exportValue] of Object.entries(module)) {
          if (isSkillDefinition(exportValue)) {
            if (!skillRegistry.has(exportValue.name)) {
              skillRegistry.set(exportValue.name, exportValue);
            }
          }
        }
      } catch (error) {
        console.error(`[Skills] Failed to load ${subdir}/index.js:`, (error as Error).message);
      }
    }
  }
}

// Initialize skills on module load
let initialized = false;
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = loadSkillsFromDirectory().then(() => {
    initialized = true;
    console.log(`[Skills] Loaded ${skillRegistry.size} skills: ${Array.from(skillRegistry.keys()).join(", ")}`);
  });

  return initPromise;
}

// Synchronous fallback for immediate access before async init completes
// This uses static imports for critical skills
import { readFileSkill } from "./read_file.js";
import { writeFileSkill } from "./write_file.js";
import { editFileSkill } from "./edit_file.js";
import { runShellSkill } from "./run_shell.js";
import { searchSkill } from "./search.js";
import {
  gitStatusSkill,
  gitDiffSkill,
  gitLogSkill,
  gitCommitSkill,
  gitAddSkill,
} from "./git.js";
import {
  storeMemorySkill,
  queryMemorySkill,
  forgetMemorySkill,
} from "./memory/index.js";
import { browseWebSkill } from "./web_browser.js";
import { deploySpecialAgentSkill } from "./deploy_agent.js";

// Pre-register static skills immediately
const staticSkills: SkillDefinition[] = [
  readFileSkill,
  writeFileSkill,
  editFileSkill,
  searchSkill,
  runShellSkill,
  gitStatusSkill,
  gitDiffSkill,
  gitLogSkill,
  gitCommitSkill,
  gitAddSkill,
  storeMemorySkill,
  queryMemorySkill,
  forgetMemorySkill,
  browseWebSkill,
  deploySpecialAgentSkill,
];

for (const skill of staticSkills) {
  skillRegistry.set(skill.name, skill);
}

export function getSkill(name: string): SkillDefinition | undefined {
  return skillRegistry.get(name);
}

export function getAllSkills(): SkillDefinition[] {
  return Array.from(skillRegistry.values());
}

export function registerSkill(skill: SkillDefinition): void {
  if (skillRegistry.has(skill.name)) {
    throw new Error(`Skill "${skill.name}" is already registered`);
  }
  skillRegistry.set(skill.name, skill);
}

export function unregisterSkill(name: string): boolean {
  return skillRegistry.delete(name);
}

export function getSkillsAsTools(): Array<{
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}> {
  return getAllSkills().map((skill) => ({
    name: skill.name,
    description: skill.description,
    input_schema: skill.parameters,
  }));
}

/**
 * Initialize dynamic skill loading
 * Call this during application startup for async skill discovery
 */
export async function initializeSkills(): Promise<void> {
  await ensureInitialized();
}

// Export individual skills for direct use
export {
  readFileSkill,
  writeFileSkill,
  editFileSkill,
  runShellSkill,
  searchSkill,
  gitStatusSkill,
  gitDiffSkill,
  gitLogSkill,
  gitCommitSkill,
  gitAddSkill,
  storeMemorySkill,
  queryMemorySkill,
  forgetMemorySkill,
  browseWebSkill,
  deploySpecialAgentSkill,
};
