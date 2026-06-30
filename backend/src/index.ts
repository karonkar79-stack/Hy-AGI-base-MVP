/**
 * Hy-AGI Backend Server
 * Main entry point for the multi-agent platform
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import path from 'path';
import { SrPentesterAgent } from './agents/sr-pentester';
import { KnowledgeStore } from './knowledge/KnowledgeStore';
import { IngestionService } from './knowledge/IngestionService';
import { IngestRequest } from './types';
import { logger } from './utils/logger';

// Load environment variables — backend/.env if present, then the repo-root
// .env (where docker-compose and .env.example also live). dotenv does not
// override vars that are already set, so the first definition wins.
config();
config({ path: path.resolve(process.cwd(), '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable for demo
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize agents
const agents: Map<string, any> = new Map();

// Knowledge base (Lark ingestion) — lazily initialized on first use so the
// server still boots without DB / Lark / OpenAI configuration.
let knowledgeStore: KnowledgeStore | null = null;
let ingestionService: IngestionService | null = null;

function getIngestionService(): IngestionService {
  if (!ingestionService) {
    knowledgeStore = new KnowledgeStore();
    ingestionService = new IngestionService(knowledgeStore);
  }
  return ingestionService;
}

async function initializeAgents() {
  try {
    const srPentester = new SrPentesterAgent();
    agents.set('sr-pentester', srPentester);
    logger.info('Agents initialized successfully');
  } catch (error: any) {
    logger.error('Failed to initialize agents:', error);
  }
}

// ============================================================================
// API Routes
// ============================================================================

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    agents: Array.from(agents.keys()),
    timestamp: new Date().toISOString()
  });
});

// Get available agents
app.get('/api/agents', (_req: Request, res: Response) => {
  const agentList = Array.from(agents.values()).map(agent => agent.getMetadata());
  res.json({
    success: true,
    data: agentList
  });
});

// Get agent status
app.get('/api/agents/:id/status', (req: Request, res: Response) => {
  const agent = agents.get(req.params.id);
  if (!agent) {
    return res.status(404).json({
      success: false,
      error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    });
  }

  return res.json({
    success: true,
    data: agent.getStatus()
  });
});

// Execute agent task
app.post('/api/tasks', async (req: Request, res: Response) => {
  const { agent_id, target, skill, parameters } = req.body;

  // Validate input
  if (!agent_id || !target || !skill) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'agent_id, target, and skill are required'
      }
    });
  }

  const agent = agents.get(agent_id);
  if (!agent) {
    return res.status(404).json({
      success: false,
      error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    });
  }

  try {
    const task = {
      id: `task-${Date.now()}`,
      workflowId: 'direct',
      type: 'scan',
      target,
      skillRequired: skill,
      priority: 'medium' as const,
      parameters,
      createdAt: Date.now()
    };

    const result = await agent.execute(task);

    return res.json({
      success: true,
      data: result,
      meta: {
        timestamp: Date.now(),
        requestId: task.id
      }
    });
  } catch (error: any) {
    logger.error('Task execution failed:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'EXECUTION_FAILED',
        message: error.message
      }
    });
  }
});

// Ingest Lark content into the knowledge base
app.post('/api/knowledge/ingest', async (req: Request, res: Response) => {
  const { type, token } = req.body || {};

  if (!type || !token || !['wiki_space', 'doc', 'drive_folder'].includes(type)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: "Body requires { type: 'wiki_space' | 'doc' | 'drive_folder', token: string }"
      }
    });
  }

  try {
    const result = await getIngestionService().ingest({ type, token } as IngestRequest);
    return res.json({
      success: true,
      data: result,
      meta: { timestamp: Date.now(), requestId: `ingest-${Date.now()}` }
    });
  } catch (error: any) {
    logger.error('Knowledge ingest failed:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INGEST_FAILED', message: error.message }
    });
  }
});

// Get system metrics
app.get('/api/metrics', (_req: Request, res: Response) => {
  const metrics = {
    agents: {
      active: agents.size,
      total: agents.size,
      byStatus: { idle: agents.size }
    },
    workflows: {
      active: 0,
      total: 0,
      successRate: 100
    },
    cost: {
      total: 0,
      byAgent: {},
      budget: 100,
      remaining: 100
    },
    tokens: {
      input: 0,
      output: 0,
      total: 0
    }
  };

  // Aggregate agent metrics
  agents.forEach((agent, id) => {
    const agentMetrics = agent.getMetrics();
    metrics.cost.total += agentMetrics.cost;
    (metrics.cost.byAgent as any)[id] = agentMetrics.cost;
    metrics.tokens.input += agentMetrics.tokensInput;
    metrics.tokens.output += agentMetrics.tokensOutput;
    metrics.tokens.total += agentMetrics.tokensInput + agentMetrics.tokensOutput;
  });

  metrics.cost.remaining = metrics.cost.budget - metrics.cost.total;

  res.json({
    success: true,
    data: metrics
  });
});

// Demo endpoint - Generate sample findings
app.get('/api/demo/findings', (_req: Request, res: Response) => {
  const sampleFindings = [
    {
      id: 'demo-1',
      type: 'sqli',
      title: 'SQL Injection in user parameter',
      severity: 'critical',
      cvss: 9.8,
      description: 'Error-based SQL injection detected in /api/v1/users endpoint',
      location: '/api/v1/users?id=1',
      evidence: { payload: "1' OR '1'='1", confirmed: true },
      remediation: 'Use prepared statements and parameterized queries',
      discoveredBy: 'sr-pentester',
      discoveredAt: Date.now()
    },
    {
      id: 'demo-2',
      type: 'xss',
      title: 'Reflected XSS in search parameter',
      severity: 'high',
      cvss: 7.2,
      description: 'User input reflected without encoding in search results',
      location: '/?q=<script>alert(1)</script>',
      evidence: { payload: '<script>alert(document.cookie)</script>', context: 'HTML' },
      remediation: 'Implement context-aware output encoding',
      discoveredBy: 'sr-pentester',
      discoveredAt: Date.now()
    }
  ];

  res.json({
    success: true,
    data: sampleFindings
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('../frontend'));
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile('index.html', { root: '../frontend' });
  });
}

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: any) => {
  logger.error('Unhandled error:', err?.stack || err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(err?.status || err?.statusCode || 500).json({
    success: false,
    error: {
      code: err?.code || err?.type || 'INTERNAL_ERROR',
      message: isProd ? 'An unexpected error occurred' : (err?.message || 'An unexpected error occurred'),
      ...(isProd ? {} : { type: err?.type })
    }
  });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    }
  });
});

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  try {
    // Initialize agents
    await initializeAgents();

    // Start server
    app.listen(PORT, () => {
      logger.info(`✅ Hy-AGI Backend started on port ${PORT}`);
      logger.info(`📡 API: http://localhost:${PORT}/api`);
      logger.info(`🏥 Health: http://localhost:${PORT}/api/health`);
      logger.info(`🤖 Agents: ${Array.from(agents.keys()).join(', ')}`);

      if (process.env.NODE_ENV === 'production') {
        logger.info(`🌐 Frontend: http://localhost:${PORT}`);
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  for (const agent of agents.values()) {
    await agent.shutdown();
  }
  if (knowledgeStore) {
    await knowledgeStore.close();
  }
  process.exit(0);
});

// Start the server
startServer();
