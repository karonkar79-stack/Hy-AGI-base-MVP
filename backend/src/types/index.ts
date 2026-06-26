/**
 * Core Type Definitions for Hy-AGI Platform
 */

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentConfig {
  maxCost: number;
  maxCalls: number;
  timeout: number;
  temperature: number;
  retryLimit: number;
  model?: string;
  priority?: 'low' | 'medium' | 'high';
  memoryMode?: 'none' | 'vector' | 'graph';
  enabledSkills?: string[];
}

export interface AgentMetadata {
  id: string;
  type: string;
  role: string;
  description: string;
  model: string;
  skills: Skill[];
  config: AgentConfig;
}

export interface AgentMetrics {
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  apiCalls: number;
  tasksCompleted: number;
  tasksFailed: number;
  averageLatency: number;
}

// ============================================================================
// Task Types
// ============================================================================

export interface Task {
  id: string;
  workflowId: string;
  type: string;
  target: string;
  skillRequired: string;
  priority: 'low' | 'medium' | 'high';
  parameters?: Record<string, any>;
  context?: Record<string, any>;
  createdAt: number;
  deadline?: number;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  status: 'completed' | 'failed' | 'partial';
  findings: Finding[];
  metrics: {
    cost: number;
    tokens: number;
    duration: number;
  };
  error?: string;
  createdAt: number;
}

// ============================================================================
// Skill Types
// ============================================================================

export interface Skill {
  name: string;
  description: string;
  category: 'recon' | 'exploit' | 'compliance' | 'analysis' | 'management';
  complexity: 'low' | 'medium' | 'high';
  estimatedCost: number;
  estimatedDuration: number;
  execute: (task: Task, context: any) => Promise<Finding[]>;
}

// ============================================================================
// Finding Types
// ============================================================================

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id?: string;
  type: string;
  title: string;
  severity: Severity;
  cvss?: number;
  description: string;
  location: string;
  evidence: any;
  remediation: string;
  references?: string[];
  tags?: string[];
  mitre?: {
    tactic: string;
    technique: string;
    id: string;
  };
  compliance?: {
    framework: string;
    control: string;
    status: 'pass' | 'fail' | 'partial';
  }[];
  discoveredBy: string;
  discoveredAt: number;
}

// ============================================================================
// Memory Types
// ============================================================================

export interface Memory {
  id: string;
  agentId: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  createdAt: number;
  relevanceScore?: number;
}

export interface MemoryQuery {
  query: string;
  limit?: number;
  filter?: Record<string, any>;
  minRelevance?: number;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageType = 'task' | 'result' | 'question' | 'answer' | 'error' | 'broadcast';

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: MessageType;
  payload: any;
  correlationId?: string;
  timestamp: number;
  priority?: 'low' | 'medium' | 'high';
}

// ============================================================================
// Workflow Types
// ============================================================================

export interface Workflow {
  id: string;
  name: string;
  target: string;
  agents: string[];
  budget: number;
  scope: string;
  documents?: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  findings: Finding[];
  totalCost: number;
  createdAt: number;
  completedAt?: number;
  createdBy: string;
}

export interface WorkflowPhase {
  name: string;
  status: 'pending' | 'running' | 'completed';
  agents: string[];
  startedAt?: number;
  completedAt?: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: number;
    requestId: string;
    cost?: number;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// Security Types
// ============================================================================

export interface MaskedData {
  original: string;
  masked: string;
  entities: {
    type: string;
    value: string;
    position: [number, number];
  }[];
}

export interface EncryptedData {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

// ============================================================================
// Monitoring Types
// ============================================================================

export interface SystemMetrics {
  agents: {
    active: number;
    total: number;
    byStatus: Record<string, number>;
  };
  workflows: {
    active: number;
    total: number;
    successRate: number;
  };
  cost: {
    total: number;
    byAgent: Record<string, number>;
    budget: number;
    remaining: number;
  };
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  performance: {
    avgTaskDuration: number;
    avgApiLatency: number;
    errorRate: number;
  };
}

// ============================================================================
// Database Types
// ============================================================================

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  poolSize?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public agentId?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class BudgetExceededError extends AgentError {
  constructor(agentId: string, used: number, limit: number) {
    super(
      `Budget exceeded: used $${used.toFixed(2)} of $${limit.toFixed(2)}`,
      'BUDGET_EXCEEDED',
      agentId,
      { used, limit }
    );
  }
}

export class TaskTimeoutError extends AgentError {
  constructor(taskId: string, timeout: number) {
    super(
      `Task ${taskId} exceeded timeout of ${timeout}ms`,
      'TASK_TIMEOUT',
      undefined,
      { taskId, timeout }
    );
  }
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
  Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

// ============================================================================
// Constants
// ============================================================================

export const SEVERITY_LEVELS: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

export const MODEL_COSTS = {
  'claude-opus-4-6': { input: 0.015, output: 0.075 },    // per 1K tokens
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5': { input: 0.00025, output: 0.00125 }
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxCost: 5.0,
  maxCalls: 100,
  timeout: 60000,
  temperature: 0.3,
  retryLimit: 3,
  priority: 'medium',
  memoryMode: 'vector'
};
