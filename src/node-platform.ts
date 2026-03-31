import * as fs from 'fs';
import * as path from 'path';
import * as createCsvWriter from 'csv-writer';
import { Platform, BenchmarkResult } from './types';

export class NodePlatform implements Platform {
  name = 'node';

  getObjectSizeKB(obj: any): number {
    if (!obj) return 0;
    try {
      if (typeof obj === 'string') {
        return Buffer.byteLength(obj, 'utf8') / 1024;
      }
      const jsonString = JSON.stringify(obj);
      return Buffer.byteLength(jsonString, 'utf8') / 1024;
    } catch (error) {
      return 0;
    }
  }

  async saveResults(results: BenchmarkResult, jsonPath?: string, csvPath?: string, htmlPath?: string): Promise<void> {
    if (jsonPath) {
      fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    }

    if (csvPath) {
      const csvWriter = createCsvWriter.createObjectCsvWriter({
        path: csvPath,
        header: [
          { id: 'name', title: 'Endpoint' },
          { id: 'url', title: 'URL' },
          { id: 'method', title: 'Method' },
          { id: 'totalRequests', title: 'Total' },
          { id: 'successfulRequests', title: 'Success' },
          { id: 'failedRequests', title: 'Failed' },
          { id: 'successRate', title: 'Success Rate' },
          { id: 'averageResponseTime', title: 'Avg Latency (ms)' },
          { id: 'minResponseTime', title: 'Min Latency (ms)' },
          { id: 'maxResponseTime', title: 'Max Latency (ms)' },
          { id: 'requestsPerSecond', title: 'RPS' },
          { id: 'totalRequestSizeKB', title: 'Req Size (KB)' },
          { id: 'totalResponseSizeKB', title: 'Res Size (KB)' },
        ]
      });

      const data = results.results.map(r => ({
        name: r.name,
        url: r.url,
        method: r.method,
        totalRequests: r.totalRequests,
        successfulRequests: r.successfulRequests,
        failedRequests: r.failedRequests,
        successRate: (r.successRate * 100).toFixed(2) + '%',
        averageResponseTime: r.averageResponseTime.toFixed(2),
        minResponseTime: r.minResponseTime.toFixed(2),
        maxResponseTime: r.maxResponseTime.toFixed(2),
        requestsPerSecond: r.requestsPerSecond.toFixed(2),
        totalRequestSizeKB: r.totalRequestSizeKB.toFixed(2),
        totalResponseSizeKB: r.totalResponseSizeKB.toFixed(2),
      }));

      await csvWriter.writeRecords(data);
    }

    if (htmlPath) {
      // The HTML generation logic is in Glockit class for now, 
      // but in a real refactor we might move it here or to a helper.
      // For now we'll assume the HTML content is passed or generated elsewhere.
      // Actually, Glockit.saveResults handles HTML generation.
    }
  }

  async saveHtmlReport(htmlContent: string, htmlPath: string): Promise<void> {
    fs.writeFileSync(htmlPath, htmlContent);
  }

  log(message: string): void {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  error(message: string): void {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
  }

  getEnvVar(name: string): string | undefined {
    return process.env[name];
  }

  now(): number {
    // Node.js high-res time if available, or Date.now()
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    const hrTime = process.hrtime();
    return hrTime[0] * 1000 + hrTime[1] / 1000000;
  }
}
