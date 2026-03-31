import axios from 'axios';
import * as fs from 'fs';
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
    if (typeof obj === 'string') {
      return Buffer.byteLength(obj, 'utf8') / 1024;
    }
    const jsonString = JSON.stringify(obj);
    return Buffer.byteLength(jsonString, 'utf8') / 1024;
  } catch (error) {
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
  ConfigValidator,
  GlockitOptions,
  AssertionConfig,
  AuthDependencyConfig
} from './types';
const chalk = require('chalk');
import { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

export { ProgressTracker } from './progress';

/**
 * Glockit is the main benchmarking engine for REST APIs.
 * It supports request chaining, concurrent execution, variable extraction, and result reporting.
 */
export class Glockit {
  private variables: Map<string, any> = new Map();
  private progressTracker?: ProgressTracker;
  private options: GlockitOptions;
  private axiosInstance: AxiosInstance;
  private authVariablesMap: Map<string, Map<string, any>> = new Map();

  constructor(options: GlockitOptions = {}) {
    this.options = {
      delay: 0,
      progress: true,
      dryRun: false,
      ...options
    };
    this.axiosInstance = axios.create();
  }

  /**
   * Adds an Axios request interceptor.
   */
  public addRequestInterceptor(
    onFulfilled?: (value: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>,
    onRejected?: (error: any) => any
  ): number {
    return this.axiosInstance.interceptors.request.use(onFulfilled, onRejected);
  }

  /**
   * Adds an Axios response interceptor.
   */
  public addResponseInterceptor(
    onFulfilled?: (value: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>,
    onRejected?: (error: any) => any
  ): number {
    return this.axiosInstance.interceptors.response.use(onFulfilled, onRejected);
  }


  /**
   * Runs the benchmark for the provided configuration.
   * @param config Benchmark configuration object.
   * @param enableProgress Override the default progress setting.
   * @returns BenchmarkResult containing results and summary.
   */
  async run(config: BenchmarkConfig, enableProgress?: boolean): Promise<BenchmarkResult> {
    const showProgress = enableProgress !== undefined ? enableProgress : this.options.progress;
    // Validate configuration
    const validatedConfig = ConfigValidator.validate(config);
    const startTime = Date.now();
    const results: EndpointResult[] = [];

    // Initialize progress tracker if enabled
    if (showProgress) {
      this.progressTracker = new ProgressTracker();
      this.progressTracker.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);
    } else {
      console.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);
    }

    if (this.options.dryRun) {
      if (this.progressTracker) this.progressTracker.log('DRY RUN MODE: No actual requests will be made.');
      else console.log('DRY RUN MODE: No actual requests will be made.');
    }

    // Process endpoints in dependency order
    const processedEndpoints = this.resolveDependencies(validatedConfig.endpoints);

    // Initial variables from global config if any (though not explicitly in types, good for future)
    this.variables.clear();

    // Determine if we should use weights
    const totalWeight = processedEndpoints.reduce((sum, e) => sum + (e.weight || 0), 0);
    const useWeights = totalWeight > 0;

    // Initialize progress bars for each endpoint
    if (this.progressTracker) {
      for (const endpoint of processedEndpoints) {
        let totalRequests = endpoint.maxRequests || validatedConfig.global?.maxRequests || 10;
        
        if (useWeights && endpoint.weight) {
          const globalMax = validatedConfig.global?.maxRequests || 0;
          if (globalMax > 0) {
            totalRequests = Math.round((endpoint.weight / totalWeight) * globalMax);
          }
        }
        
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
        // Handle auth dependency if present
        if (endpoint.auth) {
          const authName = endpoint.auth.name;
          if (!this.authVariablesMap.has(authName)) {
            await this.handleAuthDependency(endpoint.auth, validatedConfig.global);
          }
          
          // Apply auth variables to current execution scope
          const authVars = this.authVariablesMap.get(authName);
          if (authVars) {
            authVars.forEach((val, key) => this.variables.set(key, val));
          }
        }

        let maxRequestsOverride = endpoint.maxRequests;
        if (useWeights && endpoint.weight) {
          const globalMax = validatedConfig.global?.maxRequests || 0;
          if (globalMax > 0) {
            maxRequestsOverride = Math.round((endpoint.weight / totalWeight) * globalMax);
          }
        }

        const endpointResult = await this.benchmarkEndpoint(endpoint, {
          ...validatedConfig.global,
          maxRequests: maxRequestsOverride || validatedConfig.global?.maxRequests
        });
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
   * Generates an example configuration object.
   * @returns BenchmarkConfig example.
   */
  public static generateExampleConfig(): BenchmarkConfig {
    return {
      name: "E-Commerce API Benchmark",
      global: {
        baseUrl: "https://api.example.com/v1",
        maxRequests: 100,
        concurrent: 10,
        timeout: 5000,
        requestDelay: 100,
        summaryOnly: false,
        headers: {
          "Content-Type": "application/json",
          "X-Environment": "{{$env.NODE_ENV}}"
        }
      },
      endpoints: [
        {
          name: "Get User Profile",
          url: "/user/profile/{{$uuid}}",
          method: "GET",
          weight: 8,
          auth: {
            name: "UserAuth",
            endpoints: [
              {
                name: "Login",
                url: "/auth/login",
                method: "POST",
                body: {
                  "username": "testuser",
                  "password": "testpassword"
                },
                variables: [
                  {
                    "name": "authToken",
                    "path": "token",
                    "from": "response"
                  }
                ]
              }
            ]
          },
          headers: {
            "Authorization": "Bearer {{authToken}}"
          },
          query: {
            "fields": "id,name,email",
            "timestamp": "{{$randomInt(1000000, 2000000)}}"
          },
          responseCheck: [
            {
              "path": "id",
              "operator": "exists"
            }
          ],
          assertions: [
            {
              "path": "status",
              "operator": "equals",
              "value": 200
            }
          ],
          retries: 2,
          beforeRequest: "request.headers['X-Request-ID'] = 'req-' + Math.random().toString(36).substr(2, 9);"
        },
        {
          name: "Search Items",
          url: "/items/search",
          method: "GET",
          weight: 2,
          query: {
            "q": "{{$randomFrom('phone', 'laptop', 'tablet')}}",
            "limit": 10
          },
          afterRequest: "if (response.status === 200) { console.log('Search successful'); }"
        }
      ]
    };
  }

  /**
   * Resolves endpoint dependencies to determine execution order.
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
    const baseUrl = globalConfig?.baseUrl;
    // Use endpoint-specific delay if set, otherwise use global delay or default to 0
    const requestDelay = Math.max(
      endpoint.requestDelay ?? globalConfig?.requestDelay ?? 0,
      this.options.delay ?? 0 // Ensure class-level delay is respected
    );
    
    // Log the actual delay being used
    if (requestDelay > 0 && this.progressTracker) {
      this.progressTracker.log(`⏳ Using request delay: ${requestDelay}ms`);
    }

    // Ensure we don't have more concurrent requests than max requests
    const effectiveConcurrent = Math.min(concurrent, maxRequests);

    const startTime = Date.now();
    const results: RequestResult[] = [];
    const summaryOnly = globalConfig?.summaryOnly === true;
    
    // Summary statistics for when results are not kept
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalResponseTime = 0;
    let minResponseTime = Infinity;
    let maxResponseTime = 0;
    let totalRequestSizeKB = 0;
    let totalResponseSizeKB = 0;

    const errors: string[] = [];
    const endpointName = endpoint.name;

    // Determine execution mode: duration-based or request-count-based
    const useDuration = duration && duration > 0;
    const currentCount = () => summaryOnly ? (successfulRequests + failedRequests) : results.length;
    const shouldContinue = useDuration 
      ? () => (Date.now() - startTime) < duration 
      : () => currentCount() < maxRequests;

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
          const current = Math.min(currentCount(), maxRequests);
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
          const delay = this.options.delay || 0;
          if (delay > 0 && timeSinceLastRequest < delay) {
            const delayNeeded = delay - timeSinceLastRequest;
            await this.sleep(delayNeeded);
          }
          
          // Update last request time before making the request
          lastRequestTime = Date.now();
          
          const result = await this.makeRequest(endpoint, timeout, baseUrl);

          // Extract variables if this request was successful and has variables to extract
          if (result.success && endpoint.variables?.length) {
            this.extractVariables(endpoint.variables, result.data, result.headers);
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

          updateProgress(`Running: ${currentCount()}${useDuration ? '' : `/${maxRequests}`}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          if (summaryOnly) {
            failedRequests++;
            if (!errors.includes(errorMsg)) {
              errors.push(errorMsg);
            }
          } else {
            errors.push(errorMsg);
            results.push({
              success: false,
              responseTime: 0,
              error: errorMsg
            });
          }
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

    // Use summary variables if summaryOnly is true
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
    
    // Calculate requests per second
    const requestsPerSecond = totalElapsedTime > 0 ? (totalRequestsCount / (totalElapsedTime / 1000)) : 0;
    
    // Create the result object
    const endpointResult: EndpointResult = {
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
      errors: [...new Set(errors)], // Unique errors
      requestResults: results,
      totalRequestSizeKB: finalTotalRequestSizeKB,
      averageRequestSizeKB: totalRequestsCount > 0 ? finalTotalRequestSizeKB / totalRequestsCount : 0,
      totalResponseSizeKB: finalTotalResponseSizeKB,
      averageResponseSizeKB: totalRequestsCount > 0 ? finalTotalResponseSizeKB / totalRequestsCount : 0
    };
    
    // Final progress update
    updateProgress(`Completed ${totalRequestsCount} requests (${finalSuccessfulRequests} successful, ${finalFailedRequests} failed)`);
    
    return endpointResult;
  }

  /**
   * Handles authorization dependency by executing its endpoints.
   */
  private async handleAuthDependency(auth: AuthDependencyConfig, globalConfig: any = {}): Promise<void> {
    if (this.progressTracker) {
      this.progressTracker.log(`🔑 Processing authorization dependency: ${auth.name}`);
    } else {
      console.log(`🔑 Processing authorization dependency: ${auth.name}`);
    }

    const authVars = new Map<string, any>();
    
    for (const endpoint of auth.endpoints) {
      const result = await this.makeRequest(endpoint, globalConfig?.timeout || 15000, globalConfig?.baseUrl);
      
      if (!result.success) {
        throw new Error(`Authorization failed for "${auth.name}" at endpoint "${endpoint.name}": ${result.error}`);
      }

      if (endpoint.variables && result.data) {
        const extracted = this.extractVariables(endpoint.variables, result.data, result.headers || {});
        Object.entries(extracted).forEach(([key, value]) => {
          authVars.set(key, value);
          this.variables.set(key, value);
        });
      }
    }

    this.authVariablesMap.set(auth.name, authVars);
  }

  /**
   * Makes a single HTTP request to the endpoint with retry logic.
   * Performs variable substitution in URL, headers, and body.
   * @param endpoint Endpoint configuration.
   * @param timeout Request timeout in milliseconds.
   * @param baseUrl Base URL from global config.
   * @returns RequestResult with response data and timing.
   */
  private async makeRequest(endpoint: EndpointConfig, timeout: number, baseUrl?: string): Promise<RequestResult> {
    const retries = endpoint.retries || 0;
    let attempt = 0;
    let lastResult: RequestResult | undefined;

    while (attempt <= retries) {
      if (attempt > 0 && this.progressTracker) {
        this.progressTracker.log(`🔄 Retrying ${endpoint.name} (attempt ${attempt}/${retries})...`);
        // Exponential backoff
        const backoff = Math.pow(2, attempt) * 1000;
        await this.sleep(backoff);
      }

      lastResult = await this.executeSingleRequest(endpoint, timeout, baseUrl);
      
      // Check assertions if any
      if (lastResult.success && endpoint.assertions && endpoint.assertions.length > 0) {
        const assertionResults = this.checkAssertions(endpoint.assertions, lastResult.data, lastResult.headers);
        if (assertionResults.some(r => !r.success)) {
          lastResult.success = false;
          lastResult.error = `Assertion failed: ${assertionResults.filter(r => !r.success).map(r => r.message).join(', ')}`;
        }
      }

      // Check response result if configured
      if (lastResult.success && endpoint.responseCheck && endpoint.responseCheck.length > 0) {
        const checkResults = this.checkAssertions(endpoint.responseCheck as AssertionConfig[], lastResult.data, lastResult.headers);
        lastResult.responseCheckPassed = checkResults.every(r => r.success);
      }

      if (lastResult.success) {
        return lastResult;
      }

      attempt++;
    }

    return lastResult!;
  }

  /**
   * Executes a single HTTP request.
   */
  private async executeSingleRequest(endpoint: EndpointConfig, timeout: number, baseUrl?: string): Promise<RequestResult> {
    const startTime = process.hrtime();
    let statusCode: number | undefined;
    let error: string | undefined;
    let data: any;
    let requestSizeKB = 0;
    const endpointName = endpoint.name;

    // Update progress for request start
    if (this.progressTracker) {
      this.progressTracker.updateRequestProgress(endpointName, 0, 1, 'Starting request...');
    }

    if (this.options.dryRun) {
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const responseTime = (seconds * 1000) + (nanoseconds / 1e6);
      return {
        success: true,
        responseTime,
        statusCode: 200,
        data: { message: "Dry run: No actual request made" },
        headers: {},
        requestSizeKB: 0,
        responseSizeKB: 0
      };
    }

    try {
      // Build the full URL using baseUrl from global config
      let url = this.buildFullUrl(this.replaceVariables(endpoint.url), baseUrl);
      
      // Append query parameters if present
      if (endpoint.query) {
        const queryParams = this.replaceVariablesInObject(endpoint.query);
        const urlObj = new URL(url);
        Object.entries(queryParams).forEach(([key, value]) => {
          urlObj.searchParams.append(key, String(value));
        });
        url = urlObj.toString();
      }

      const headers = {
        ...this.options.headers,
        ...this.replaceVariablesInObject(endpoint.headers || {})
      };
      let body = endpoint.body;

      // Replace variables in the request body if it's an object
      if (body && typeof body === 'object') {
        body = this.replaceVariablesInObject(body);
      } else if (typeof body === 'string') {
        body = this.replaceVariables(body);
      }

      // Calculate request size in KB
      requestSizeKB = getObjectSizeKB(body) + getObjectSizeKB(headers);

      // --- BEFORE REQUEST HOOK ---
      if (endpoint.beforeRequest) {
        try {
          // Create a restricted context for the hook
          const hookContext = {
            request: {
              url,
              method: endpoint.method || 'GET',
              headers,
              body
            },
            variables: Object.fromEntries(this.variables)
          };
          
          // Use Function constructor to evaluate the hook
          // WARNING: This allows arbitrary JS execution. 
          // In a real library, this should be clearly documented.
          const hookFn = new Function('context', `
            with (context) {
              ${endpoint.beforeRequest}
            }
          `);
          hookFn(hookContext);
          
          // Update request with potentially modified values from the hook
          url = hookContext.request.url;
          Object.assign(headers, hookContext.request.headers);
          body = hookContext.request.body;
        } catch (hookError) {
          console.error(`Error in beforeRequest hook for endpoint "${endpointName}":`, hookError);
        }
      }
      // ---------------------------

      // Update progress before making the request
      if (this.progressTracker) {
        this.progressTracker.updateRequestProgress(endpointName, 0, 1, 'Sending request...');
      }

      // Make the request
      const response = await this.axiosInstance({
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

      // --- AFTER REQUEST HOOK ---
      if (endpoint.afterRequest) {
        try {
          const hookContext = {
            response: {
              data: response.data,
              status: response.status,
              headers: response.headers
            },
            variables: Object.fromEntries(this.variables)
          };
          
          const hookFn = new Function('context', `
            with (context) {
              ${endpoint.afterRequest}
            }
          `);
          hookFn(hookContext);
          
          // Allow the hook to modify data or status
          response.data = hookContext.response.data;
          response.status = hookContext.response.status;
          Object.assign(response.headers, hookContext.response.headers);
          
          // Allow the hook to update variables directly
          for (const [key, value] of Object.entries(hookContext.variables)) {
            this.variables.set(key, value);
          }
        } catch (hookError) {
          console.error(`Error in afterRequest hook for endpoint "${endpointName}":`, hookError);
        }
      }
      // ---------------------------

      // Calculate response size in KB
      let responseSizeKB = 0;
      const contentLength = response.headers['content-length'];
      if (contentLength) {
        responseSizeKB = parseInt(contentLength, 10) / 1024;
      } else {
        const responseHeadersSize = getObjectSizeKB(response.headers);
        const responseDataSize = getObjectSizeKB(response.data);
        responseSizeKB = responseHeadersSize + responseDataSize;
      }

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
   * Checks assertions against response data and headers.
   */
  private checkAssertions(assertions: AssertionConfig[], data: any, headers: any): { success: boolean; message: string }[] {
    return assertions.map(assertion => {
      const actualValue = this.getValueByPath(data, assertion.path) || headers[assertion.path] || headers[assertion.path.toLowerCase()];
      let success = false;
      let message = '';

      switch (assertion.operator) {
        case 'equals':
          success = actualValue === assertion.value;
          message = `Expected ${assertion.path} to equal ${assertion.value}, but got ${actualValue}`;
          break;
        case 'contains':
          success = String(actualValue).includes(String(assertion.value));
          message = `Expected ${assertion.path} to contain ${assertion.value}, but got ${actualValue}`;
          break;
        case 'exists':
          success = actualValue !== undefined && actualValue !== null;
          message = `Expected ${assertion.path} to exist, but it was ${actualValue}`;
          break;
        case 'matches':
          success = new RegExp(assertion.value).test(String(actualValue));
          message = `Expected ${assertion.path} to match ${assertion.value}, but got ${actualValue}`;
          break;
      }

      return { success, message: success ? 'Passed' : message };
    });
  }

  /**
   * Extracts variables from response data or headers according to extraction rules.
   * @param extractions Array of variable extraction configs.
   * @param responseData Response data object.
   * @param headers Response headers.
   */
  private extractVariables(extractions: any[], responseData: any, headers: any): Record<string, any> {
    const extractedResults: Record<string, any> = {};
    for (const extraction of extractions) {
      try {
        let value;
        if (extraction.from === 'response') {
          value = this.getValueByPath(responseData, extraction.path);
        } else if (extraction.from === 'headers') {
          value = headers[extraction.path] || headers[extraction.path.toLowerCase()];
        } else if (extraction.from === 'cookies') {
          const cookieHeader = headers['set-cookie'];
          if (Array.isArray(cookieHeader)) {
            const cookie = cookieHeader.find((c: string) => c.startsWith(`${extraction.path}=`));
            if (cookie) {
              value = cookie.split(';')[0].split('=')[1];
            }
          } else if (typeof cookieHeader === 'string') {
            const cookie = cookieHeader.split(',').find(c => c.trim().startsWith(`${extraction.path}=`));
            if (cookie) {
              value = cookie.trim().split(';')[0].split('=')[1];
            }
          }
        }
        
        if (value !== undefined) {
          this.variables.set(extraction.name, value);
          extractedResults[extraction.name] = value;
          // Security fix: Don't log potentially sensitive variable values
          const sanitizedValue = this.sanitizeForLogging(value, extraction.name);
          console.log(`📝 Extracted variable: ${extraction.name} = ${sanitizedValue}`);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to extract variable ${extraction.name}: ${error}`);
      }
    }
    return extractedResults;
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
   * Replaces placeholders with variable values and dynamic functions.
   * Supports:
   * - {{variableName}}
   * - {{$uuid}}
   * - {{$randomInt(min, max)}}
   * - {{$randomFrom(['a', 'b'])}}
   * - {{$randomWord}}
   * - {{$env.VARIABLE_NAME}}
   * @param text Text containing placeholders.
   * @returns Text with placeholders replaced.
   */
  private replaceVariables(text: string): string {
    if (!text) return text;
    
    let result = text;
    
    // Replace environment variables
    result = result.replace(/{{(\$env\.(.*?))}}/g, (_, __, envVarName) => {
      return process.env[envVarName] || `{{$env.${envVarName}}}`;
    });

    // Replace custom variables
    for (const [key, value] of this.variables) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }

    // Replace dynamic functions
    // {{$uuid}} or {{$randomUUID()}}
    result = result.replace(/{{(\$uuid|\$randomUUID\(\))}}/g, () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    });

    // {{$randomInt(min, max)}}
    result = result.replace(/{{(\$randomInt\(\s*(\d+)\s*,\s*(\d+)\s*\))}}/g, (_, __, min, max) => {
      const minVal = parseInt(min, 10);
      const maxVal = parseInt(max, 10);
      return Math.floor(Math.random() * (maxVal - minVal + 1) + minVal).toString();
    });

    // {{$randomFrom(['a', 'b'])}}
    result = result.replace(/{{(\$randomFrom\(\s*\[(.*?)\]\s*\))}}/g, (_, __, itemsStr) => {
      const items = itemsStr.split(',').map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''));
      if (items.length === 0) return '';
      return items[Math.floor(Math.random() * items.length)];
    });

    // {{$randomWord}}
    result = result.replace(/{{(\$randomWord)}}/g, () => {
      const words = ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew'];
      return words[Math.floor(Math.random() * words.length)];
    });

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
   * Saves benchmark results to JSON, CSV, and HTML files.
   * @param results BenchmarkResult object.
   * @param jsonPath Path to save JSON file.
   * @param csvPath Path to save CSV file.
   * @param htmlPath Optional path to save HTML file.
   */
  async saveResults(results: BenchmarkResult, jsonPath: string, csvPath: string, htmlPath?: string): Promise<void> {
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

    // Save HTML results if path provided
    if (htmlPath) {
        const html = this.generateHtmlReport(results);
        fs.writeFileSync(htmlPath, html);
        results.htmlPath = htmlPath;
    }
  }

  /**
   * Generates an HTML report from benchmark results.
   */
  private generateHtmlReport(results: BenchmarkResult): string {
    const { summary, results: endpointResults, timestamp } = results;
    const date = new Date(timestamp).toLocaleString();

    const rows = endpointResults.map(r => `
      <tr>
        <td>${r.name}</td>
        <td class="url-cell">${r.method} ${r.url}</td>
        <td>${r.totalRequests}</td>
        <td class="success">${r.successfulRequests}</td>
        <td class="${r.failedRequests > 0 ? 'failure' : ''}">${r.failedRequests}</td>
        <td>${r.averageResponseTime.toFixed(2)}ms</td>
        <td>${r.minResponseTime.toFixed(0)}ms</td>
        <td>${r.maxResponseTime.toFixed(0)}ms</td>
        <td>${r.requestsPerSecond.toFixed(2)}</td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Glockit Benchmark Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; }
        .header { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 20px; border-left: 5px solid #007bff; }
        h1 { margin-top: 0; color: #007bff; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: center; }
        .card .value { font-size: 24px; font-weight: bold; color: #007bff; display: block; }
        .card .label { font-size: 14px; color: #6c757d; text-transform: uppercase; letter-spacing: 1px; }
        .card.success .value { color: #28a745; }
        .card.failure .value { color: #dc3545; }
        table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background-color: #f1f3f5; font-weight: 600; color: #495057; }
        tr:last-child td { border-bottom: none; }
        tr:hover { background-color: #f8f9fa; }
        .success { color: #28a745; font-weight: 600; }
        .failure { color: #dc3545; font-weight: 600; }
        .url-cell { font-family: monospace; font-size: 13px; color: #666; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .footer { margin-top: 40px; text-align: center; color: #6c757d; font-size: 14px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 Glockit Benchmark Report</h1>
        <p>Generated on <strong>${date}</strong></p>
    </div>

    <div class="summary-grid">
        <div class="card">
            <span class="label">Total Requests</span>
            <span class="value">${summary.totalRequests}</span>
        </div>
        <div class="card success">
            <span class="label">Successful</span>
            <span class="value">${summary.totalSuccessful}</span>
        </div>
        <div class="card failure">
            <span class="label">Failed</span>
            <span class="value">${summary.totalFailed}</span>
        </div>
        <div class="card">
            <span class="label">Avg. Response Time</span>
            <span class="value">${summary.averageResponseTime.toFixed(2)}ms</span>
        </div>
        <div class="card">
            <span class="label">Overall RPS</span>
            <span class="value">${summary.overallRequestsPerSecond.toFixed(2)}</span>
        </div>
    </div>

    <h2>Detailed Results</h2>
    <table>
        <thead>
            <tr>
                <th>Endpoint</th>
                <th>URL</th>
                <th>Total</th>
                <th>Success</th>
                <th>Failure</th>
                <th>Avg Time</th>
                <th>Min</th>
                <th>Max</th>
                <th>RPS</th>
            </tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>

    <div class="footer">
        Generated by Glockit v1.0.5 - Lightweight API Benchmarking Tool
    </div>
</body>
</html>
    `;
  }

  /**
   * Helper to combine baseUrl and endpoint url
   */
  private buildFullUrl(endpointUrl: string, baseUrl?: string): string {
    if (!endpointUrl) return '';
    // If endpointUrl is absolute, return as-is
    if (/^https?:\/\//i.test(endpointUrl)) return endpointUrl;
    if (!baseUrl) return endpointUrl;
    // Ensure proper joining of baseUrl and endpointUrl
    return baseUrl.replace(/\/$/, '') + '/' + endpointUrl.replace(/^\//, '');
  }
}

export * from './types';

