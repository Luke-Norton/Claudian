/**
 * Core type definitions for Claudian
 */

export enum PermissionLevel {
  ALLOW = "allow",
  CONFIRM = "confirm",
  REQUIRE = "require",
  DENY = "deny",
}

export interface SkillParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface SkillDefinition {
  name: string;
  description: string;
  permission: PermissionLevel;
  parameters: {
    type: "object";
    properties: Record<string, SkillParameter>;
    required?: string[];
  };
  execute: (params: Record<string, unknown>) => Promise<SkillResult>;
}

export interface SkillResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
  skillName: string;
  parameters: Record<string, unknown>;
  level: PermissionLevel;
  timestamp: number;
}

export interface PermissionResponse {
  approved: boolean;
  reason?: string;
}

export interface SessionConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  workingDir?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface KernelConfig {
  apiKey: string;
  model?: string;
  workingDir?: string;
  permissionTimeout?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface KernelEvents {
  onToolCall?: (call: ToolCall) => void;
  onPermissionRequest?: (request: PermissionRequest) => Promise<PermissionResponse>;
  onStreamChunk?: (chunk: string) => void;
  onError?: (error: Error) => void;
}
