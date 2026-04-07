import { BenchmarkSummary, SloConfig, SloEvaluation } from '../types';

/**
 * Evaluates Service Level Objective (SLO) thresholds against a benchmark summary.
 */
export function evaluateSlo(summary: BenchmarkSummary, slo: SloConfig): SloEvaluation {
  const failures: string[] = [];

  if (slo.maxErrorRate !== undefined && summary.errorRate > slo.maxErrorRate) {
    failures.push(`errorRate ${summary.errorRate.toFixed(4)} > ${slo.maxErrorRate}`);
  }

  if (slo.maxAvgResponseTimeMs !== undefined && summary.averageResponseTime > slo.maxAvgResponseTimeMs) {
    failures.push(`avgResponseTime ${summary.averageResponseTime.toFixed(2)}ms > ${slo.maxAvgResponseTimeMs}ms`);
  }

  if (slo.p95Ms !== undefined && summary.responseTimePercentiles.p95 > slo.p95Ms) {
    failures.push(`p95 ${summary.responseTimePercentiles.p95.toFixed(2)}ms > ${slo.p95Ms}ms`);
  }

  if (slo.p99Ms !== undefined && summary.responseTimePercentiles.p99 > slo.p99Ms) {
    failures.push(`p99 ${summary.responseTimePercentiles.p99.toFixed(2)}ms > ${slo.p99Ms}ms`);
  }

  if (slo.minRequestsPerSecond !== undefined && summary.overallRequestsPerSecond < slo.minRequestsPerSecond) {
    failures.push(`requestsPerSecond ${summary.overallRequestsPerSecond.toFixed(2)} < ${slo.minRequestsPerSecond}`);
  }

  return {
    passed: failures.length === 0,
    failures
  };
}
