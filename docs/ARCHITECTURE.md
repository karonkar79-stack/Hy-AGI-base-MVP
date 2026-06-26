# Hy-AGI Architecture Documentation

## System Overview

Hy-AGI is a multi-agent AI orchestration platform designed for automated security testing and compliance auditing. The system uses a message-driven architecture with specialized AI agents that collaborate through a central orchestrator.

## Core Components

### 1. Orchestrator Service (LangGraph)

**Responsibilities:**
- Task decomposition from user requests
- Agent selection and dispatching
- Result aggregation and synthesis
- Workflow state management
- Error handling and retry logic

**Technology:**
- LangGraph for stateful agent workflows
- State machine: PENDING → RUNNING → REVIEW → COMPLETE
- Checkpointing for fault tolerance

### 2. Agent Pool

Each agent is an independent worker with:
- **Specialized skills**: Domain-specific security testing capabilities
- **Memory access**: Can read/write to vector, graph, and cache stores
- **Communication**: Pub/sub messaging for inter-agent coordination
- **Cost tracking**: Token usage and API call metering

**Implemented Agents:**
1. **Sr. Pentester**: Deep vulnerability exploitation, PoC generation
2. **GRC Agent**: Compliance framework assessment and gap analysis

**To Be Implemented (Team Members):**
3. Jr. Pentester (Member #1)
4. Web App Tester (Member #2)
5. Security Architect (Member #3)
6. Reviewer (Member #4)

### 3. Memory Systems

#### PostgreSQL + pgvector (Vector Memory)
```sql
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY,
  agent_id VARCHAR(50),
  content TEXT,
  embedding vector(1536),  -- Claude embeddings
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON agent_memories USING ivfflat (embedding vector_cosine_ops);
```

**Use Case**: Semantic search over past findings, similar vulnerability lookup

#### Neo4j (Knowledge Graph)
```cypher
// Node types
(Asset:Target {ip, domain, ports})
(Vulnerability:Finding {cvss, cve, description})
(Agent:Worker {id, type, skills})
(Technique:MITRE {id, tactic, technique})

// Relationships
(Asset)-[:HAS_VULNERABILITY]->(Vulnerability)
(Agent)-[:DISCOVERED]->(Vulnerability)
(Vulnerability)-[:MAPS_TO]->(Technique)
(Vulnerability)-[:SIMILAR_TO]->(Vulnerability)
```

**Use Case**: Attack path analysis, vulnerability correlation, agent collaboration tracking

#### Redis (Short-term Cache)
```
# Keys structure
agent:{agent_id}:state -> hash (status, cost, tokens)
session:{session_id}:context -> list (agent messages)
workflow:{workflow_id}:results -> sorted set (timestamp, result)
cost:total -> counter
cost:agent:{agent_id} -> counter
```

**Use Case**: Real-time state, pub/sub messaging, session management

### 4. Communication Layer

**Redis Pub/Sub Channels:**
```
agent:broadcast           # All agents
agent:{agent_id}:inbox   # Agent-specific messages
workflow:{workflow_id}:events  # Workflow events
system:metrics           # Monitoring events
```

**Message Format:**
```typescript
interface AgentMessage {
  id: string;
  from: string;  // agent_id or 'orchestrator'
  to: string;    // agent_id or 'broadcast'
  type: 'task' | 'result' | 'question' | 'error';
  payload: any;
  timestamp: number;
  correlation_id: string;  // For request/response tracking
}
```

### 5. Security Layer

#### Data Masking
Two-layer approach:

**Layer 1: Regex-based PII Detection**
```typescript
const PII_PATTERNS = {
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  apiKey: /\b[A-Za-z0-9]{32,}\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
};
```

**Layer 2: NER-based Entity Recognition**
Uses spaCy NER model for:
- PERSON names
- ORG organizations
- GPE locations

#### Encryption
```typescript
// AES-256-GCM encryption for sensitive data
const algorithm = 'aes-256-gcm';
const ivLength = 16;
const authTagLength = 16;

encrypt(text: string, key: Buffer): EncryptedData {
  const iv = crypto.randomBytes(ivLength);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  
  return { encrypted, iv, authTag };
}
```

### 6. Monitoring & Metrics

**Prometheus-compatible metrics:**
```typescript
// Counter metrics
agent_tasks_total{agent="sr-pentester", status="success"}
agent_tasks_total{agent="sr-pentester", status="failure"}

// Histogram metrics
agent_task_duration_seconds{agent="sr-pentester"}
llm_api_latency_seconds{model="claude-sonnet-4-6"}

// Gauge metrics
agent_cost_dollars{agent="sr-pentester"}
agent_tokens_total{agent="sr-pentester", type="input"}
agent_active_count
```

**Real-time Dashboard:**
- Active agents
- Token usage per agent
- Cost breakdown
- Task success/failure rate
- Average latency

## Data Flow

### 1. User Initiates Workflow
```
User (Frontend)
  └─> POST /api/workflows
      {
        "target": "example.com",
        "agents": ["sr-pentester", "grc-agent"],
        "budget": 100
      }
```

### 2. Orchestrator Decomposition
```
Orchestrator
  ├─> Analyze request
  ├─> Load agent capabilities from DB
  ├─> Decompose into parallel tasks:
  │   ├─> Task 1: Sr.Pentester → SQLi testing
  │   ├─> Task 2: Sr.Pentester → JWT testing
  │   └─> Task 3: GRC Agent → PCI-DSS audit
  └─> Create workflow state in Redis
```

### 3. Agent Execution
```
For each task:
  Agent
    ├─> Receive task via Redis pub/sub
    ├─> Load memory context (vector search)
    ├─> Execute Claude API call with prompt
    ├─> Parse response & extract findings
    ├─> Store findings in PostgreSQL
    ├─> Update knowledge graph (Neo4j)
    ├─> Track cost/tokens in Redis
    └─> Publish result to orchestrator
```

### 4. Result Aggregation
```
Orchestrator
  ├─> Collect all agent results
  ├─> Cross-validate findings (if Reviewer agent exists)
  ├─> Deduplicate similar vulnerabilities
  ├─> Calculate CVSS scores
  ├─> Generate final report
  └─> Store in PostgreSQL + send to frontend
```

## Agent Implementation Pattern

All agents follow this base class:

```typescript
abstract class BaseAgent {
  id: string;
  type: string;
  skills: Skill[];
  config: AgentConfig;
  
  // Core methods
  abstract execute(task: Task): Promise<Result>;
  
  // Memory methods
  async remember(content: string, metadata?: object): Promise<void>;
  async recall(query: string, limit?: number): Promise<Memory[]>;
  
  // Communication
  async sendMessage(to: string, message: AgentMessage): Promise<void>;
  async broadcastMessage(message: AgentMessage): Promise<void>;
  
  // Monitoring
  trackCost(amount: number): void;
  trackTokens(input: number, output: number): void;
}
```

## Security Architecture

### Defense in Depth

**Layer 1: Network**
- Rate limiting: 100 req/min per IP
- DDoS protection via Cloudflare (when deployed)
- TLS 1.3 only

**Layer 2: Application**
- Input validation on all endpoints (Joi schemas)
- Prepared statements for SQL queries
- CSRF tokens on state-changing operations
- Secure headers (CSP, HSTS, X-Frame-Options)

**Layer 3: Data**
- PII masking before logging
- Encryption at rest (AES-256-GCM)
- Access control per agent (RBAC)

**Layer 4: Monitoring**
- Anomaly detection on API usage
- Cost threshold alerts
- Failed authentication tracking

## Scalability Considerations

### Horizontal Scaling

**Agent Workers:**
```
Agent Pool (can scale to N workers)
  ├─> Worker 1: Sr.Pentester instance
  ├─> Worker 2: Sr.Pentester instance
  └─> Worker N: Sr.Pentester instance

Load Balancer
  └─> Distributes tasks via Redis queue
```

**Database Sharding:**
```
PostgreSQL
  ├─> Shard 1: Findings for targets A-M
  └─> Shard 2: Findings for targets N-Z
```

### Caching Strategy

**L1 Cache (In-Memory)**
- Agent skill definitions
- CVSS score lookup table

**L2 Cache (Redis)**
- Recent workflow results (TTL: 1 hour)
- Agent memory context (TTL: 24 hours)

**L3 Storage (PostgreSQL)**
- Permanent findings
- Audit logs

## Error Handling

### Retry Policy

```typescript
const retryConfig = {
  maxAttempts: 3,
  backoff: 'exponential',  // 1s, 2s, 4s
  retryableErrors: [
    'RateLimitError',
    'TimeoutError',
    'NetworkError'
  ]
};
```

### Circuit Breaker

```typescript
// Protect against cascading failures
const circuitBreaker = {
  threshold: 5,  // failures before open
  timeout: 60000,  // ms to wait before retry
  resetTimeout: 30000  // ms before reset to closed
};
```

## Cost Management

### Budget Enforcement

```typescript
interface BudgetPolicy {
  maxCostPerWorkflow: number;  // USD
  maxCostPerAgent: number;
  maxTokensPerTask: number;
  alertThreshold: number;  // % of budget
}

// Enforced at:
// 1. Workflow creation (pre-check)
// 2. Agent task execution (real-time)
// 3. Orchestrator aggregation (post-check)
```

### Cost Attribution

```
Workflow Cost Breakdown:
├─ Sr. Pentester: $0.62 (45K tokens, Claude Sonnet)
├─ GRC Agent: $0.35 (28K tokens, Claude Sonnet)
├─ Orchestrator: $0.18 (12K tokens, Claude Opus)
└─ Total: $1.15
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Agent task latency (p95) | < 30s | TBD |
| Workflow completion | < 5 min | TBD |
| Concurrent workflows | 10+ | TBD |
| API response time (p95) | < 500ms | TBD |
| Cost per workflow | < $5 | $1.87 |

## Future Enhancements

1. **Agent Learning**: Fine-tune agents on past successful findings
2. **Distributed Tracing**: OpenTelemetry for full request traces
3. **Multi-tenancy**: Isolated environments per organization
4. **Scheduled Scans**: Cron-based recurring workflows
5. **Plugin System**: Community-contributed agents
6. **Federated Learning**: Share anonymized patterns across deployments

---

**Last Updated**: 2026-06-27
**Version**: 1.0.0
**Maintained By**: BIT-CIS Team
