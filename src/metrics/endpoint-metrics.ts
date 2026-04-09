import { EndpointConfig, EndpointPhaseResult, EndpointResult, RequestResult } from '../types';

export interface BuildEndpointResultInput {
  endpoint: EndpointConfig;
  summaryOnly: boolean;
  results: RequestResult[];
  successfulRequests: number;
  failedRequests: number;
  totalResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  totalRequestSizeKB: number;
  totalResponseSizeKB: number;
  errors: string[];
  phaseResults: EndpointPhaseResult[];
  totalElapsedTime: number;
  globalConfig: any;
  globalArrivalRate?: number;
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
}

export function buildEndpointResult(input: BuildEndpointResultInput): EndpointResult {
  const {
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
  } = input;

  let totalRequestsCount = 0;
  let finalSuccessfulRequests = 0;
  let finalFailedRequests = 0;
  let finalTotalResponseTime = 0;
  let finalMinResponseTime = 0;
  let finalMaxResponseTime = 0;
  let finalTotalRequestSizeKB = 0;
  let finalTotalResponseSizeKB = 0;

  if (summaryOnly) {
    totalRequestsCount = successfulRequests + failedRequests;
    finalSuccessfulRequests = successfulRequests;
    finalFailedRequests = failedRequests;
    finalTotalResponseTime = totalResponseTime;
    finalMinResponseTime = minResponseTime === Infinity ? 0 : minResponseTime;
    finalMaxResponseTime = maxResponseTime;
    finalTotalRequestSizeKB = totalRequestSizeKB;
    finalTotalResponseSizeKB = totalResponseSizeKB;
  } else {
    const successfulResults = results.filter(r => r.success);
    const responseTimes = results.map(r => r.responseTime).filter(rt => rt > 0);

    totalRequestsCount = results.length;
    finalSuccessfulRequests = successfulResults.length;
    finalFailedRequests = totalRequestsCount - finalSuccessfulRequests;
    finalTotalResponseTime = responseTimes.reduce((sum, rt) => sum + rt, 0);
    finalMinResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    finalMaxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    finalTotalRequestSizeKB = results.reduce((sum, r) => sum + (r.requestSizeKB || 0), 0);
    finalTotalResponseSizeKB = results.reduce((sum, r) => sum + (r.responseSizeKB || 0), 0);
  }

  const successRate = totalRequestsCount > 0 ? finalSuccessfulRequests / totalRequestsCount : 0;
  const averageResponseTime = finalSuccessfulRequests > 0 ? finalTotalResponseTime / finalSuccessfulRequests : 0;
  const successfulResponseTimes = summaryOnly
    ? []
    : results.filter(r => r.success).map(r => r.responseTime);

  const endpointCoSettings = resolveCoordinatedOmissionSettings(globalConfig, globalArrivalRate);
  let percentileInput = successfulResponseTimes;

  if (endpointCoSettings.enabled && endpointCoSettings.expectedIntervalMs !== undefined) {
    percentileInput = applyCoordinatedOmissionCorrection(successfulResponseTimes, endpointCoSettings.expectedIntervalMs).values;
  }

  const requestsPerSecond = totalElapsedTime > 0 ? (totalRequestsCount / (totalElapsedTime / 1000)) : 0;

  return {
    name: endpoint.name,
    url: endpoint.url,
    method: endpoint.method,
    totalRequests: totalRequestsCount,
    successfulRequests: finalSuccessfulRequests,
    failedRequests: finalFailedRequests,
    successRate,
    averageResponseTime,
    minResponseTime: finalMinResponseTime,
    maxResponseTime: finalMaxResponseTime,
    requestsPerSecond,
    errors: [...new Set(errors)],
    requestResults: results,
    totalRequestSizeKB: finalTotalRequestSizeKB,
    averageRequestSizeKB: totalRequestsCount > 0 ? finalTotalRequestSizeKB / totalRequestsCount : 0,
    totalResponseSizeKB: finalTotalResponseSizeKB,
    averageResponseSizeKB: totalRequestsCount > 0 ? finalTotalResponseSizeKB / totalRequestsCount : 0,
    responseTimePercentiles: calculatePercentiles(percentileInput),
    phaseResults: phaseResults.length > 0 ? phaseResults : undefined
  };
}
