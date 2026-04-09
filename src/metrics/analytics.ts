import {
  DiagnosticsConfig,
  DiagnosticsSummary,
  EndpointResult,
  RequestResult,
  ResponseTimePercentiles,
  TransactionGroupConfig,
  TransactionGroupResult
} from '../types';

export function applyCoordinatedOmissionCorrection(
  values: number[],
  expectedIntervalMs: number
): { values: number[]; addedSamples: number } {
  if (!values.length || expectedIntervalMs <= 0) {
    return { values: [...values], addedSamples: 0 };
  }

  const corrected: number[] = [];
  let addedSamples = 0;

  for (const value of values) {
    corrected.push(value);

    let syntheticValue = value - expectedIntervalMs;
    while (syntheticValue >= expectedIntervalMs) {
      corrected.push(syntheticValue);
      addedSamples++;
      syntheticValue -= expectedIntervalMs;
    }
  }

  return { values: corrected, addedSamples };
}

export function calculatePercentiles(values: number[]): ResponseTimePercentiles {
  if (!values.length) {
    return { p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const safeIndex = Math.min(sorted.length - 1, Math.max(0, index));
    return sorted[safeIndex];
  };

  return {
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99)
  };
}

export function buildDiagnosticsSummary(
  results: EndpointResult[],
  config: DiagnosticsConfig,
  defaultMaskKeys: string[]
): DiagnosticsSummary {
  const sampleSize = config.sampleSize ?? 10;
  const includeHeaders = config.includeHeaders !== false;
  const maxBodyLength = config.maxBodyLength ?? 2000;
  const maskKeys = new Set((config.maskKeys || defaultMaskKeys).map(key => key.toLowerCase()));

  const failedRecords: Array<{ endpoint: EndpointResult; request: RequestResult }> = [];
  for (const endpoint of results) {
    for (const request of endpoint.requestResults) {
      if (!request.success) {
        failedRecords.push({ endpoint, request });
      }
    }
  }

  const samples = selectDiagnosticSamples(failedRecords, sampleSize).map(({ endpoint, request }) => {
    const sample: any = {
      endpoint: endpoint.name,
      method: request.requestMethod || endpoint.method,
      url: request.requestUrl || endpoint.url,
      statusCode: request.statusCode,
      error: request.error,
      requestBody: maskAndTruncateDiagnosticValue(request.requestBody, maskKeys, maxBodyLength),
      responseBody: maskAndTruncateDiagnosticValue(request.data, maskKeys, maxBodyLength)
    };

    if (includeHeaders) {
      sample.requestHeaders = maskAndTruncateDiagnosticValue(request.requestHeaders, maskKeys, maxBodyLength);
      sample.responseHeaders = maskAndTruncateDiagnosticValue(request.headers, maskKeys, maxBodyLength);
    }

    return sample;
  });

  return {
    totalFailures: failedRecords.length,
    sampledFailures: samples.length,
    samples
  };
}

export function buildTransactionGroupResults(
  groups: TransactionGroupConfig[],
  endpointResults: EndpointResult[],
  totalDurationMs: number,
  coSettings: { enabled: boolean; expectedIntervalMs?: number }
): TransactionGroupResult[] {
  const byName = new Map(endpointResults.map(result => [result.name, result]));
  const groupResults: TransactionGroupResult[] = [];

  for (const group of groups) {
    const responseTimes: number[] = [];
    let totalRequests = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let weightedResponseTimeSum = 0;
    let weightedResponseTimeCount = 0;

    for (const endpointName of group.endpoints) {
      const endpoint = byName.get(endpointName);
      if (!endpoint) {
        continue;
      }

      totalRequests += endpoint.totalRequests;
      totalSuccessful += endpoint.successfulRequests;
      totalFailed += endpoint.failedRequests;

      const successfulTimes = endpoint.requestResults
        .filter(request => request.success)
        .map(request => request.responseTime);

      if (successfulTimes.length > 0) {
        responseTimes.push(...successfulTimes);
      } else if (endpoint.successfulRequests > 0) {
        weightedResponseTimeSum += endpoint.averageResponseTime * endpoint.successfulRequests;
        weightedResponseTimeCount += endpoint.successfulRequests;
      }
    }

    let percentileInput = responseTimes;
    if (coSettings.enabled && coSettings.expectedIntervalMs !== undefined) {
      percentileInput = applyCoordinatedOmissionCorrection(responseTimes, coSettings.expectedIntervalMs).values;
    }

    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
      : (weightedResponseTimeCount > 0 ? weightedResponseTimeSum / weightedResponseTimeCount : 0);

    const successRate = totalRequests > 0 ? totalSuccessful / totalRequests : 0;
    const requestsPerSecond = totalDurationMs > 0 ? totalRequests / (totalDurationMs / 1000) : 0;

    groupResults.push({
      name: group.name,
      endpoints: [...group.endpoints],
      totalRequests,
      successfulRequests: totalSuccessful,
      failedRequests: totalFailed,
      successRate,
      averageResponseTime,
      responseTimePercentiles: calculatePercentiles(percentileInput),
      requestsPerSecond
    });
  }

  return groupResults;
}

function selectDiagnosticSamples<T>(values: T[], sampleSize: number): T[] {
  if (values.length <= sampleSize) {
    return values;
  }

  const reservoir: T[] = values.slice(0, sampleSize);
  for (let i = sampleSize; i < values.length; i++) {
    const j = Math.floor(Math.random() * (i + 1));
    if (j < sampleSize) {
      reservoir[j] = values[i];
    }
  }
  return reservoir;
}

function maskAndTruncateDiagnosticValue(value: any, maskKeys: Set<string>, maxBodyLength: number): any {
  const masked = maskSensitiveValue(value, maskKeys);
  return truncateDiagnosticValue(masked, maxBodyLength);
}

function maskSensitiveValue(value: any, maskKeys: Set<string>): any {
  if (Array.isArray(value)) {
    return value.map(item => maskSensitiveValue(item, maskKeys));
  }

  if (value && typeof value === 'object') {
    const cloned: Record<string, any> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (maskKeys.has(key.toLowerCase())) {
        cloned[key] = '********';
      } else {
        cloned[key] = maskSensitiveValue(entry, maskKeys);
      }
    }
    return cloned;
  }

  return value;
}

function truncateDiagnosticValue(value: any, maxBodyLength: number): any {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > maxBodyLength
      ? `${value.slice(0, maxBodyLength)}... [truncated ${value.length - maxBodyLength} chars]`
      : value;
  }

  try {
    const json = JSON.stringify(value);
    if (json.length <= maxBodyLength) {
      return value;
    }
    return `${json.slice(0, maxBodyLength)}... [truncated ${json.length - maxBodyLength} chars]`;
  } catch {
    return value;
  }
}
