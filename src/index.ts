import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as createCsvWriter from 'csv-writer';
import { 
  BenchmarkConfig, 
  BenchmarkResult, 
  EndpointConfig, 
  EndpointResult, 
  RequestResult,
  BenchmarkSummary,
  ConfigValidator 
} from './types';

/**
 * BarbariansBench is the main benchmarking engine for REST APIs.
 * It supports request chaining, concurrent execution, variable extraction, and result reporting.
 */
export class BarbariansBench {
  private variables: Map<string, any> = new Map();

  /**
   * Runs the benchmark for the provided configuration.
   * @param config Benchmark configuration object.
   * @returns BenchmarkResult containing results and summary.
   */
  async run(config: BenchmarkConfig): Promise<BenchmarkResult> {
    // Validate configuration
    const validatedConfig = ConfigValidator.validate(config);
    const startTime = Date.now();
    const results: EndpointResult[] = [];

    console.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);

    // Process endpoints in dependency order
    const processedEndpoints = this.resolveDependencies(validatedConfig.endpoints);

    for (const endpoint of processedEndpoints) {
      console.log(`🎯 Testing endpoint: ${endpoint.name}`);
      const endpointResult = await this.benchmarkEndpoint(endpoint, validatedConfig.global);
      results.push(endpointResult);
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    const summary: BenchmarkSummary = {
      totalDuration,
      totalRequests: results.reduce((sum, r) => sum + r.totalRequests, 0),
      totalSuccessful: results.reduce((sum, r) => sum + r.successfulRequests, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failedRequests, 0),
      overallRequestsPerSecond: 0,
      averageResponseTime: 0
    };

    if (summary.totalRequests > 0) {
      summary.overallRequestsPerSecond = summary.totalRequests / (totalDuration / 1000);
      summary.averageResponseTime = results.reduce((sum, r) => sum + (r.averageResponseTime * r.totalRequests), 0) / summary.totalRequests;
    }

    return {
      config: validatedConfig,
      results,
      summary,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Resolves endpoint dependencies to determine execution order.
   * @param endpoints Array of endpoint configurations.
   * @returns Ordered array of endpoints.
   */
  private resolveDependencies(endpoints: EndpointConfig[]): EndpointConfig[] {
    const resolved: EndpointConfig[] = [];
    const remaining = [...endpoints];

    while (remaining.length > 0) {
      const before = remaining.length;
      
      for (let i = remaining.length - 1; i >= 0; i--) {
        const endpoint = remaining[i];
        const dependencies = endpoint.dependencies || [];
        
        // Check if all dependencies are resolved
        const allDepsResolved = dependencies.every(dep => 
          resolved.some(r => r.name === dep)
        );
        
        if (allDepsResolved) {
          resolved.push(endpoint);
          remaining.splice(i, 1);
        }
      }
      
      // Prevent infinite loop if there are circular dependencies
      if (remaining.length === before) {
        console.warn(`⚠️  Possible circular dependencies detected. Processing remaining endpoints in order.`);
        resolved.push(...remaining);
        break;
      }
    }

    return resolved;
  }

  /**
   * Benchmarks a single endpoint with concurrency and throttling.
   * @param endpoint Endpoint configuration.
   * @param globalConfig Global configuration options.
   * @returns EndpointResult with statistics for the endpoint.
   */
  private async benchmarkEndpoint(endpoint: EndpointConfig, globalConfig: any = {}): Promise<EndpointResult> {
    const maxRequests = endpoint.maxRequests || globalConfig?.maxRequests || 10;
    const duration = globalConfig?.duration; // Duration in milliseconds
    const throttle = endpoint.throttle || globalConfig?.throttle || 0;
    const concurrent = globalConfig?.concurrent || 1;
    const timeout = globalConfig?.timeout || 5000;

    const startTime = Date.now();
    const results: RequestResult[] = [];
    const errors: string[] = [];

    // Determine execution mode: duration-based or request-count-based
    const useDuration = duration && duration > 0;
    const shouldContinue = useDuration 
      ? () => (Date.now() - startTime) < duration 
      : () => results.length < maxRequests;

    let requestCounter = 0;
    
    while (shouldContinue()) {
      // Create batch of concurrent requests
      const batchSize = Math.min(concurrent, useDuration ? concurrent : maxRequests - results.length);
      const promises: Promise<void>[] = [];

      for (let i = 0; i < batchSize && shouldContinue(); i++) {
        const requestPromise = (async () => {
          try {
            const result = await this.makeRequest(endpoint, timeout);
            results.push(result);

            // Extract variables from response if configured (only from first successful response)
            if (result.success && endpoint.variables && results.filter(r => r.success).length === 1) {
              this.extractVariables(endpoint.variables, result.data, result.headers);
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(errorMsg);
            results.push({
              success: false,
              responseTime: 0,
              error: errorMsg
            });
          }
        })();

        promises.push(requestPromise);
        requestCounter++;
      }

      // Wait for all requests in this batch to complete
      await Promise.all(promises);

      // Apply throttling between batches (not between individual requests in concurrent mode)
      if (throttle > 0 && shouldContinue()) {
        await this.sleep(throttle);
      }

      // Safety check to prevent infinite loops in duration mode
      if (useDuration && requestCounter > 10000) {
        console.warn(`⚠️  Endpoint ${endpoint.name}: Reached safety limit of 10,000 requests`);
        break;
      }
    }

    const endTime = Date.now();
    const totalElapsedTime = endTime - startTime;
    const successfulResults = results.filter(r => r.success);
    const responseTimes = results.map(r => r.responseTime).filter(rt => rt > 0);

    return {
      name: endpoint.name,
      url: this.replaceVariables(endpoint.url),
      totalRequests: results.length,
      successfulRequests: successfulResults.length,
      failedRequests: results.length - successfulResults.length,
      averageResponseTime: responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0,
      minResponseTime: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
      maxResponseTime: responseTimes.length > 0 ? Math.max(...responseTimes) : 0,
      requestsPerSecond: totalElapsedTime > 0 ? (results.length / (totalElapsedTime / 1000)) : 0,
      errors: Array.from(new Set(errors))
    };
  }

  /**
   * Makes a single HTTP request to the endpoint.
   * Performs variable substitution in URL, headers, and body.
   * @param endpoint Endpoint configuration.
   * @param timeout Request timeout in milliseconds.
   * @returns RequestResult with response data and timing.
   */
  private async makeRequest(endpoint: EndpointConfig, timeout: number): Promise<RequestResult> {
    const startTime = Date.now();

    try {
      const url = this.replaceVariables(endpoint.url);
      const headers = this.replaceVariablesInObject(endpoint.headers || {});
      const body = this.replaceVariablesInObject(endpoint.body);

      const response: AxiosResponse = await axios({
        method: endpoint.method,
        url,
        headers,
        data: body,
        timeout,
        validateStatus: () => true // Accept all status codes
      });

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: response.status >= 200 && response.status < 400,
        responseTime,
        statusCode: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>
      };
    } catch (error) {
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      return {
        success: false,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Extracts variables from response data or headers according to extraction rules.
   * @param extractions Array of variable extraction configs.
   * @param responseData Response data object.
   * @param headers Response headers.
   */
  private extractVariables(extractions: any[], responseData: any, headers: any) {
    for (const extraction of extractions) {
      try {
        let value;
        if (extraction.from === 'response') {
          value = this.getValueByPath(responseData, extraction.path);
        } else if (extraction.from === 'headers') {
          value = headers[extraction.path];
        }
        
        if (value !== undefined) {
          this.variables.set(extraction.name, value);
          // Security fix: Don't log potentially sensitive variable values
          const sanitizedValue = this.sanitizeForLogging(value, extraction.name);
          console.log(`📝 Extracted variable: ${extraction.name} = ${sanitizedValue}`);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to extract variable ${extraction.name}: ${error}`);
      }
    }
  }

  /**
   * Gets a value from an object using dot-separated path.
   * @param obj Source object.
   * @param path Dot-separated path string.
   * @returns Extracted value or undefined.
   */
  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Replaces variables in a string using {{variable}} syntax.
   * @param text Input string.
   * @returns String with variables replaced.
   */
  private replaceVariables(text: string): string {
    if (!text) return text;
    
    let result = text;
    for (const [key, value] of this.variables) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    return result;
  }



  /**
   * Recursively replaces variables in an object or array.
   * @param obj Input object, array, or string.
   * @returns Object/array/string with variables replaced.
   */
  private replaceVariablesInObject(obj: any): any {
    if (!obj) return obj;
    if (typeof obj === 'string') return this.replaceVariables(obj);
    if (Array.isArray(obj)) return obj.map(item => this.replaceVariablesInObject(item));
    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceVariablesInObject(value);
      }
      return result;
    }
    return obj;
  }

  /**
   * Sleeps for the specified number of milliseconds.
   * @param ms Milliseconds to sleep.
   * @returns Promise that resolves after ms.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sanitizes variable values for logging, hiding sensitive data.
   * @param value Variable value.
   * @param variableName Variable name.
   * @returns Sanitized string for logging.
   */
  private sanitizeForLogging(value: any, variableName: string): string {
    if (typeof value !== 'string') {
      return '[non-string value]';
    }
    
    // Check if this might be a sensitive variable based on name patterns
    const sensitivePatterns = [
      /token/i, /auth/i, /key/i, /secret/i, /password/i, 
      /credential/i, /bearer/i, /jwt/i, /session/i
    ];
    
    const isSensitive = sensitivePatterns.some(pattern => pattern.test(variableName));
    
    if (isSensitive) {
      // Show only first and last few characters for sensitive data
      if (value.length > 8) {
        return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
      } else {
        return '[hidden]';
      }
    }
    
    // For non-sensitive variables, show the full value but limit length
    if (value.length > 100) {
      return value.substring(0, 97) + '...';
    }
    
    return value;
  }

  /**
   * Saves benchmark results to JSON and CSV files.
   * @param results BenchmarkResult object.
   * @param jsonPath Path to save JSON file.
   * @param csvPath Path to save CSV file.
   */
  async saveResults(results: BenchmarkResult, jsonPath: string, csvPath: string): Promise<void> {
    // Save JSON results
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

    // Save CSV results
    const csvData = results.results.map(result => ({
      endpoint_name: result.name,
      url: result.url,
      total_requests: result.totalRequests,
      successful_requests: result.successfulRequests,
      failed_requests: result.failedRequests,
      average_response_time_ms: Math.round(result.averageResponseTime),
      min_response_time_ms: Math.round(result.minResponseTime),
      max_response_time_ms: Math.round(result.maxResponseTime),
      requests_per_second: Math.round(result.requestsPerSecond * 100) / 100,
      error_count: result.errors.length
    }));

    const csvWriter = createCsvWriter.createObjectCsvWriter({
      path: csvPath,
      header: [
        { id: 'endpoint_name', title: 'Endpoint Name' },
        { id: 'url', title: 'URL' },
        { id: 'total_requests', title: 'Total Requests' },
        { id: 'successful_requests', title: 'Successful Requests' },
        { id: 'failed_requests', title: 'Failed Requests' },
        { id: 'average_response_time_ms', title: 'Avg Response Time (ms)' },
        { id: 'min_response_time_ms', title: 'Min Response Time (ms)' },
        { id: 'max_response_time_ms', title: 'Max Response Time (ms)' },
        { id: 'requests_per_second', title: 'Requests/Second' },
        { id: 'error_count', title: 'Error Count' }
      ]
    });

    await csvWriter.writeRecords(csvData);
  }
}

export * from './types';