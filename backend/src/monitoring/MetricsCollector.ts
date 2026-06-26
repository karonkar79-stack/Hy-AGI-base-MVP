/**
 * Metrics Collector - Tracks system metrics
 * MVP: In-memory counters (production would use Prometheus)
 */

export class MetricsCollector {
  private metrics = {
    latency: new Map<string, number[]>(),
    costs: new Map<string, number>(),
    tokens: new Map<string, { input: number; output: number }>(),
    errors: new Map<string, number>()
  };

  recordLatency(operation: string, duration: number): void {
    const latencies = this.metrics.latency.get(operation) || [];
    latencies.push(duration);
    this.metrics.latency.set(operation, latencies);
  }

  recordCost(agentId: string, cost: number): void {
    const current = this.metrics.costs.get(agentId) || 0;
    this.metrics.costs.set(agentId, current + cost);
  }

  recordTokens(agentId: string, input: number, output: number): void {
    const current = this.metrics.tokens.get(agentId) || { input: 0, output: 0 };
    this.metrics.tokens.set(agentId, {
      input: current.input + input,
      output: current.output + output
    });
  }

  recordError(operation: string): void {
    const current = this.metrics.errors.get(operation) || 0;
    this.metrics.errors.set(operation, current + 1);
  }

  getMetrics() {
    return {
      latency: Object.fromEntries(this.metrics.latency),
      costs: Object.fromEntries(this.metrics.costs),
      tokens: Object.fromEntries(this.metrics.tokens),
      errors: Object.fromEntries(this.metrics.errors)
    };
  }
}
