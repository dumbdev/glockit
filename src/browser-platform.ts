import { Platform, BenchmarkResult } from './types';

export class BrowserPlatform implements Platform {
  name = 'browser';

  getObjectSizeKB(obj: any): number {
    if (!obj) return 0;
    try {
      if (typeof obj === 'string') {
        return (new TextEncoder().encode(obj).length) / 1024;
      }
      const jsonString = JSON.stringify(obj);
      return (new TextEncoder().encode(jsonString).length) / 1024;
    } catch (error) {
      return 0;
    }
  }

  async saveResults(results: BenchmarkResult, jsonPath?: string, csvPath?: string, htmlPath?: string): Promise<void> {
    // In browser, "saving" might mean downloading the file or storing in IndexedDB/LocalStorage
    if (jsonPath) {
      this.downloadFile(jsonPath, JSON.stringify(results, null, 2), 'application/json');
    }

    if (csvPath) {
      const headers = [
        'Endpoint', 'URL', 'Method', 'Total', 'Success', 'Failed', 
        'Success Rate', 'Avg Latency (ms)', 'Min Latency (ms)', 
        'Max Latency (ms)', 'RPS', 'Req Size (KB)', 'Res Size (KB)'
      ];
      
      const rows = results.results.map(r => [
        r.name, r.url, r.method, r.totalRequests, r.successfulRequests, r.failedRequests,
        (r.successRate * 100).toFixed(2) + '%', r.averageResponseTime.toFixed(2),
        r.minResponseTime.toFixed(2), r.maxResponseTime.toFixed(2),
        r.requestsPerSecond.toFixed(2), r.totalRequestSizeKB.toFixed(2),
        r.totalResponseSizeKB.toFixed(2)
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n');

      this.downloadFile(csvPath, csvContent, 'text/csv');
    }

    if (htmlPath) {
      // Glockit currently generates the HTML, so we just download it
      // Note: This assumes results.htmlPath was set and content is available or passed.
      // For now, let's allow passing content if we want, or just assume it's handled.
    }
  }

  async saveHtmlReport(htmlContent: string, htmlPath: string): Promise<void> {
    this.downloadFile(htmlPath, htmlContent, 'text/html');
  }

  private downloadFile(filename: string, content: string, contentType: string): void {
    if (typeof document !== 'undefined') {
      const blob = new Blob([content], { type: contentType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      console.log(`File ${filename} (${contentType}) content:`, content);
    }
  }

  log(message: string): void {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  error(message: string): void {
    console.error(`[${new Date().toISOString()}] [ERROR] ${message}`);
  }

  getEnvVar(name: string): string | undefined {
    // Browser doesn't have process.env, maybe use a global config or just return undefined
    return undefined;
  }

  now(): number {
    return performance.now();
  }
}
