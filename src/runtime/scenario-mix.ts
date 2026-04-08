import {
  EndpointConfig,
  EndpointResult,
  RequestResult,
  VirtualUserConfig,
  AuthDependencyConfig
} from '../types';
import { VirtualUserSession } from './virtual-user';

interface ScenarioMixWorkerContext {
  now: () => number;
  resolveVirtualUserConfig: (config?: VirtualUserConfig) => Required<VirtualUserConfig>;
  createVirtualUserSession: (id: string) => VirtualUserSession;
  selectWeightedScenario: (scenarios: Array<{ name: string; weight?: number; flow: string[] }>) => {
    name: string;
    weight?: number;
    flow: string[];
  };
  handleAuthDependency: (auth: AuthDependencyConfig, globalConfig: any) => Promise<void>;
  authVariablesMap: Map<string, Map<string, any>>;
  sharedVariables: Map<string, any>;
  applyNextDataFeederRow: (variableScope?: Map<string, any>) => void;
  makeRequest: (
    endpoint: EndpointConfig,
    timeout: number,
    baseUrl?: string,
    session?: VirtualUserSession,
    virtualUsersConfig?: VirtualUserConfig,
    diagnosticsConfig?: any
  ) => Promise<RequestResult>;
  extractVariables: (
    extractions: any[],
    responseData: any,
    headers: any,
    variableScope?: Map<string, any>
  ) => Record<string, any>;
  resolveCoordinatedOmissionSettings: (
    globalConfig: any,
    arrivalRate?: number
  ) => { enabled: boolean; expectedIntervalMs?: number };
  applyCoordinatedOmissionCorrection: (
    values: number[],
    expectedIntervalMs: number
  ) => { values: number[]; addedSamples: number };
  calculatePercentiles: (values: number[]) => {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  onProgress?: (endpointName: string, completed: number, total: number, scenarioName: string) => void;
}

export async function runScenarioMix(
  endpoints: EndpointConfig[],
  globalConfig: any,
  context: ScenarioMixWorkerContext
): Promise<EndpointResult[]> {
  const scenarioMix = globalConfig?.scenarioMix;
  if (!scenarioMix?.enabled) {
    return [];
  }

  const endpointMap = new Map(endpoints.map(endpoint => [endpoint.name, endpoint]));
  const duration = globalConfig?.duration;
  const hasTimedMode = duration && duration > 0;
  const maxRequests = globalConfig?.maxRequests ?? (hasTimedMode ? Number.MAX_SAFE_INTEGER : 10);
  const concurrent = Math.max(1, globalConfig?.concurrent || 1);
  const timeout = globalConfig?.timeout || 15000;
  const baseUrl = globalConfig?.baseUrl;
  const virtualUsersConfig = context.resolveVirtualUserConfig(globalConfig?.virtualUsers);

  const startTime = context.now();
  let totalRequestsIssued = 0;

  const accumulators = new Map<string, {
    endpoint: EndpointConfig;
    requestResults: RequestResult[];
    responseTimes: number[];
    successfulRequests: number;
    failedRequests: number;
    totalResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
    totalRequestSizeKB: number;
    totalResponseSizeKB: number;
    errors: Set<string>;
  }>();

  for (const endpoint of endpoints) {
    accumulators.set(endpoint.name, {
      endpoint,
      requestResults: [],
      responseTimes: [],
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      totalRequestSizeKB: 0,
      totalResponseSizeKB: 0,
      errors: new Set<string>()
    });
  }

  const shouldContinue = () => {
    if (hasTimedMode) {
      return (context.now() - startTime) < duration;
    }
    return totalRequestsIssued < maxRequests;
  };

  const executeScenarioWorker = async (workerId: number) => {
    const session = virtualUsersConfig.sessionScope ? context.createVirtualUserSession(`mix-${workerId}`) : undefined;
    while (shouldContinue()) {
      const scenario = context.selectWeightedScenario(scenarioMix.scenarios);
      for (const endpointName of scenario.flow) {
        if (!shouldContinue()) {
          return;
        }

        const endpoint = endpointMap.get(endpointName);
        if (!endpoint) {
          continue;
        }

        totalRequestsIssued++;

        if (endpoint.auth) {
          const authName = endpoint.auth.name;
          if (!context.authVariablesMap.has(authName)) {
            await context.handleAuthDependency(endpoint.auth, globalConfig);
          }

          const authVars = context.authVariablesMap.get(authName);
          if (authVars) {
            if (session) {
              authVars.forEach((val, key) => session.variables.set(key, val));
            } else {
              authVars.forEach((val, key) => context.sharedVariables.set(key, val));
            }
          }
        }

        context.applyNextDataFeederRow(session?.variables);
        const result = await context.makeRequest(endpoint, timeout, baseUrl, session, virtualUsersConfig, globalConfig?.diagnostics);

        if (result.success && endpoint.variables?.length) {
          context.extractVariables(endpoint.variables, result.data, result.headers, session?.variables);
        }

        const acc = accumulators.get(endpoint.name)!;
        acc.requestResults.push(result);

        if (result.success) {
          acc.successfulRequests++;
          acc.responseTimes.push(result.responseTime);
          acc.totalResponseTime += result.responseTime;
          acc.minResponseTime = Math.min(acc.minResponseTime, result.responseTime);
          acc.maxResponseTime = Math.max(acc.maxResponseTime, result.responseTime);
          acc.totalRequestSizeKB += result.requestSizeKB || 0;
          acc.totalResponseSizeKB += result.responseSizeKB || 0;
        } else {
          acc.failedRequests++;
          if (result.error) {
            acc.errors.add(result.error);
          }
        }

        if (context.onProgress) {
          const endpointTotal = acc.successfulRequests + acc.failedRequests;
          const totalForProgress = maxRequests === Number.MAX_SAFE_INTEGER ? Math.max(endpointTotal, 1) : maxRequests;
          context.onProgress(endpoint.name, endpointTotal, totalForProgress, scenario.name);
        }
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrent; i++) {
    workers.push(executeScenarioWorker(i));
  }

  await Promise.all(workers);

  const coSettings = context.resolveCoordinatedOmissionSettings(globalConfig, globalConfig?.arrivalRate);
  const endpointResults: EndpointResult[] = [];

  for (const [_, acc] of accumulators) {
    const totalRequests = acc.successfulRequests + acc.failedRequests;
    const successRate = totalRequests > 0 ? acc.successfulRequests / totalRequests : 0;
    const averageResponseTime = acc.successfulRequests > 0 ? acc.totalResponseTime / acc.successfulRequests : 0;
    const elapsedMs = context.now() - startTime;
    const requestsPerSecond = elapsedMs > 0 ? totalRequests / (elapsedMs / 1000) : 0;

    let percentileInput = acc.responseTimes;
    if (coSettings.enabled && coSettings.expectedIntervalMs !== undefined) {
      percentileInput = context.applyCoordinatedOmissionCorrection(percentileInput, coSettings.expectedIntervalMs).values;
    }

    endpointResults.push({
      name: acc.endpoint.name,
      url: acc.endpoint.url,
      method: acc.endpoint.method,
      totalRequests,
      successfulRequests: acc.successfulRequests,
      failedRequests: acc.failedRequests,
      successRate,
      averageResponseTime,
      minResponseTime: acc.minResponseTime === Infinity ? 0 : acc.minResponseTime,
      maxResponseTime: acc.maxResponseTime,
      requestsPerSecond,
      errors: Array.from(acc.errors),
      requestResults: acc.requestResults,
      totalRequestSizeKB: acc.totalRequestSizeKB,
      averageRequestSizeKB: totalRequests > 0 ? acc.totalRequestSizeKB / totalRequests : 0,
      totalResponseSizeKB: acc.totalResponseSizeKB,
      averageResponseSizeKB: totalRequests > 0 ? acc.totalResponseSizeKB / totalRequests : 0,
      responseTimePercentiles: context.calculatePercentiles(percentileInput)
    });
  }

  return endpointResults;
}
