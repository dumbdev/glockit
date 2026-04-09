import { BenchmarkResult } from '../../types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildJunitReportTemplate(results: BenchmarkResult): string {
  const totalSuites = results.results.length;
  const totalFailures = results.results.filter(endpoint => endpoint.failedRequests > 0).length;
  const totalTimeSeconds = (results.summary.totalDuration / 1000).toFixed(3);

  const suites = results.results.map(endpoint => {
    const endpointTimeSeconds = endpoint.requestsPerSecond > 0
      ? (endpoint.totalRequests / endpoint.requestsPerSecond).toFixed(3)
      : '0.000';
    const testcaseName = `${endpoint.method} ${endpoint.url}`;
    const failureBlock = endpoint.failedRequests > 0
      ? `<failure message="${escapeXml(`${endpoint.failedRequests} request(s) failed`)}">${escapeXml(endpoint.errors.join('; ') || 'Request failures detected')}</failure>`
      : '';

    return [
      `  <testsuite name="${escapeXml(endpoint.name)}" tests="1" failures="${endpoint.failedRequests > 0 ? 1 : 0}" skipped="0" time="${endpointTimeSeconds}">`,
      `    <properties>`,
      `      <property name="totalRequests" value="${endpoint.totalRequests}" />`,
      `      <property name="successfulRequests" value="${endpoint.successfulRequests}" />`,
      `      <property name="failedRequests" value="${endpoint.failedRequests}" />`,
      `      <property name="p95Ms" value="${endpoint.responseTimePercentiles.p95.toFixed(3)}" />`,
      `      <property name="p99Ms" value="${endpoint.responseTimePercentiles.p99.toFixed(3)}" />`,
      `      <property name="requestsPerSecond" value="${endpoint.requestsPerSecond.toFixed(3)}" />`,
      `    </properties>`,
      `    <testcase classname="glockit.endpoint" name="${escapeXml(testcaseName)}" time="${endpointTimeSeconds}">`,
      failureBlock ? `      ${failureBlock}` : '',
      `    </testcase>`,
      `  </testsuite>`
    ].filter(Boolean).join('\n');
  }).join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="glockit" tests="${totalSuites}" failures="${totalFailures}" time="${totalTimeSeconds}" timestamp="${escapeXml(results.timestamp)}">`,
    suites,
    `</testsuites>`
  ].join('\n');
}
