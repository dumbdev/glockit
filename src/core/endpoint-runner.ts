import {
  EndpointConfig,
  EndpointResult,
  RequestResult,
  BenchmarkPhase,
  EndpointPhaseResult,
  VirtualUserConfig,
  DiagnosticsConfig
} from '../types';
import {
  resolveVirtualUserConfig,
  createVirtualUserSession
} from '../runtime/virtual-user';
import {
  applyLoadShape,
  getEffectiveRequestDelayMs
} from '../runtime/traffic';
import {
  applyCoordinatedOmissionCorrection,
  calculatePercentiles,
} from '../metrics/analytics';
import {
  resolveCoordinatedOmissionSettings
} from '../runtime/traffic';
import { buildEndpointResult } from '../metrics/endpoint-metrics';
import { RequestContext, makeRequest } from './request-executor';
import { extractVariables, sleep } from './variable-engine';

/**
 * Extended context for endpoint benchmarking, includes data feeder state.
 */
export interface BenchmarkContext extends RequestContext {
  dataFeedRows: Array<Record<string, any>>;
  dataFeederIndex: number;
  dataFeederStrategy: 'sequential' | 'random';
}

/**
 * Advances the data feeder to the next row and populates the variable scope.
 */
export function applyNextDataFeederRow(ctx: BenchmarkContext, variableScope?: Map<string, any>): void {
  if (!ctx.dataFeedRows.length) {
    return;
  }

  const index = ctx.dataFeederStrategy === 'random'
    ? Math.floor(Math.random() * ctx.dataFeedRows.length)
    : (ctx.dataFeederIndex++ % ctx.dataFeedRows.length);

  const row = ctx.dataFeedRows[index];
  const scopedVariables = variableScope ?? ctx.variables;
  scopedVariables.set('feederRow', row);

  for (const [key, value] of Object.entries(row)) {
    scopedVariables.set(key, value);
  }
}

/**
 * Benchmarks a single endpoint with concurrency, phases, load shapes, and virtual users.
 */
export async function benchmarkEndpoint(
  ctx: BenchmarkContext,
  endpoint: EndpointConfig,
  globalConfig: any = {}
): Promise<EndpointResult> {
  const duration = globalConfig?.duration;
  const hasTimedMode = (duration && duration > 0) || (Array.isArray(globalConfig?.phases) && globalConfig.phases.length > 0);
  const maxRequests = endpoint.maxRequests ?? globalConfig?.maxRequests ?? (hasTimedMode ? Number.MAX_SAFE_INTEGER : 10);
  const concurrent = globalConfig?.concurrent || 1;
  const executor: 'concurrency' | 'arrival-rate' = globalConfig?.executor || 'concurrency';
  const globalArrivalRate: number | undefined = globalConfig?.arrivalRate;
  const globalLoadShape = globalConfig?.loadShape;
  const timeout = globalConfig?.timeout || 15000;
  const baseUrl = globalConfig?.baseUrl;
  const virtualUsersConfig = resolveVirtualUserConfig(globalConfig?.virtualUsers);

  const requestDelay = Math.max(
    endpoint.requestDelay ?? globalConfig?.requestDelay ?? 0,
    ctx.options.delay ?? 0
  );

  if (requestDelay > 0 && ctx.progressTracker) {
    ctx.progressTracker.log(`⏳ Using request delay: ${requestDelay}ms`);
  }

  const effectiveConcurrent = Math.min(concurrent, maxRequests);
  const phases: BenchmarkPhase[] = Array.isArray(globalConfig?.phases) ? globalConfig.phases : [];
  const phaseResults: EndpointPhaseResult[] = [];

  const startTime = ctx.platform.now();
  const results: RequestResult[] = [];
  const summaryOnly = globalConfig?.summaryOnly === true;

  let successfulRequests = 0;
  let failedRequests = 0;
  let totalResponseTime = 0;
  let minResponseTime = Infinity;
  let maxResponseTime = 0;
  let totalRequestSizeKB = 0;
  let totalResponseSizeKB = 0;

  const errors: string[] = [];
  const endpointName = endpoint.name;

  const useDuration = duration && duration > 0;
  const usePhases = phases.length > 0;
  const currentCount = () => summaryOnly ? (successfulRequests + failedRequests) : results.length;
  const shouldContinue = useDuration
    ? () => (ctx.platform.now() - startTime) < duration
    : () => currentCount() < maxRequests;

  let lastUpdateTime = ctx.platform.now();
  const updateInterval = 100;

  const updateProgress = (status: string) => {
    const now = ctx.platform.now();
    if (
      now - lastUpdateTime >= updateInterval ||
      status.includes('Completed') ||
      status.includes('Error') ||
      status.includes('Waiting')
    ) {
      if (ctx.progressTracker) {
        const current = Math.min(currentCount(), maxRequests);
        const total = maxRequests === Number.MAX_SAFE_INTEGER ? Math.max(current, 1) : maxRequests;
        ctx.progressTracker.updateEndpointProgress(
          endpointName,
          current,
          total,
          status.substring(0, 50)
        );
      } else {
        console.log(`[${endpointName}] ${status}`);
      }
      lastUpdateTime = now;
    }
  };

  updateProgress('Starting...');

  if (ctx.progressTracker) {
    await new Promise(resolve => setImmediate(resolve));
  }

  const executeRequest = async (
    workerId: number,
    shouldRun: () => boolean,
    throttleMs: number,
    resolveRequestDelayMs: () => number,
    statusPrefix?: string
  ) => {
    let lastRequestTime = 0;
    const session = virtualUsersConfig.sessionScope
      ? createVirtualUserSession(`${endpointName}-${workerId}`, ctx.variables)
      : undefined;

    while (shouldRun()) {
      try {
        const now = ctx.platform.now();
        const timeSinceLastRequest = now - lastRequestTime;
        const delay = resolveRequestDelayMs();

        if (delay > 0 && timeSinceLastRequest < delay) {
          await sleep(delay - timeSinceLastRequest);
        }

        lastRequestTime = ctx.platform.now();
        applyNextDataFeederRow(ctx, session?.variables);

        const result = await makeRequest(ctx, endpoint, timeout, baseUrl, session, virtualUsersConfig, globalConfig?.diagnostics);

        if (result.success && endpoint.variables?.length) {
          extractVariables(endpoint.variables, result.data, result.headers, session?.variables ?? ctx.variables);
        }

        if (summaryOnly) {
          if (result.success) {
            successfulRequests++;
            totalResponseTime += result.responseTime;
            minResponseTime = Math.min(minResponseTime, result.responseTime);
            maxResponseTime = Math.max(maxResponseTime, result.responseTime);
            totalRequestSizeKB += result.requestSizeKB || 0;
            totalResponseSizeKB += result.responseSizeKB || 0;
          } else {
            failedRequests++;
            if (result.error && !errors.includes(result.error)) {
              errors.push(result.error);
            }
          }
        } else {
          results.push(result);
        }

        const timedMode = useDuration || usePhases;
        const progressLabel = timedMode ? `${currentCount()}` : `${currentCount()}/${maxRequests}`;
        updateProgress(`${statusPrefix ? `${statusPrefix} ` : ''}Running: ${progressLabel}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (summaryOnly) {
          failedRequests++;
          if (!errors.includes(errorMsg)) {
            errors.push(errorMsg);
          }
        } else {
          errors.push(errorMsg);
          results.push({ success: false, responseTime: 0, error: errorMsg });
        }
        updateProgress(`Error: ${errorMsg.substring(0, 30)}...`);
      }

      if (throttleMs > 0) {
        await sleep(throttleMs);
      }
    }
  };

  if (usePhases) {
    for (const phase of phases) {
      if (currentCount() >= maxRequests) break;

      const phaseConcurrent = Math.min(
        phase.concurrent ?? effectiveConcurrent,
        Math.max(1, maxRequests - currentCount())
      );
      const phaseThrottle = phase.throttle ?? endpoint.throttle ?? globalConfig?.throttle ?? 0;
      const phaseConfiguredDelay = Math.max(
        phase.requestDelay ?? endpoint.requestDelay ?? globalConfig?.requestDelay ?? 0,
        ctx.options.delay ?? 0
      );
      const phaseArrivalRate = phase.arrivalRate ?? globalArrivalRate;
      const phaseLoadShape = phase.loadShape ?? globalLoadShape;
      const phaseEndTime = ctx.platform.now() + phase.duration;
      const phaseStartTime = ctx.platform.now();
      const beforeTotal = currentCount();
      const beforeSuccess = successfulRequests;
      const beforeFailed = failedRequests;

      if (ctx.progressTracker) {
        ctx.progressTracker.log(`🧭 Phase "${phase.name}" started (${phase.duration}ms, c=${phaseConcurrent})`);
      }

      const phaseShouldContinue = () => ctx.platform.now() < phaseEndTime && currentCount() < maxRequests;
      const phaseDelayResolver = () => {
        const elapsedMs = ctx.platform.now() - phaseStartTime;
        const effectiveArrivalRate = applyLoadShape(phaseArrivalRate, phaseLoadShape, elapsedMs);
        return getEffectiveRequestDelayMs(phaseConfiguredDelay, executor, effectiveArrivalRate, phaseConcurrent);
      };

      const phaseWorkers: Promise<void>[] = [];
      for (let i = 0; i < phaseConcurrent; i++) {
        phaseWorkers.push(executeRequest(i, phaseShouldContinue, phaseThrottle, phaseDelayResolver, `[${phase.name}]`));
      }
      await Promise.all(phaseWorkers);

      const phaseElapsed = ctx.platform.now() - phaseStartTime;
      phaseResults.push({
        name: phase.name,
        durationMs: phaseElapsed,
        totalRequests: currentCount() - beforeTotal,
        successfulRequests: successfulRequests - beforeSuccess,
        failedRequests: failedRequests - beforeFailed,
        requestsPerSecond: phaseElapsed > 0 ? (currentCount() - beforeTotal) / (phaseElapsed / 1000) : 0
      });
    }
  } else {
    const baseThrottle = endpoint.throttle ?? globalConfig?.throttle ?? 0;
    const baseStartTime = ctx.platform.now();
    const baseDelayResolver = () => {
      const elapsedMs = ctx.platform.now() - baseStartTime;
      const effectiveArrivalRate = applyLoadShape(globalArrivalRate, globalLoadShape, elapsedMs);
      return getEffectiveRequestDelayMs(requestDelay, executor, effectiveArrivalRate, effectiveConcurrent);
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < effectiveConcurrent; i++) {
      workers.push(executeRequest(i, shouldContinue, baseThrottle, baseDelayResolver));
    }
    await Promise.all(workers);
  }

  const endTime = ctx.platform.now();
  const totalElapsedTime = endTime - startTime;

  const endpointResult = buildEndpointResult({
    endpoint,
    summaryOnly,
    results,
    successfulRequests,
    failedRequests,
    totalResponseTime,
    minResponseTime,
    maxResponseTime,
    totalRequestSizeKB,
    totalResponseSizeKB,
    errors,
    phaseResults,
    totalElapsedTime,
    globalConfig,
    globalArrivalRate,
    resolveCoordinatedOmissionSettings,
    applyCoordinatedOmissionCorrection,
    calculatePercentiles
  });

  const totalRequestsCount = endpointResult.totalRequests;
  const finalSuccessfulRequests = endpointResult.successfulRequests;
  const finalFailedRequests = endpointResult.failedRequests;

  updateProgress(`Completed ${totalRequestsCount} requests (${finalSuccessfulRequests} successful, ${finalFailedRequests} failed)`);

  return endpointResult;
}
