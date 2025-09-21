import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as createCsvWriter from 'csv-writer';
import { ProgressTracker } from './progress';

/**
 * Calculates the approximate size of an object in KB.
 * @param obj The object to calculate size for
 * @returns Size in KB
 */
function getObjectSizeKB(obj: any): number {
  if (!obj) return 0;
  try {
    const jsonString = typeof obj === 'string' ? obj : JSON.stringify(obj);
    // Get the size in bytes and convert to KB
    return Buffer.byteLength(jsonString, 'utf8') / 1024;
  } catch (error) {
    console.warn('Error calculating object size:', error);
    return 0;
  }
}
import { 
  BenchmarkConfig, 
  BenchmarkResult, 
  EndpointConfig, 
  EndpointResult, 
  RequestResult,
  BenchmarkSummary,
  ConfigValidator 
} from './types';
import chalk from "chalk";

/**
 * Glockit is the main benchmarking engine for REST APIs.
 * It supports request chaining, concurrent execution, variable extraction, and result reporting.
 */
export class Glockit {
  private variables: Map<string, any> = new Map();
  private progressTracker?: ProgressTracker;
  private requestDelay: number;

  constructor(delay: number = 1000) {
    this.requestDelay = Math.max(0, delay);
  }


  /**
   * Runs the benchmark for the provided configuration.
   * @param config Benchmark configuration object.
   * @returns BenchmarkResult containing results and summary.
   */
  async run(config: BenchmarkConfig, enableProgress: boolean = true): Promise<BenchmarkResult> {
    // Validate configuration
    const validatedConfig = ConfigValidator.validate(config);
    const startTime = Date.now();
    const results: EndpointResult[] = [];

    // Initialize progress tracker if enabled
    if (enableProgress) {
      this.progressTracker = new ProgressTracker();
      this.progressTracker.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);
    } else {
      console.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);
    }

    // Process endpoints in dependency order
    const processedEndpoints = this.resolveDependencies(validatedConfig.endpoints);

    // Initialize progress bars for each endpoint
    if (this.progressTracker) {
      for (const endpoint of processedEndpoints) {
        const totalRequests = endpoint.maxRequests || validatedConfig.global?.maxRequests || 10;
        this.progressTracker.initializeEndpoint(endpoint, totalRequests);
      }
    }

    // Process each endpoint
    for (const endpoint of processedEndpoints) {
      const endpointName = endpoint.name;
      if (this.progressTracker) {
        this.progressTracker.log(`🎯 Testing endpoint: ${endpointName}`);
      } else {
        console.log(`🎯 Testing endpoint: ${endpointName}`);
      }
      
      try {
        const endpointResult = await this.benchmarkEndpoint(endpoint, validatedConfig.global);
        results.push(endpointResult);
        
        if (this.progressTracker) {
          this.progressTracker.completeEndpoint(endpointName);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (this.progressTracker) {
          this.progressTracker.updateRequestProgress(
            endpointName,
            1,
            1,
            `Error: ${errorMsg}`.substring(0, 50)
          );
        } else {
          console.error(chalk.red(`❌ Error in ${endpointName}: ${errorMsg}`));
        }
        throw error;
      }
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
    const concurrent = Math.min(globalConfig?.concurrent || 1, maxRequests);
    const timeout = globalConfig?.timeout || 15000;
    // Use endpoint-specific delay if set, otherwise use global delay or default to 0
    const requestDelay = Math.max(
      endpoint.requestDelay ?? globalConfig?.requestDelay ?? 0,
      this.requestDelay // Ensure class-level delay is respected
    );
    
    // Log the actual delay being used
    if (requestDelay > 0 && this.progressTracker) {
      this.progressTracker.log(`⏳ Using request delay: ${requestDelay}ms`);
    }

    // Ensure we don't have more concurrent requests than max requests
    const effectiveConcurrent = Math.min(concurrent, maxRequests);

    const startTime = Date.now();
    const results: RequestResult[] = [];
    const errors: string[] = [];
    const endpointName = endpoint.name;

    // Determine execution mode: duration-based or request-count-based
    const useDuration = duration && duration > 0;
    const shouldContinue = useDuration 
      ? () => (Date.now() - startTime) < duration 
      : () => results.length < maxRequests;

    let requestCounter = 0;
    let lastUpdateTime = Date.now();
    const updateInterval = 100; // Update progress every 100ms

    // Function to update progress
    const updateProgress = (status: string) => {
      const now = Date.now();
      if (now - lastUpdateTime >= updateInterval || 
          status.includes('Completed') || 
          status.includes('Error') || 
          status.includes('Waiting')) {
        if (this.progressTracker) {
          // Ensure we don't exceed maxRequests
          const current = Math.min(results.length, maxRequests);
          const total = useDuration ? maxRequests : maxRequests;
          
          // Update the specific endpoint progress
          this.progressTracker.updateEndpointProgress(
            endpointName,
            current,
            total,
            status.substring(0, 50) // Limit status length to prevent overflow
          );
          
          // Force update the display
        } else {
          // Fallback to console logging if progress tracker is not available
          console.log(`[${endpointName}] ${status}`);
        }
        lastUpdateTime = now;
      }
    };

    // Initial progress update
    updateProgress('Starting...');
    
    // Force initial render
    if (this.progressTracker) {
      await new Promise(resolve => setImmediate(resolve));
    }
    
    let lastRequestTime = 0;
    
    const executeRequest = async () => {
      while (shouldContinue()) {
        try {
          // Calculate time since last request
          const now = Date.now();
          const timeSinceLastRequest = now - lastRequestTime;
          
          // Apply request delay if needed
          if (this.requestDelay > 0 && timeSinceLastRequest < this.requestDelay) {
            const delayNeeded = this.requestDelay - timeSinceLastRequest;
            await this.sleep(delayNeeded);
          }
          
          // Update last request time before making the request
          lastRequestTime = Date.now();
          
          const result = await this.makeRequest(endpoint, timeout);
          
          // Extract variables if this request was successful and has variables to extract
          if (result.success && endpoint.variables?.length) {
            this.extractVariables(endpoint.variables, result.data, result.headers);
          }

          results.push(result);
          updateProgress(`Success: ${results.filter(r => r.success).length}/${results.length}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(errorMsg);
          results.push({
            success: false,
            responseTime: 0,
            error: errorMsg
          });
          updateProgress(`Error: ${errorMsg.substring(0, 30)}...`);
        }
        
        // Apply throttling between requests if configured
        if (throttle > 0) {
          await this.sleep(throttle);
        }
      }
    };

    // Create concurrent request executors
    const requestPromises = [];
    for (let i = 0; i < effectiveConcurrent; i++) {
      requestPromises.push(executeRequest());
    }
    
    // Wait for all concurrent requests to complete
    await Promise.all(requestPromises);
    
    const endTime = Date.now();
    const totalElapsedTime = endTime - startTime;
    const successfulResults = results.filter(r => r.success);
    const responseTimes = results.map(r => r.responseTime).filter(rt => rt > 0);
    
    // Calculate statistics
    const totalRequests = results.length;
    const successfulRequests = successfulResults.length;
    const failedRequests = totalRequests - successfulRequests;
    const successRate = totalRequests > 0 ? successfulRequests / totalRequests : 0;
    
    // Calculate response time statistics
    const totalResponseTime = responseTimes.reduce((sum, rt) => sum + rt, 0);
    const averageResponseTime = responseTimes.length > 0 ? totalResponseTime / responseTimes.length : 0;
    const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;
    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    
    // Calculate requests per second
    const requestsPerSecond = totalElapsedTime > 0 ? (totalRequests / (totalElapsedTime / 1000)) : 0;
    
    // Calculate percentiles
    const sortedResponseTimes = [...responseTimes].sort((a, b) => a - b);
    const calculatePercentile = (percentile: number) => {
      if (sortedResponseTimes.length === 0) return 0;
      const index = Math.floor(sortedResponseTimes.length * percentile);
      return sortedResponseTimes[Math.min(index, sortedResponseTimes.length - 1)];
    };
    
    // Create the result object
    const endpointResult: EndpointResult = {
      name: endpoint.name,
      url: endpoint.url,
      method: endpoint.method,
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate,
      averageResponseTime,
      minResponseTime,
      maxResponseTime,
      requestsPerSecond,
      errors: [...new Set(errors)], // Unique errors
      requestResults: [], // Exclude individual request results
      totalRequestSizeKB: results.reduce((sum, r) => sum + (r.requestSizeKB || 0), 0),
      averageRequestSizeKB: results.length > 0 ? 
        results.reduce((sum, r) => sum + (r.requestSizeKB || 0), 0) / results.length : 0,
      totalResponseSizeKB: results.reduce((sum, r) => sum + (r.responseSizeKB || 0), 0),
      averageResponseSizeKB: results.length > 0 ? 
        results.reduce((sum, r) => sum + (r.responseSizeKB || 0), 0) / results.length : 0
    };
    
    // Final progress update
    updateProgress(`Completed ${totalRequests} requests (${successfulRequests} successful, ${failedRequests} failed)`);
    
    return endpointResult;
  }

  /**
   * Makes a single HTTP request to the endpoint.
   * Performs variable substitution in URL, headers, and body.
   * @param endpoint Endpoint configuration.
   * @param timeout Request timeout in milliseconds.
   * @returns RequestResult with response data and timing.
   */
  private async makeRequest(endpoint: EndpointConfig, timeout: number): Promise<RequestResult> {
    const startTime = process.hrtime();
    let statusCode: number | undefined;
    let error: string | undefined;
    let data: any;
    let headers: Record<string, string> = {};
    let requestSizeKB = 0;
    let responseSizeKB = 0;
    const endpointName = endpoint.name;

    // Update progress for request start
    if (this.progressTracker) {
      this.progressTracker.updateRequestProgress(endpointName, 0, 1, 'Starting request...');
    }

    try {
      const url = this.replaceVariables(endpoint.url);
      const headers = this.replaceVariablesInObject(endpoint.headers || {});
      let body = endpoint.body;

      // Replace variables in the request body if it's an object
      if (body && typeof body === 'object') {
        body = this.replaceVariablesInObject(body);
      } else if (typeof body === 'string') {
        body = this.replaceVariables(body);
      }

      // Calculate request size in KB
      requestSizeKB = getObjectSizeKB(body) + getObjectSizeKB(headers);

      // Update progress before making the request
      if (this.progressTracker) {
        this.progressTracker.updateRequestProgress(endpointName, 0, 1, 'Sending request...');
      }

      // Make the request
      const response = await axios({
        method: endpoint.method || 'GET',
        url,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        data: body,
        timeout,
        validateStatus: () => true, // Don't throw on HTTP error status
        onUploadProgress: (progressEvent) => {
          if (this.progressTracker && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            this.progressTracker.updateRequestProgress(
              endpointName,
              progressEvent.loaded,
              progressEvent.total,
              `Uploading: ${percent}%`
            );
          }
        },
        onDownloadProgress: (progressEvent) => {
          if (this.progressTracker && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            this.progressTracker.updateRequestProgress(
              endpointName,
              progressEvent.loaded,
              progressEvent.total,
              `Downloading: ${percent}%`
            );
          }
        }
      });

      const [seconds, nanoseconds] = process.hrtime(startTime);
      const responseTime = (seconds * 1000) + (nanoseconds / 1e6);

      // Calculate response size in KB
      const responseHeadersSize = getObjectSizeKB(response.headers);
      const responseDataSize = getObjectSizeKB(response.data);
      responseSizeKB = responseHeadersSize + responseDataSize;

      statusCode = response.status;
      data = response.data;
      const responseHeaders = response.headers as Record<string, string>;

      // Update progress on successful response
      if (this.progressTracker) {
        this.progressTracker.updateRequestProgress(
          endpointName,
          1,
          1,
          `Completed (${statusCode})`
        );
      }

      return {
        success: response.status >= 200 && response.status < 300,
        responseTime,
        statusCode,
        data,
          headers: responseHeaders,
        requestSizeKB: parseFloat(requestSizeKB.toFixed(6)), // Round to 6 decimal places
        responseSizeKB: parseFloat(responseSizeKB.toFixed(6))
      };
    } catch (error) {
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const responseTime = (seconds * 1000) + (nanoseconds / 1e6);
      
      return {
        success: false,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        statusCode: (error as any)?.response?.status,
        requestSizeKB: parseFloat(requestSizeKB.toFixed(6)),
        responseSizeKB: 0
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
   * Sanitizes variable values for logging, hiding sensitive data.
   * @param value Variable value.
   * @param variableName Variable name.
   * @returns Sanitized string for logging.
   */
  /**
   * Sanitizes a value for logging, hiding sensitive data.
   * @param value The value to sanitize.
   * @param variableName The name of the variable being logged.
   * @returns A sanitized string representation of the value.
   */
  /**
   * Sleeps for the specified number of milliseconds.
   * @param ms Number of milliseconds to sleep.
   * @returns A promise that resolves after the specified delay.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sanitizes a value for logging, hiding sensitive data.
   * @param value The value to sanitize.
   * @param variableName The name of the variable being logged.
   * @returns A sanitized string representation of the value.
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
      return '********';
    }
    
    // Truncate long values
    const maxLength = 100;
    if (value.length > maxLength) {
      return `${value.substring(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
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