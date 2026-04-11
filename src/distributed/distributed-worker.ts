import { BenchmarkConfig, BenchmarkResult, DistributedConfig } from '../types';
import axios from 'axios';

export interface WorkerRuntimeContext {
  coordinatorUrl: string;
  workerId: string;
  pollIntervalMs: number;
  joinTimeoutMs: number;
  heartbeatIntervalMs: number;
  resultSubmitRetries: number;
  resultSubmitBackoffMs: number;
  authHeaders?: Record<string, string>;
}

export function buildWorkerRuntimeContext(distributedConfig: DistributedConfig): WorkerRuntimeContext {
  const coordinatorUrl = distributedConfig.coordinatorUrl!;
  const workerId = distributedConfig.workerId || `worker-${Math.random().toString(36).slice(2, 10)}`;
  const pollIntervalMs = distributedConfig.pollIntervalMs ?? 500;
  const joinTimeoutMs = distributedConfig.joinTimeoutMs ?? 60000;
  const heartbeatIntervalMs = distributedConfig.heartbeatIntervalMs ?? 5000;
  const resultSubmitRetries = distributedConfig.resultSubmitRetries ?? 3;
  const resultSubmitBackoffMs = distributedConfig.resultSubmitBackoffMs ?? 1000;
  const authHeaderName = distributedConfig.authHeaderName || 'x-glockit-token';
  const authHeaders = distributedConfig.authToken
    ? { [authHeaderName]: distributedConfig.authToken }
    : undefined;

  return {
    coordinatorUrl,
    workerId,
    pollIntervalMs,
    joinTimeoutMs,
    heartbeatIntervalMs,
    resultSubmitRetries,
    resultSubmitBackoffMs,
    authHeaders
  };
}

export async function joinCoordinator(
  coordinatorUrl: string,
  workerId: string,
  authHeaders?: Record<string, string>
): Promise<void> {
  await axios.post(`${coordinatorUrl}/join`, { workerId }, { timeout: 10000, headers: authHeaders });
}

export function startWorkerHeartbeatLoop(
  coordinatorUrl: string,
  workerId: string,
  authHeaders: Record<string, string> | undefined,
  intervalMs: number,
  sleep: (ms: number) => Promise<void>
): { stop: () => void } {
  let stopped = false;

  const tick = async () => {
    while (!stopped) {
      try {
        await axios.post(
          `${coordinatorUrl}/heartbeat`,
          { workerId },
          { timeout: Math.max(5000, intervalMs), headers: authHeaders }
        );
      } catch {
        // Heartbeat failures are transient; coordinator stale timeout handles prolonged issues.
      }

      await sleep(intervalMs);
    }
  };

  tick();

  return {
    stop: () => {
      stopped = true;
    }
  };
}

export async function postWorkerResultWithRetry(params: {
  coordinatorUrl: string;
  workerId: string;
  workerResult: BenchmarkResult;
  authHeaders?: Record<string, string>;
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}): Promise<void> {
  const {
    coordinatorUrl,
    workerId,
    workerResult,
    authHeaders,
    timeoutMs,
    retries,
    backoffMs,
    sleep,
    log
  } = params;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      await axios.post(
        `${coordinatorUrl}/result`,
        { workerId, result: workerResult },
        { timeout: timeoutMs, headers: authHeaders }
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }

      const delay = backoffMs * Math.pow(2, attempt);
      log(`🔁 Result submit retry ${attempt + 1}/${retries} in ${delay}ms`);
      await sleep(delay);
    }

    attempt++;
  }

  throw new Error(
    `Failed to submit worker result after ${retries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export function buildEmptyWorkerResult(workerConfig: BenchmarkConfig): BenchmarkResult {
  return {
    config: workerConfig,
    results: [],
    summary: {
      totalDuration: 0,
      totalRequests: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      overallRequestsPerSecond: 0,
      averageResponseTime: 0,
      responseTimePercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      errorRate: 0
    },
    timestamp: new Date().toISOString()
  };
}

export function buildNoAssignmentsWorkerResult(
  config: BenchmarkConfig,
  workerId: string,
  coordinatorUrl: string
): BenchmarkResult {
  return {
    config,
    results: [],
    summary: {
      totalDuration: 0,
      totalRequests: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      overallRequestsPerSecond: 0,
      averageResponseTime: 0,
      responseTimePercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      errorRate: 0
    },
    timestamp: new Date().toISOString(),
    distributed: {
      role: 'worker',
      workerId,
      coordinatorUrl,
      assignedEndpoints: []
    }
  };
}
