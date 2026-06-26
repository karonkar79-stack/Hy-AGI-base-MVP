# Hy-AGI Base MVP

**Multi-Agent AI-Powered Security Operations Platform**

## 🎯 Project Overview

Hy-AGI is an enterprise-grade multi-agent orchestration platform for automated penetration testing and security compliance auditing. It uses AI agents with specialized skills to collaborate on comprehensive security assessments.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (HTML5)                         │
│  Workflow Builder · Real-time Monitoring · Report View       │
└────────────────┬────────────────────────────────────────────┘
                 │ WebSocket + REST API
┌────────────────┴────────────────────────────────────────────┐
│              Backend (Node.js + TypeScript)                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Orchestrator Service (LangGraph)             │   │
│  │  Task Decomposition · Agent Dispatch · Aggregation   │   │
│  └─────────────┬────────────────────────────────────────┘   │
│                │                                              │
│  ┌─────────────┴──────────────┬─────────────────────────┐   │
│  │  Agent Pool (Workers)      │   Communication Layer    │   │
│  │  ┌──────┬──────┬──────┐    │   ┌─────────────────┐   │   │
│  │  │ Sr.  │ Jr.  │ Web  │    │   │ Redis Pub/Sub   │   │   │
│  │  │Pent. │Pent. │Tester│◄───┼───┤ Message Queue   │   │   │
│  │  └──────┴──────┴──────┘    │   └─────────────────┘   │   │
│  │  ┌──────┬──────┬──────┐    │                          │   │
│  │  │ GRC  │Arch. │Review│    │   Security Layer         │   │
│  │  │Agent │Agent │ er   │    │   ┌─────────────────┐   │   │
│  │  └──────┴──────┴──────┘    │   │ • Data Masking  │   │   │
│  └────────────────────────────┘   │ • Encryption    │   │   │
│                                    │ • Rate Limiting │   │   │
│  Memory Systems                    └─────────────────┘   │   │
│  ┌──────────────────────────────────────────────────┐   │   │
│  │ PostgreSQL + pgvector (Vector Search)            │   │   │
│  │ Neo4j (Knowledge Graph)                          │   │   │
│  │ Redis (Short-term Cache + Session)               │   │   │
│  └──────────────────────────────────────────────────┘   │   │
└──────────────────────────────────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │  External Services    │
              │  • Anthropic Claude   │
              │  • Security Tools     │
              └───────────────────────┘
```

## 🚀 Key Features

### Multi-Agent Orchestration
- **LangGraph-based workflow**: Stateful agent coordination with memory
- **Parallel execution**: Concurrent agent processing with shared context
- **Dynamic routing**: Intelligent task distribution based on agent capabilities

### Agent Specializations (2 Implemented + 4 for Team)
✅ **Sr. Pentester** (Implemented)
- Deep vulnerability exploitation
- PoC generation
- SQLi, XSS, JWT bypass, SSRF, RCE
- Skills: sqli_detection, xss_exploitation, jwt_bypass, poc_generation

✅ **GRC Agent** (Implemented)
- Compliance framework assessment (PCI-DSS, ISO 27001, OWASP, GDPR)
- Risk scoring and gap analysis
- Skills: owasp_check, iso27001, risk_scoring

🔲 **Jr. Pentester** (For Team Member #1)
- OSINT collection, port scanning, directory enumeration
- Skills: port_scanning, dir_enumeration, osint, subdomain_enum

🔲 **Web App Tester** (For Team Member #2)
- XSS, CSRF, IDOR, API security testing
- Skills: xss_stored, xss_reflected, csrf, idor

🔲 **Security Architect** (For Team Member #3)
- STRIDE threat modeling, architecture review
- Skills: stride_model, attack_surface, data_flow

🔲 **Reviewer** (For Team Member #4)
- Cross-validation, false positive filtering, quality control
- Skills: false_pos_filter, cross_validation, cvss_scoring

### Memory & Learning
- **Vector Memory (pgvector)**: Semantic search over past findings
- **Graph Memory (Neo4j)**: Relationship tracking between vulnerabilities/assets
- **Short-term Context (Redis)**: Agent conversation history

### Security & Compliance
- **Data Masking**: PII/credential detection and redaction using regex + NER
- **Encryption**: AES-256-GCM for sensitive data at rest
- **RBAC**: Role-based access control (CIS/Dev/QA/Compliance teams)
- **OWASP Top 10**: Input validation, CSRF tokens, secure headers

### Monitoring & Cost Control
- Real-time token usage tracking
- Cost attribution per agent
- Rate limiting and budget enforcement
- Execution metrics (latency, success rate, quality scores)

## 📂 Project Structure

```
Hy-AGI-base-MVP/
├── backend/
│   ├── src/
│   │   ├── agents/              # Agent implementations
│   │   │   ├── base/           # Base agent class
│   │   │   ├── sr-pentester/   # Sr. Pentester agent (IMPLEMENTED)
│   │   │   ├── grc-agent/      # GRC compliance agent (IMPLEMENTED)
│   │   │   ├── jr-pentester/   # ASSIGN TO: Team Member #1
│   │   │   ├── web-tester/     # ASSIGN TO: Team Member #2
│   │   │   ├── architect/      # ASSIGN TO: Team Member #3
│   │   │   └── reviewer/       # ASSIGN TO: Team Member #4
│   │   ├── orchestrator/       # LangGraph orchestration
│   │   ├── memory/             # Memory systems (vector, graph, cache)
│   │   ├── security/           # Security utilities (masking, encryption)
│   │   ├── monitoring/         # Metrics and cost tracking
│   │   ├── api/                # REST API routes
│   │   └── websocket/          # Real-time updates
│   ├── tests/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html              # Original frontend (provided)
├── docs/
│   ├── ARCHITECTURE.md         # Detailed architecture
│   ├── AGENT_GUIDE.md          # How to implement new agents
│   └── API.md                  # API documentation
├── docker-compose.yml          # Local development setup
├── .env.example
└── README.md                   # This file
```

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Express.js
- **Agent Framework**: LangGraph (for stateful orchestration)
- **LLM**: Anthropic Claude (Opus 4.6, Sonnet 4.6, Haiku 4.5)
- **WebSocket**: Socket.io for real-time updates

### Data Storage
- **PostgreSQL 16+**: Relational data + pgvector extension for embeddings
- **Redis 7+**: Pub/sub messaging + caching + session storage
- **Neo4j 5+**: Knowledge graph for relationship tracking

### Security & Monitoring
- **Encryption**: Node crypto module (AES-256-GCM)
- **Authentication**: JWT tokens
- **Monitoring**: Prometheus-compatible metrics endpoint
- **Logging**: Winston with structured JSON logs

## 🚀 Quick Start

### Prerequisites
```bash
node --version  # v20.x or higher
docker --version  # For local development
```

### Installation
```bash
# Clone the repository
git clone <your-repo-url>
cd Hy-AGI-base-MVP

# Install backend dependencies
cd backend
npm install

# Copy environment template
cp .env.example .env

# Edit .env and add your Anthropic API key:
# Get your key from: https://console.anthropic.com/settings/keys
# ANTHROPIC_API_KEY=your_actual_key_here

# Start infrastructure (PostgreSQL, Redis, Neo4j)
docker-compose up -d

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

The API will be available at `http://localhost:3000`

### Running the Frontend
```bash
# Open frontend/index.html in a browser
# OR serve with a local server:
cd frontend
python -m http.server 8080
# Visit http://localhost:8080
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific agent tests
npm test -- --grep "Sr.Pentester"
```

## 📖 Documentation

### For Team Members Implementing Agents

**READ THIS FIRST**: `docs/AGENT_GUIDE.md`

This guide contains:
- Base agent class structure
- How to implement skills
- Memory integration patterns
- Communication protocol
- Testing requirements

### API Documentation
See `docs/API.md` for complete REST API and WebSocket event documentation.

### Architecture Deep Dive
See `docs/ARCHITECTURE.md` for system design decisions and data flow diagrams.

## 🔒 Security Features

### 1. Data Masking (2 Implementations)
- **Regex-based PII detection**: Credit cards, SSNs, API keys, emails
- **NER-based entity recognition**: Person names, organizations, locations
- Automatic redaction in logs and agent responses

### 2. Encryption
- AES-256-GCM for sensitive data at rest
- TLS 1.3 for data in transit
- Secure key management with rotation

### 3. OWASP Compliance
- Input validation on all endpoints
- Prepared statements for SQL queries
- CSRF token validation
- Secure headers (CSP, HSTS, X-Frame-Options)
- Rate limiting per IP/user

## 📊 Monitoring & Metrics

Access real-time metrics at `/api/metrics`:

```json
{
  "agents": {
    "active": 3,
    "completed": 127,
    "failed": 2
  },
  "cost": {
    "total": 1.87,
    "by_agent": {
      "sr-pentester": 0.62,
      "grc-agent": 0.35
    }
  },
  "tokens": {
    "input": 45231,
    "output": 18392
  }
}
```

## 🌐 Deployment

### Free Hosting Options

**Backend**: Render.com (Free tier)
```bash
# Deploy to Render
npm run deploy:render
```

**Frontend**: Vercel (Free tier)
```bash
# Deploy to Vercel
cd frontend
vercel --prod
```

**Database**: 
- PostgreSQL: Render.com PostgreSQL (Free 1GB)
- Redis: Upstash (Free 10K requests/day)
- Neo4j: Neo4j Aura Free (50MB)

See `docs/DEPLOYMENT.md` for detailed instructions.

## 👥 Team Workflow

### For Team Members

1. **Read the Agent Guide**: `docs/AGENT_GUIDE.md`
2. **Choose your agent**: Check assignment in project structure above
3. **Clone the repo**: `git clone <repo-url>`
4. **Create your branch**: `git checkout -b feature/agent-<name>`
5. **Implement your agent**: Follow the base agent interface
6. **Test locally**: `npm test -- --grep "YourAgent"`
7. **Submit PR**: Include tests and documentation

### Code Review Checklist
- [ ] Agent follows base class interface
- [ ] All skills have implementations
- [ ] Unit tests with >80% coverage
- [ ] Memory integration works correctly
- [ ] Error handling for API failures
- [ ] Cost tracking instrumented
- [ ] No hardcoded secrets
- [ ] Security best practices followed

## 📝 Environment Variables

```bash
# Anthropic API
ANTHROPIC_API_KEY=your_key_here

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/hyagi
REDIS_URL=redis://localhost:6379
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# Server
PORT=3000
NODE_ENV=development

# Security
JWT_SECRET=generate_with_openssl_rand_hex_32
ENCRYPTION_KEY=generate_with_openssl_rand_hex_32
```

## 🐛 Troubleshooting

### Agent Not Responding
- Check Redis connection: `redis-cli ping`
- Verify Anthropic API key is valid
- Check agent logs: `tail -f logs/agents.log`

### Memory Issues
- pgvector: Ensure extension is installed: `CREATE EXTENSION vector;`
- Neo4j: Check heap size configuration
- Redis: Monitor memory usage: `redis-cli info memory`

### Cost Overruns
- Check budget limits in agent config
- Review retry policies
- Monitor token usage per agent

## 📜 License

MIT License - See LICENSE file for details

## 🤝 Contributing

This is a Hackathon project with team member assignments. External contributions welcome after initial implementation.

## 📞 Support

For issues or questions:
1. Check `docs/` folder
2. Review GitHub Issues
3. Contact team lead

---

**Built with ❤️ by BIT-CIS Team for the Hy-AGI Hackathon 2026**
