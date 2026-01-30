/**
 * Skill Registry - Central registry for all available skills
 */

import { SkillDefinition } from "../types.js";
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

// Registry of all available skills
const skillRegistry = new Map<string, SkillDefinition>();

// Register core skills
const coreSkills: SkillDefinition[] = [
  // File operations
  readFileSkill,
  writeFileSkill,
  editFileSkill,
  // Search
  searchSkill,
  // Shell
  runShellSkill,
  // Git operations
  gitStatusSkill,
  gitDiffSkill,
  gitLogSkill,
  gitCommitSkill,
  gitAddSkill,
];

for (const skill of coreSkills) {
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
};
