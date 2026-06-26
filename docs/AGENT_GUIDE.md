# Agent Implementation Guide for Team Members

## 🎯 Your Mission

You've been assigned to implement one of the following agents:
1. **Jr. Pentester** (OSINT, port scanning, directory enumeration)
2. **Web App Tester** (XSS, CSRF, IDOR, API fuzzing)
3. **Security Architect** (STRIDE modeling, architecture review)
4. **Reviewer** (Cross-validation, false positive filtering)

This guide will walk you through implementing your agent from scratch.

## 📋 Prerequisites

Before starting, ensure you have:
- [ ] Cloned the repository
- [ ] Read `README.md` and `ARCHITECTURE.md`
- [ ] Installed dependencies: `npm install`
- [ ] Started infrastructure: `docker-compose up -d`
- [ ] Your assigned agent ID from the project lead

## 🏗️ Agent Structure

Every agent extends the `BaseAgent` class and follows this pattern:

```typescript
// File: backend/src/agents/<agent-name>/index.ts

import { BaseAgent } from '../base/BaseAgent';
import { Task, Result, Skill } from '../../types';

export class YourAgentName extends BaseAgent {
  constructor(config: AgentConfig) {
    super({
      id: 'your-agent-id',  // e.g., 'jr-pentester'
      type: 'Your Agent Type',  // e.g., 'Jr. Pentester'
      role: 'Your Role Description',
      skills: [/* skill definitions */],
      config
    });
  }
  
  // Main execution method
  async execute(task: Task): Promise<Result> {
    // 1. Load memory context
    const context = await this.loadContext(task);
    
    // 2. Execute appropriate skill
    const skill = this.findSkill(task.skillRequired);
    const findings = await skill.execute(task, context);
    
    // 3. Store results in memory
    await this.storeFindings(findings);
    
    // 4. Return structured result
    return this.formatResult(findings);
  }
}
```

## 📝 Step-by-Step Implementation

### Step 1: Create Agent Directory

```bash
cd backend/src/agents
mkdir <your-agent-name>
cd <your-agent-name>
touch index.ts skills.ts prompts.ts tests.test.ts
```

### Step 2: Define Skills

Skills are the capabilities your agent has. Each skill is a function that takes a task and returns findings.

```typescript
// File: skills.ts

import { Skill, Task, Finding } from '../../types';

export const portScanningSkill: Skill = {
  name: 'port_scanning',
  description: 'Scan target for open ports and services',
  
  async execute(task: Task, context: any): Promise<Finding[]> {
    const { target } = task;
    
    // 1. Build prompt for Claude
    const prompt = this.buildPrompt(target, context);
    
    // 2. Call Claude API
    const response = await this.callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    // 3. Parse response into structured findings
    const findings = this.parseFindings(response.content);
    
    // 4. Track cost
    this.trackCost(response.usage);
    
    return findings;
  },
  
  buildPrompt(target: string, context: any): string {
    return `You are a penetration testing expert performing port scanning.

Target: ${target}
Previous Context: ${JSON.stringify(context, null, 2)}

Task: Perform a comprehensive port scan and identify:
1. Open ports and their services
2. Service versions
3. Potential vulnerabilities based on versions
4. Banner information

Return your findings in this JSON format:
{
  "ports": [
    {
      "port": 80,
      "service": "http",
      "version": "nginx/1.24.0",
      "state": "open",
      "vulnerability": "CVE-2024-XXXX if applicable"
    }
  ]
}`;
  },
  
  parseFindings(response: string): Finding[] {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid response format');
    
    const data = JSON.parse(jsonMatch[0]);
    
    return data.ports.map((port: any) => ({
      type: 'open_port',
      title: `Open Port ${port.port}/${port.service}`,
      severity: port.vulnerability ? 'high' : 'info',
      description: `Port ${port.port} is open running ${port.service} ${port.version}`,
      location: `${port.port}/tcp`,
      evidence: port,
      cvss: port.vulnerability ? 7.5 : 0,
      remediation: port.vulnerability 
        ? 'Update service to latest version' 
        : 'Verify port should be exposed'
    }));
  }
};
```

### Step 3: Implement Agent Class

```typescript
// File: index.ts

import { BaseAgent } from '../base/BaseAgent';
import { AgentConfig, Task, Result } from '../../types';
import { portScanningSkill, dirEnumerationSkill, osintSkill } from './skills';

export class JrPentester extends BaseAgent {
  constructor(config: AgentConfig) {
    super({
      id: 'jr-pentester',
      type: 'Jr. Pentester',
      role: '初级渗透',
      description: '广度扫描·OSINT·枚举',
      model: config.model || 'claude-haiku-4-5',  // Cost-effective for broad scanning
      skills: [
        portScanningSkill,
        dirEnumerationSkill,
        osintSkill,
        // ... more skills
      ],
      config
    });
  }
  
  async execute(task: Task): Promise<Result> {
    try {
      // 1. Load relevant memories
      const memories = await this.recall(
        `Previous scans of ${task.target}`,
        5  // top 5 similar memories
      );
      
      // 2. Build context
      const context = {
        target: task.target,
        previousFindings: memories.map(m => m.content),
        timestamp: Date.now()
      };
      
      // 3. Execute skill
      const skill = this.skills.find(s => s.name === task.skillRequired);
      if (!skill) {
        throw new Error(`Skill ${task.skillRequired} not found`);
      }
      
      this.log('info', `Executing skill: ${skill.name}`);
      const findings = await skill.execute(task, context);
      
      // 4. Store findings in memory for future reference
      for (const finding of findings) {
        await this.remember(
          JSON.stringify(finding),
          {
            type: 'finding',
            severity: finding.severity,
            target: task.target,
            skill: skill.name
          }
        );
      }
      
      // 5. Update knowledge graph
      await this.updateKnowledgeGraph(task.target, findings);
      
      // 6. Return structured result
      return {
        agentId: this.id,
        taskId: task.id,
        status: 'completed',
        findings,
        metrics: {
          cost: this.getCurrentCost(),
          tokens: this.getCurrentTokens(),
          duration: Date.now() - context.timestamp
        }
      };
      
    } catch (error) {
      this.log('error', `Task failed: ${error.message}`);
      throw error;
    }
  }
  
  // Update Neo4j knowledge graph with findings
  private async updateKnowledgeGraph(target: string, findings: Finding[]) {
    const neo4j = this.getNeo4jClient();
    
    for (const finding of findings) {
      await neo4j.run(`
        MERGE (t:Target {name: $target})
        CREATE (v:Vulnerability {
          title: $title,
          severity: $severity,
          cvss: $cvss
        })
        CREATE (t)-[:HAS_VULNERABILITY]->(v)
        CREATE (a:Agent {id: $agentId})-[:DISCOVERED]->(v)
      `, {
        target,
        title: finding.title,
        severity: finding.severity,
        cvss: finding.cvss,
        agentId: this.id
      });
    }
  }
}
```

### Step 4: Write Prompts

Create effective prompts for your agent's skills:

```typescript
// File: prompts.ts

export const PORT_SCAN_PROMPT = (target: string, context: any) => `
You are an expert penetration tester performing reconnaissance.

## Target Information
- Domain/IP: ${target}
- Scope: All TCP/UDP ports (1-65535)

## Your Task
Simulate a comprehensive port scan using nmap-like methodology:
1. Identify all open ports
2. Determine running services and versions
3. Flag any outdated or vulnerable services
4. Note any suspicious configurations

## Context from Previous Scans
${context.previousFindings ? context.previousFindings.join('\n') : 'None'}

## Output Format
Provide your findings as structured JSON:

\`\`\`json
{
  "scan_summary": {
    "total_ports_scanned": 65535,
    "open_ports": 5,
    "filtered_ports": 100
  },
  "open_ports": [
    {
      "port": 22,
      "protocol": "tcp",
      "service": "ssh",
      "version": "OpenSSH 8.9p1",
      "state": "open",
      "banner": "SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.1",
      "risk_level": "low",
      "notes": "Latest version, properly configured",
      "cves": []
    }
  ],
  "findings": [
    {
      "severity": "high|medium|low|info",
      "title": "Finding title",
      "description": "Detailed description",
      "recommendation": "How to fix"
    }
  ]
}
\`\`\`

## Important Notes
- Only report factual findings based on port/service information
- Do NOT invent vulnerabilities without evidence
- Prioritize by risk (open admin panels > standard services)
- Include CVSS scores for known vulnerabilities
`;
```

### Step 5: Write Tests

```typescript
// File: tests.test.ts

import { JrPentester } from './index';
import { Task } from '../../types';

describe('Jr. Pentester Agent', () => {
  let agent: JrPentester;
  
  beforeEach(() => {
    agent = new JrPentester({
      maxCost: 1.0,
      maxCalls: 100,
      timeout: 60000,
      temperature: 0.3
    });
  });
  
  describe('Port Scanning Skill', () => {
    it('should identify open ports', async () => {
      const task: Task = {
        id: 'test-1',
        type: 'port_scan',
        target: 'example.com',
        skillRequired: 'port_scanning',
        priority: 'medium'
      };
      
      const result = await agent.execute(task);
      
      expect(result.status).toBe('completed');
      expect(result.findings).toBeInstanceOf(Array);
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.metrics.cost).toBeLessThan(1.0);
    });
    
    it('should handle errors gracefully', async () => {
      const task: Task = {
        id: 'test-2',
        type: 'port_scan',
        target: 'invalid-target-that-will-fail',
        skillRequired: 'port_scanning',
        priority: 'medium'
      };
      
      await expect(agent.execute(task)).rejects.toThrow();
    });
  });
  
  describe('Memory Integration', () => {
    it('should remember findings for future context', async () => {
      await agent.remember('Port 80 open on example.com', {
        type: 'finding',
        target: 'example.com'
      });
      
      const memories = await agent.recall('example.com ports');
      expect(memories.length).toBeGreaterThan(0);
    });
  });
  
  describe('Cost Tracking', () => {
    it('should track token usage accurately', async () => {
      const initialCost = agent.getCurrentCost();
      
      // Execute a task
      await agent.execute({
        id: 'test-3',
        type: 'port_scan',
        target: 'example.com',
        skillRequired: 'port_scanning',
        priority: 'medium'
      });
      
      expect(agent.getCurrentCost()).toBeGreaterThan(initialCost);
    });
    
    it('should stop when budget is exceeded', async () => {
      const agent = new JrPentester({
        maxCost: 0.01,  // Very low budget
        maxCalls: 100,
        timeout: 60000
      });
      
      await expect(
        agent.execute({
          id: 'test-4',
          type: 'port_scan',
          target: 'example.com',
          skillRequired: 'port_scanning',
          priority: 'medium'
        })
      ).rejects.toThrow('Budget exceeded');
    });
  });
});
```

## 🔧 Base Agent Features You Get For Free

The `BaseAgent` class provides these methods:

### Memory Methods
```typescript
// Store a memory
await this.remember(content: string, metadata?: object);

// Recall similar memories
const memories = await this.recall(query: string, limit?: number);

// Clear agent's memories
await this.forgetAll();
```

### Communication Methods
```typescript
// Send message to another agent
await this.sendMessage(toAgentId: string, message: AgentMessage);

// Broadcast to all agents
await this.broadcastMessage(message: AgentMessage);

// Subscribe to messages
this.onMessage((message: AgentMessage) => {
  console.log('Received:', message);
});
```

### Monitoring Methods
```typescript
// Track cost
this.trackCost(amount: number);

// Track tokens
this.trackTokens(inputTokens: number, outputTokens: number);

// Get current metrics
const cost = this.getCurrentCost();
const tokens = this.getCurrentTokens();
```

### Logging
```typescript
this.log('info', 'Starting task execution');
this.log('warn', 'High cost detected');
this.log('error', 'Task failed', error);
```

## 📊 Testing Your Agent

### Unit Tests
```bash
# Run your agent's tests
npm test -- --grep "Your Agent Name"

# Run with coverage
npm test -- --coverage --grep "Your Agent Name"
```

### Integration Tests
```bash
# Start test environment
docker-compose -f docker-compose.test.yml up -d

# Run integration tests
npm run test:integration
```

### Manual Testing
```bash
# Start dev server
npm run dev

# Test via API
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "your-agent-id",
    "target": "example.com",
    "skill": "your-skill-name"
  }'
```

## 🔒 Security Checklist

Before submitting your PR, ensure:

- [ ] No API keys hardcoded in code
- [ ] All user inputs validated
- [ ] PII is masked before logging
- [ ] Errors don't leak sensitive info
- [ ] SQL queries use prepared statements
- [ ] File paths are sanitized
- [ ] Rate limiting implemented for external APIs
- [ ] OWASP Top 10 guidelines followed

## 🎨 Code Style

Follow these conventions:

```typescript
// Use descriptive names
const findings = await this.executeScan();  // Good
const x = await this.doStuff();  // Bad

// Handle errors explicitly
try {
  await riskyOperation();
} catch (error) {
  this.log('error', 'Operation failed', error);
  throw new AgentError('Failed to execute', { cause: error });
}

// Add JSDoc comments for public methods
/**
 * Executes a port scan on the target
 * @param target - Domain or IP address
 * @param options - Scan configuration
 * @returns Array of findings
 */
async scanPorts(target: string, options?: ScanOptions): Promise<Finding[]>

// Use TypeScript types strictly
interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  // ... more fields
}
```

## 📦 Submission Checklist

Before creating your PR:

- [ ] Agent implements all assigned skills
- [ ] Tests pass with >80% coverage
- [ ] Manual testing completed
- [ ] Documentation updated (if needed)
- [ ] Security checklist completed
- [ ] Code follows style guide
- [ ] No linter errors
- [ ] Commit messages are descriptive

## 🚀 PR Template

When submitting your PR, use this template:

```markdown
## Agent Implementation: [Agent Name]

### Summary
Brief description of the agent and its capabilities.

### Skills Implemented
- [x] Skill 1: Description
- [x] Skill 2: Description
- [x] Skill 3: Description

### Testing
- Unit tests: X passing
- Integration tests: Y passing
- Manual testing: Completed

### Security Review
- [ ] No hardcoded secrets
- [ ] Input validation
- [ ] Error handling
- [ ] OWASP compliance

### Screenshots/Demos
[Optional: Add screenshots or demo output]

### Notes
Any special considerations or known limitations.
```

## 🤝 Getting Help

If you're stuck:

1. Check `ARCHITECTURE.md` for system design
2. Look at implemented agents (Sr. Pentester, GRC Agent) as examples
3. Review base class documentation
4. Ask in team chat
5. Create a draft PR for early feedback

## 📚 Useful Resources

- [LangChain Documentation](https://js.langchain.com/docs/)
- [Anthropic Claude API](https://docs.anthropic.com/claude/reference/)
- [pgvector Guide](https://github.com/pgvector/pgvector)
- [Neo4j Cypher Manual](https://neo4j.com/docs/cypher-manual/)

---

**Good luck, and happy hacking! 🎯**
