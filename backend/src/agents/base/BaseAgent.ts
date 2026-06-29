/**
 * BaseAgent - Foundation class for all AI agents
 *
 * Provides core functionality for:
 * - Claude API communication
 * - Memory management (vector, graph, cache)
 * - Inter-agent messaging
 * - Cost and token tracking
 * - Error handling and retries
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { MemoryManager } from '../../memory/MemoryManager';
import { MessageBus } from '../../communication/MessageBus';
import { MetricsCollector } from '../../monitoring/MetricsCollector';
import {
  AgentMetadata,
  Task,
  TaskResult,
  Finding,
  Skill,
  AgentMessage,
  Memory,
  AgentMetrics,
  BudgetExceededError,
  MODEL_COSTS
} from '../../types';

export abstract class BaseAgent {
  protected readonly metadata: AgentMetadata;
  protected readonly anthropic: Anthropic;
  protected readonly memoryManager: MemoryManager;
  protected readonly messageBus: MessageBus;
  protected readonly metricsCollector: MetricsCollector;

  private metrics: AgentMetrics = {
    cost: 0,
    tokensInput: 0,
    tokensOutput: 0,
    apiCalls: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    averageLatency: 0
  };

  constructor(metadata: AgentMetadata) {
    this.metadata = metadata;

    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!
    });

    // Initialize subsystems
    this.memoryManager = new MemoryManager(metadata.id);
    this.messageBus = new MessageBus();
    this.metricsCollector = new MetricsCollector();

    // Subscribe to messages
    this.subscribeToMessages();

    logger.info(`Agent initialized: ${metadata.id} (${metadata.type})`);
  }

  // =========================================================================
  // Abstract Methods - Must be implemented by subclasses
  // =========================================================================

  /**
   * Main execution method - each agent implements its own logic
   */
  abstract execute(task: Task): Promise<TaskResult>;

  // =========================================================================
  // Claude API Methods
  // =========================================================================

  /**
   * Call Claude API with automatic cost tracking
   */
  protected async callClaude(params: {
    messages: { role: 'user' | 'assistant'; content: string }[];
    model?: string;
    max_tokens?: number;
    temperature?: number;
    system?: string;
  }): Promise<{
    content: string;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    const model = params.model || this.metadata.model;
    const startTime = Date.now();

    try {
      // Check budget before API call
      this.checkBudget();

      // Make API call
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: params.max_tokens || 4096,
        temperature: params.temperature ?? this.metadata.config.temperature,
        system: params.system,
        messages: params.messages
      });

      // Extract text content
      const content = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');

      // Track usage
      const usage = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      };

      this.trackUsage(model, usage);

      const latency = Date.now() - startTime;
      this.metricsCollector.recordLatency('claude_api', latency);
      this.metrics.apiCalls++;

      logger.debug(`Claude API call successful: ${usage.input_tokens}/${usage.output_tokens} tokens, ${latency}ms`);

      return { content, usage };

    } catch (error: any) {
      this.metrics.apiCalls++;
      this.metricsCollector.recordError('claude_api');

      if (error.status === 429) {
        logger.warn('Rate limit hit, implementing backoff');
        throw new Error('RATE_LIMIT');
      }

      logger.error(`Claude API error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Call Claude with automatic retry logic
   */
  protected async callClaudeWithRetry(
    params: Parameters<typeof this.callClaude>[0],
    maxRetries?: number
  ): Promise<ReturnType<typeof this.callClaude>> {
    const retries = maxRetries ?? this.metadata.config.retryLimit;
    let lastError: any;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.callClaude(params);
      } catch (error: any) {
        lastError = error;

        // Don't retry on certain errors
        if (error.message === 'BUDGET_EXCEEDED') throw error;
        if (error.status === 401 || error.status === 403) throw error;

        // Implement exponential backoff
        if (attempt < retries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
          logger.warn(`Retry ${attempt + 1}/${retries} after ${backoffMs}ms`);
          await this.sleep(backoffMs);
        }
      }
    }

    throw lastError;
  }

  // =========================================================================
  // Memory Methods
  // =========================================================================

  /**
   * Store a memory for future recall
   */
  protected async remember(content: string, metadata?: Record<string, any>): Promise<void> {
    await this.memoryManager.store({
      agentId: this.metadata.id,
      content,
      metadata: {
        ...metadata,
        timestamp: Date.now()
      }
    });

    logger.debug(`Memory stored: ${content.substring(0, 50)}...`);
  }

  /**
   * Recall similar memories using vector search
   */
  protected async recall(query: string, limit: number = 5): Promise<Memory[]> {
    const memories = await this.memoryManager.search({
      query,
      limit,
      filter: { agentId: this.metadata.id }
    });

    logger.debug(`Recalled ${memories.length} memories for query: ${query}`);
    return memories;
  }

  /**
   * Clear all memories for this agent
   */
  protected async forgetAll(): Promise<void> {
    await this.memoryManager.clear(this.metadata.id);
    logger.info(`All memories cleared for agent: ${this.metadata.id}`);
  }

  // =========================================================================
  // Communication Methods
  // =========================================================================

  /**
   * Send message to specific agent
   */
  protected async sendMessage(to: string, message: Omit<AgentMessage, 'id' | 'from' | 'timestamp'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: uuidv4(),
      from: this.metadata.id,
      timestamp: Date.now()
    };

    await this.messageBus.publish(`agent:${to}:inbox`, fullMessage);
    logger.debug(`Message sent to ${to}: ${message.type}`);
  }

  /**
   * Broadcast message to all agents
   */
  protected async broadcastMessage(message: Omit<AgentMessage, 'id' | 'from' | 'to' | 'timestamp'>): Promise<void> {
    const fullMessage: AgentMessage = {
      ...message,
      id: uuidv4(),
      from: this.metadata.id,
      to: 'broadcast',
      timestamp: Date.now()
    };

    await this.messageBus.publish('agent:broadcast', fullMessage);
    logger.debug(`Message broadcasted: ${message.type}`);
  }

  /**
   * Subscribe to incoming messages
   */
  private subscribeToMessages(): void {
    // Subscribe to agent-specific inbox
    this.messageBus.subscribe(`agent:${this.metadata.id}:inbox`, async (message: AgentMessage) => {
      await this.handleMessage(message);
    });

    // Subscribe to broadcasts
    this.messageBus.subscribe('agent:broadcast', async (message: AgentMessage) => {
      if (message.from !== this.metadata.id) {
        await this.handleMessage(message);
      }
    });
  }

  /**
   * Handle incoming message - can be overridden by subclasses
   */
  protected async handleMessage(message: AgentMessage): Promise<void> {
    logger.debug(`Message received from ${message.from}: ${message.type}`);

    // Default implementation - subclasses can override
    switch (message.type) {
      case 'question':
        logger.info(`Question received: ${message.payload}`);
        break;
      case 'broadcast':
        logger.info(`Broadcast received: ${message.payload}`);
        break;
      default:
        logger.debug(`Unhandled message type: ${message.type}`);
    }
  }

  // =========================================================================
  // Cost & Token Tracking
  // =========================================================================

  /**
   * Track API usage and calculate cost
   */
  private trackUsage(model: string, usage: { input_tokens: number; output_tokens: number }): void {
    const costs = MODEL_COSTS[model as keyof typeof MODEL_COSTS];
    if (!costs) {
      logger.warn(`Unknown model pricing: ${model}`);
      return;
    }

    const inputCost = (usage.input_tokens / 1000) * costs.input;
    const outputCost = (usage.output_tokens / 1000) * costs.output;
    const totalCost = inputCost + outputCost;

    this.metrics.cost += totalCost;
    this.metrics.tokensInput += usage.input_tokens;
    this.metrics.tokensOutput += usage.output_tokens;

    // Record metrics
    this.metricsCollector.recordCost(this.metadata.id, totalCost);
    this.metricsCollector.recordTokens(this.metadata.id, usage.input_tokens, usage.output_tokens);

    logger.debug(`Usage tracked: $${totalCost.toFixed(4)} (${usage.input_tokens}/${usage.output_tokens} tokens)`);
  }

  /**
   * Check if agent is within budget
   */
  private checkBudget(): void {
    if (this.metrics.cost >= this.metadata.config.maxCost) {
      throw new BudgetExceededError(
        this.metadata.id,
        this.metrics.cost,
        this.metadata.config.maxCost
      );
    }

    if (this.metrics.apiCalls >= this.metadata.config.maxCalls) {
      throw new Error(`Max API calls exceeded: ${this.metrics.apiCalls}/${this.metadata.config.maxCalls}`);
    }
  }

  /**
   * Get current metrics
   */
  public getMetrics(): AgentMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current cost
   */
  public getCurrentCost(): number {
    return this.metrics.cost;
  }

  /**
   * Get current token usage
   */
  public getCurrentTokens(): { input: number; output: number; total: number } {
    return {
      input: this.metrics.tokensInput,
      output: this.metrics.tokensOutput,
      total: this.metrics.tokensInput + this.metrics.tokensOutput
    };
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Find skill by name
   */
  protected findSkill(name: string): Skill | undefined {
    return this.metadata.skills.find(skill => skill.name === name);
  }

  /**
   * Validate finding structure
   */
  protected validateFinding(finding: Finding): boolean {
    return !!(
      finding.title &&
      finding.severity &&
      finding.description &&
      finding.location
    );
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log with agent context
   */
  protected log(level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: any[]): void {
    logger[level](`[${this.metadata.id}] ${message}`, ...args);
  }

  // =========================================================================
  // Lifecycle Methods
  // =========================================================================

  /**
   * Cleanup resources
   */
  public async shutdown(): Promise<void> {
    await this.messageBus.unsubscribe(`agent:${this.metadata.id}:inbox`);
    await this.messageBus.unsubscribe('agent:broadcast');
    logger.info(`Agent shutdown: ${this.metadata.id}`);
  }

  /**
   * Get agent metadata
   */
  public getMetadata(): AgentMetadata {
    return { ...this.metadata };
  }

  /**
   * Get agent status
   */
  public getStatus(): {
    id: string;
    type: string;
    status: 'idle' | 'busy';
    metrics: AgentMetrics;
    uptime: number;
  } {
    return {
      id: this.metadata.id,
      type: this.metadata.type,
      status: 'idle', // TODO: Track actual status
      metrics: this.metrics,
      uptime: Date.now() // TODO: Track actual uptime
    };
  }
}
