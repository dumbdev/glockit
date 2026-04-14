import axios from 'axios';
import chalk from 'chalk';
import { ProgressTracker } from './platform/progress';
import { NodePlatform } from './platform/node-platform';

/**
 * Calculates the approximate size of an object in KB.
 * @param obj The object to calculate size for
 * @param platform The platform to use for calculation
 * @returns Size in KB
 */
function getObjectSizeKB(obj: any, platform: Platform): number {
  return platform.getObjectSizeKB(obj);
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
  AuthDependencyConfig,
  Platform,
  ResponseTimePercentiles,
  SloConfig,
  SloEvaluation,
  BenchmarkPhase,
  EndpointPhaseResult,
  DataFeederConfig,
  LoadShapeConfig,
  VirtualUserConfig,
  TransactionGroupConfig,
  TransactionGroupResult,
  DiagnosticsConfig,
  DiagnosticsSummary,
  DiagnosticSample,
  ReporterOutputConfig,
  BenchmarkReporter,
  DistributedConfig
} from './types';
import { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { ObservabilityManager } from './observability/observability';
import { DistributedCoordinator, mergeDistributedResults } from './distributed/distributed';
import { generateHtmlReport, generateJunitReport } from './metrics/reporting';
import {
  applyCoordinatedOmissionCorrection as applyCoordinatedOmissionCorrectionUtil,
  buildDiagnosticsSummary as buildDiagnosticsSummaryUtil,
  buildTransactionGroupResults as buildTransactionGroupResultsUtil,
  calculatePercentiles as calculatePercentilesUtil
} from './metrics/analytics';
import {
  loadDataFeederRows,
  parseCsvData as parseCsvDataUtil,
  parseCsvRows as parseCsvRowsUtil
} from './runtime/data-feeder';
import {
  applyLoadShape as applyLoadShapeUtil,
  getEffectiveRequestDelayMs as getEffectiveRequestDelayMsUtil,
  resolveCoordinatedOmissionSettings as resolveCoordinatedOmissionSettingsUtil,
  selectWeightedScenario as selectWeightedScenarioUtil
} from './runtime/traffic';
import {
  captureSetCookies as captureSetCookiesUtil,
  createVirtualUserSession as createVirtualUserSessionUtil,
  getCookieHeader as getCookieHeaderUtil,
  resolveVirtualUserConfig as resolveVirtualUserConfigUtil,
  VirtualUserSession
} from './runtime/virtual-user';
import {
  buildEmptyWorkerResult,
  buildNoAssignmentsWorkerResult,
  buildWorkerRuntimeContext,
  joinCoordinator,
  postWorkerResultWithRetry,
  startWorkerHeartbeatLoop
} from './distributed/distributed-worker';
import { runScenarioMix } from './runtime/scenario-mix';
import { getExampleBenchmarkConfig } from './runtime/example-config';
import { resolveEndpointDependencies } from './runtime/dependency-resolver';
import { buildEndpointResult } from './metrics/endpoint-metrics';
import { executeGrpcRequest, executeWebSocketRequest } from './runtime/request-engines';

export { ProgressTracker } from './platform/progress';

const DEFAULT_MASK_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'token',
  'password',
  'secret',
  'apikey',
  'x-api-key'
];

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
  private platform: Platform;
  private dataFeedRows: Array<Record<string, any>> = [];
  private dataFeederIndex = 0;
  private dataFeederStrategy: 'sequential' | 'random' = 'sequential';
  private reporters = new Map<string, BenchmarkReporter>();

  public previewDataFeeder(dataFeeder: DataFeederConfig, limit: number = 5): Array<Record<string, any>> {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5;
    this.initializeDataFeeder(dataFeeder);
    return this.dataFeedRows.slice(0, safeLimit);
  }

  public registerReporter(name: string, reporter: BenchmarkReporter): void {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) {
      throw new Error('Reporter name must be a non-empty string');
    }
    this.reporters.set(normalizedName, reporter);
  }

  private runHookInSandbox(
    script: string,
    context: Record<string, any>,
    hookName: 'beforeRequest' | 'afterRequest',
    endpointName: string
  ): void {
    if (this.platform.name !== 'node') {
      throw new Error(`${hookName} is only supported on the node platform`);
    }

    const vm = require('node:vm') as typeof import('node:vm');
    const sandbox = {
      request: context.request,
      response: context.response,
      variables: context.variables,
      Math,
      Date,
      JSON,
      String,
      Number,
      Boolean,
      Array,
      Object,
      RegExp
    };

    const vmContext = vm.createContext(sandbox, {
      codeGeneration: {
        strings: false,
        wasm: false
      }
    });

    const compiled = new vm.Script(`"use strict";\n${script}`, {
      filename: `${endpointName}.${hookName}.hook.js`
    });

    compiled.runInContext(vmContext, { timeout: 1000 });
  }

  constructor(options: GlockitOptions = {}) {
    this.options = {
      delay: 0,
      progress: true,
      dryRun: false,
      ...options
    };
    this.platform = this.options.platform || new NodePlatform();
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

    const distributedConfig = validatedConfig.global?.distributed;
    if (distributedConfig?.enabled) {
      if (distributedConfig.role === 'coordinator') {
        return this.runDistributedCoordinator(validatedConfig, distributedConfig);
      }
      return this.runDistributedWorker(validatedConfig, distributedConfig);
    }

    const observabilityManager = new ObservabilityManager(this.platform.name);
    await observabilityManager.initialize(validatedConfig.global?.observability);
    const startTime = this.platform.now();
    const results: EndpointResult[] = [];

    // Initialize progress tracker if enabled
    if (showProgress) {
      this.progressTracker = new ProgressTracker(this.platform);
      this.progressTracker.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);
    } else {
      this.platform.log(`🚀 Starting benchmark with ${validatedConfig.endpoints.length} endpoints`);
    }

    if (this.options.dryRun) {
      if (this.progressTracker) this.progressTracker.log('DRY RUN MODE: No actual requests will be made.');
      else this.platform.log('DRY RUN MODE: No actual requests will be made.');
    }

    // Process endpoints in dependency order
    const processedEndpoints = this.resolveDependencies(validatedConfig.endpoints);

    // Initial variables from global config if any (though not explicitly in types, good for future)
    this.variables.clear();
    this.initializeDataFeeder(validatedConfig.global?.dataFeeder);

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
    if (validatedConfig.global?.scenarioMix?.enabled) {
      const scenarioResults = await this.benchmarkScenarioMix(processedEndpoints, validatedConfig.global || {});
      results.push(...scenarioResults);
    } else {
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
    }

    const endTime = this.platform.now();
    const totalDuration = endTime - startTime;

    const summary: BenchmarkSummary = {
      totalDuration,
      totalRequests: results.reduce((sum, r) => sum + r.totalRequests, 0),
      totalSuccessful: results.reduce((sum, r) => sum + r.successfulRequests, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failedRequests, 0),
      overallRequestsPerSecond: 0,
      averageResponseTime: 0,
      responseTimePercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      errorRate: 0
    };

    if (summary.totalRequests > 0) {
      summary.overallRequestsPerSecond = summary.totalRequests / (totalDuration / 1000);
      summary.averageResponseTime = results.reduce((sum, r) => sum + (r.averageResponseTime * r.totalRequests), 0) / summary.totalRequests;
      summary.errorRate = summary.totalFailed / summary.totalRequests;

      const globalResponseTimes = results.flatMap(r =>
        r.requestResults.filter(req => req.success).map(req => req.responseTime)
      );

      const coSettings = this.resolveCoordinatedOmissionSettings(validatedConfig.global, validatedConfig.global?.arrivalRate);
      let responseTimesForPercentiles = globalResponseTimes;

      if (coSettings.enabled && coSettings.expectedIntervalMs !== undefined) {
        const corrected = this.applyCoordinatedOmissionCorrection(globalResponseTimes, coSettings.expectedIntervalMs);
        responseTimesForPercentiles = corrected.values;
        summary.coordinatedOmission = {
          enabled: true,
          expectedIntervalMs: coSettings.expectedIntervalMs,
          appliedSamples: corrected.addedSamples
        };
      }

      summary.responseTimePercentiles = this.calculatePercentiles(responseTimesForPercentiles);
    }

    if (validatedConfig.global?.slo) {
      summary.slo = this.evaluateSlo(summary, validatedConfig.global.slo);
    }

    if (validatedConfig.global?.transactionGroups?.length) {
      const coSettings = this.resolveCoordinatedOmissionSettings(validatedConfig.global, validatedConfig.global?.arrivalRate);
      summary.transactionGroups = this.buildTransactionGroupResults(
        validatedConfig.global.transactionGroups,
        results,
        totalDuration,
        coSettings
      );
    }

    if (validatedConfig.global?.diagnostics?.enabled) {
      summary.diagnostics = this.buildDiagnosticsSummary(results, validatedConfig.global.diagnostics);
    }

    const benchmarkResult: BenchmarkResult = {
      config: validatedConfig,
      results,
      summary,
      timestamp: new Date().toISOString()
    };

    benchmarkResult.observability = await observabilityManager.publish(benchmarkResult);

    return benchmarkResult;
  }

  private async runDistributedCoordinator(
    config: BenchmarkConfig,
    distributedConfig: DistributedConfig
  ): Promise<BenchmarkResult> {
    if (this.platform.name !== 'node') {
      throw new Error('distributed coordinator mode is only supported on the node platform');
    }

    const coordinator = new DistributedCoordinator(distributedConfig, config, this.platform);
    return coordinator.run();
  }

  private async runDistributedWorker(
    config: BenchmarkConfig,
    distributedConfig: DistributedConfig
  ): Promise<BenchmarkResult> {
    if (this.platform.name !== 'node') {
      throw new Error('distributed worker mode is only supported on the node platform');
    }

    const runtime = buildWorkerRuntimeContext(distributedConfig);
    const {
      coordinatorUrl,
      workerId,
      pollIntervalMs,
      joinTimeoutMs,
      heartbeatIntervalMs,
      resultSubmitRetries,
      resultSubmitBackoffMs,
      authHeaders
    } = runtime;

    await joinCoordinator(coordinatorUrl, workerId, authHeaders);
    this.platform.log(`🔗 Worker ${workerId} joined coordinator ${coordinatorUrl}`);

    const heartbeat = startWorkerHeartbeatLoop(
      coordinatorUrl,
      workerId,
      authHeaders,
      heartbeatIntervalMs,
      this.sleep.bind(this)
    );

    try {
      const start = this.platform.now();
      const localResults: BenchmarkResult[] = [];

      while (true) {
        const response = await axios.get(`${coordinatorUrl}/plan/${encodeURIComponent(workerId)}`, {
          timeout: 15000,
          headers: authHeaders
        });

        if (response.data?.done) {
          break;
        }

        if (response.data?.ready) {
          const plan = response.data;
          const assignedEndpoints: string[] = Array.isArray(plan?.assignedEndpoints) ? plan.assignedEndpoints : [];
          const workerConfig: BenchmarkConfig | undefined = plan?.config;

          if (!workerConfig) {
            throw new Error('Coordinator returned an invalid worker plan');
          }

          let workerResult: BenchmarkResult;
          if (assignedEndpoints.length === 0 || workerConfig.endpoints.length === 0) {
            workerResult = buildEmptyWorkerResult(workerConfig);
          } else {
            const workerBench = new Glockit({
              ...this.options,
              progress: this.options.progress
            });
            workerResult = await workerBench.run(workerConfig, this.options.progress);
          }

          workerResult.distributed = {
            role: 'worker',
            workerId,
            coordinatorUrl,
            assignedEndpoints
          };

          localResults.push(workerResult);

          await postWorkerResultWithRetry({
            coordinatorUrl,
            workerId,
            workerResult,
            authHeaders,
            timeoutMs: Math.max(30000, distributedConfig.resultTimeoutMs ?? 30000),
            retries: resultSubmitRetries,
            backoffMs: resultSubmitBackoffMs,
            sleep: this.sleep.bind(this),
            log: this.platform.log.bind(this.platform)
          });

          continue;
        }

        if (this.platform.now() - start > joinTimeoutMs) {
          throw new Error('Timed out waiting for distributed worker plan from coordinator');
        }

        await this.sleep(pollIntervalMs);
      }

      if (localResults.length === 0) {
        return buildNoAssignmentsWorkerResult(config, workerId, coordinatorUrl);
      }

      const mergedLocal = mergeDistributedResults(config, localResults);
      mergedLocal.distributed = {
        role: 'worker',
        workerId,
        coordinatorUrl,
        assignedEndpoints: mergedLocal.results.map(endpoint => endpoint.name)
      };

      return mergedLocal;
    } finally {
      heartbeat.stop();
    }
  }

  private async benchmarkScenarioMix(endpoints: EndpointConfig[], globalConfig: any): Promise<EndpointResult[]> {
    const scenarioMix = globalConfig?.scenarioMix;
    if (!scenarioMix?.enabled) {
      return [];
    }

    if (this.progressTracker) {
      this.progressTracker.log(`🎲 Scenario mix mode enabled (${scenarioMix.scenarios.length} scenarios)`);
    }

    return runScenarioMix(endpoints, globalConfig, {
      now: this.platform.now.bind(this.platform),
      resolveVirtualUserConfig: this.resolveVirtualUserConfig.bind(this),
      createVirtualUserSession: this.createVirtualUserSession.bind(this),
      selectWeightedScenario: this.selectWeightedScenario.bind(this),
      handleAuthDependency: this.handleAuthDependency.bind(this),
      authVariablesMap: this.authVariablesMap,
      sharedVariables: this.variables,
      applyNextDataFeederRow: this.applyNextDataFeederRow.bind(this),
      makeRequest: this.makeRequest.bind(this),
      extractVariables: this.extractVariables.bind(this),
      resolveCoordinatedOmissionSettings: this.resolveCoordinatedOmissionSettings.bind(this),
      applyCoordinatedOmissionCorrection: this.applyCoordinatedOmissionCorrection.bind(this),
      calculatePercentiles: this.calculatePercentiles.bind(this),
      onProgress: (endpointName, completed, total, scenarioName) => {
        if (!this.progressTracker) {
          return;
        }
        this.progressTracker.updateEndpointProgress(
          endpointName,
          completed,
          total,
          `Scenario: ${scenarioName}`
        );
      }
    });
  }

  /**
   * Generates an example configuration object.
   * @returns BenchmarkConfig example.
   */
  public static generateExampleConfig(): BenchmarkConfig {
    return getExampleBenchmarkConfig();
  }

  /**
   * Resolves endpoint dependencies to determine execution order.
   */
  private resolveDependencies(endpoints: EndpointConfig[]): EndpointConfig[] {
    return resolveEndpointDependencies(endpoints);
  }

  /**
   * Benchmarks a single endpoint with concurrency and throttling.
   * @param endpoint Endpoint configuration.
   * @param globalConfig Global configuration options.
   * @returns EndpointResult with statistics for the endpoint.
   */
  private async benchmarkEndpoint(endpoint: EndpointConfig, globalConfig: any = {}): Promise<EndpointResult> {
    const duration = globalConfig?.duration; // Duration in milliseconds
    const hasTimedMode = (duration && duration > 0) || (Array.isArray(globalConfig?.phases) && globalConfig.phases.length > 0);
    const maxRequests = endpoint.maxRequests ?? globalConfig?.maxRequests ?? (hasTimedMode ? Number.MAX_SAFE_INTEGER : 10);
    const concurrent = globalConfig?.concurrent || 1;
    const executor: 'concurrency' | 'arrival-rate' = globalConfig?.executor || 'concurrency';
    const globalArrivalRate: number | undefined = globalConfig?.arrivalRate;
    const globalLoadShape = globalConfig?.loadShape;
    const timeout = globalConfig?.timeout || 15000;
    const baseUrl = globalConfig?.baseUrl;
    const virtualUsersConfig = this.resolveVirtualUserConfig(globalConfig?.virtualUsers);
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
    const phases: BenchmarkPhase[] = Array.isArray(globalConfig?.phases) ? globalConfig.phases : [];
    const phaseResults: EndpointPhaseResult[] = [];

    const startTime = this.platform.now();
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

    // Determine execution mode: duration-based, phase-based or request-count-based
    const useDuration = duration && duration > 0;
    const usePhases = phases.length > 0;
    const currentCount = () => summaryOnly ? (successfulRequests + failedRequests) : results.length;
    const shouldContinue = useDuration 
      ? () => (this.platform.now() - startTime) < duration 
      : () => currentCount() < maxRequests;

    let lastUpdateTime = this.platform.now();
    const updateInterval = 100; // Update progress every 100ms

    // Function to update progress
    const updateProgress = (status: string) => {
        const now = this.platform.now();
      if (now - lastUpdateTime >= updateInterval || 
          status.includes('Completed') || 
          status.includes('Error') || 
          status.includes('Waiting')) {
        if (this.progressTracker) {
          // Ensure we don't exceed maxRequests
          const current = Math.min(currentCount(), maxRequests);
          const total = maxRequests === Number.MAX_SAFE_INTEGER ? Math.max(current, 1) : maxRequests;
          
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
    
    const executeRequest = async (
      workerId: number,
      shouldRun: () => boolean,
      throttleMs: number,
      resolveRequestDelayMs: () => number,
      statusPrefix?: string
    ) => {
      let lastRequestTime = 0;
      const session = virtualUsersConfig.sessionScope ? this.createVirtualUserSession(`${endpointName}-${workerId}`) : undefined;

      while (shouldRun()) {
        try {
          // Calculate time since last request
          const now = this.platform.now();
          const timeSinceLastRequest = now - lastRequestTime;
          
          // Apply request delay if needed
          const delay = resolveRequestDelayMs();
          if (delay > 0 && timeSinceLastRequest < delay) {
            const delayNeeded = delay - timeSinceLastRequest;
            await this.sleep(delayNeeded);
          }
          
          // Update last request time before making the request
          lastRequestTime = this.platform.now();

          // Apply optional feeder row values before each request.
          this.applyNextDataFeederRow(session?.variables);
          
          const result = await this.makeRequest(endpoint, timeout, baseUrl, session, virtualUsersConfig, globalConfig?.diagnostics);

          // Extract variables if this request was successful and has variables to extract
          if (result.success && endpoint.variables?.length) {
            this.extractVariables(endpoint.variables, result.data, result.headers, session?.variables);
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
            results.push({
              success: false,
              responseTime: 0,
              error: errorMsg
            });
          }
          updateProgress(`Error: ${errorMsg.substring(0, 30)}...`);
        }
        
        // Apply throttling between requests if configured
        if (throttleMs > 0) {
          await this.sleep(throttleMs);
        }
      }
    };

    if (usePhases) {
      for (const phase of phases) {
        if (currentCount() >= maxRequests) {
          break;
        }

        const phaseConcurrent = Math.min(
          phase.concurrent ?? effectiveConcurrent,
          Math.max(1, maxRequests - currentCount())
        );
        const phaseThrottle = phase.throttle ?? endpoint.throttle ?? globalConfig?.throttle ?? 0;
        const phaseConfiguredDelay = Math.max(
          phase.requestDelay ?? endpoint.requestDelay ?? globalConfig?.requestDelay ?? 0,
          this.options.delay ?? 0
        );
        const phaseArrivalRate = phase.arrivalRate ?? globalArrivalRate;
        const phaseLoadShape = phase.loadShape ?? globalLoadShape;
        const phaseEndTime = this.platform.now() + phase.duration;
        const phaseStartTime = this.platform.now();
        const beforeTotal = currentCount();
        const beforeSuccess = successfulRequests;
        const beforeFailed = failedRequests;

        if (this.progressTracker) {
          this.progressTracker.log(`🧭 Phase "${phase.name}" started (${phase.duration}ms, c=${phaseConcurrent})`);
        }

        const phaseShouldContinue = () => this.platform.now() < phaseEndTime && currentCount() < maxRequests;
        const phaseDelayResolver = () => {
          const elapsedMs = this.platform.now() - phaseStartTime;
          const effectiveArrivalRate = this.applyLoadShape(phaseArrivalRate, phaseLoadShape, elapsedMs);
          return this.getEffectiveRequestDelayMs(
            phaseConfiguredDelay,
            executor,
            effectiveArrivalRate,
            phaseConcurrent
          );
        };
        const phaseWorkers: Promise<void>[] = [];

        for (let i = 0; i < phaseConcurrent; i++) {
          phaseWorkers.push(executeRequest(i, phaseShouldContinue, phaseThrottle, phaseDelayResolver, `[${phase.name}]`));
        }

        await Promise.all(phaseWorkers);

        const phaseElapsed = this.platform.now() - phaseStartTime;
        const phaseTotalRequests = currentCount() - beforeTotal;
        const phaseSuccessfulRequests = successfulRequests - beforeSuccess;
        const phaseFailedRequests = failedRequests - beforeFailed;
        const phaseRps = phaseElapsed > 0 ? phaseTotalRequests / (phaseElapsed / 1000) : 0;

        phaseResults.push({
          name: phase.name,
          durationMs: phaseElapsed,
          totalRequests: phaseTotalRequests,
          successfulRequests: phaseSuccessfulRequests,
          failedRequests: phaseFailedRequests,
          requestsPerSecond: phaseRps
        });
      }
    } else {
      const baseThrottle = endpoint.throttle ?? globalConfig?.throttle ?? 0;
      const baseStartTime = this.platform.now();
      const baseDelayResolver = () => {
        const elapsedMs = this.platform.now() - baseStartTime;
        const effectiveArrivalRate = this.applyLoadShape(globalArrivalRate, globalLoadShape, elapsedMs);
        return this.getEffectiveRequestDelayMs(
          requestDelay,
          executor,
          effectiveArrivalRate,
          effectiveConcurrent
        );
      };
      const workers: Promise<void>[] = [];
      for (let i = 0; i < effectiveConcurrent; i++) {
        workers.push(executeRequest(i, shouldContinue, baseThrottle, baseDelayResolver));
      }
      await Promise.all(workers);
    }
    
    const endTime = this.platform.now();
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
      resolveCoordinatedOmissionSettings: this.resolveCoordinatedOmissionSettings.bind(this),
      applyCoordinatedOmissionCorrection: this.applyCoordinatedOmissionCorrection.bind(this),
      calculatePercentiles: this.calculatePercentiles.bind(this)
    });

    const totalRequestsCount = endpointResult.totalRequests;
    const finalSuccessfulRequests = endpointResult.successfulRequests;
    const finalFailedRequests = endpointResult.failedRequests;
    
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
  private async makeRequest(
    endpoint: EndpointConfig,
    timeout: number,
    baseUrl?: string,
    session?: VirtualUserSession,
    virtualUsersConfig?: VirtualUserConfig,
    diagnosticsConfig?: DiagnosticsConfig
  ): Promise<RequestResult> {
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

      lastResult = await this.executeSingleRequest(endpoint, timeout, baseUrl, session, virtualUsersConfig, diagnosticsConfig);
      
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
  private async executeSingleRequest(
    endpoint: EndpointConfig,
    timeout: number,
    baseUrl?: string,
    session?: VirtualUserSession,
    virtualUsersConfig?: VirtualUserConfig,
    diagnosticsConfig?: DiagnosticsConfig
  ): Promise<RequestResult> {
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
        requestUrl: endpoint.url,
        requestMethod: endpoint.method,
        requestSizeKB: 0,
        responseSizeKB: 0
      };
    }

    try {
      const transport = endpoint.transport || 'http';

      // Build the full URL using baseUrl from global config
      let url = transport === 'grpc'
        ? this.replaceVariables(endpoint.url, session?.variables)
        : this.buildFullUrl(this.replaceVariables(endpoint.url, session?.variables), baseUrl);
      
      // Append query parameters if present
      if (endpoint.query && transport !== 'grpc') {
        const queryParams = this.replaceVariablesInObject(endpoint.query, session?.variables);
        const urlObj = new URL(url);
        Object.entries(queryParams).forEach(([key, value]) => {
          urlObj.searchParams.append(key, String(value));
        });
        url = urlObj.toString();
      }

      const headers = {
        ...this.options.headers,
        ...this.replaceVariablesInObject(endpoint.headers || {}, session?.variables)
      };
      const cookieHeader = this.getCookieHeader(session, virtualUsersConfig);
      if (cookieHeader) {
        headers.Cookie = cookieHeader;
      }
      let body = endpoint.body;

      // Replace variables in the request body if it's an object
      if (body && typeof body === 'object') {
        body = this.replaceVariablesInObject(body, session?.variables);
      } else if (typeof body === 'string') {
        body = this.replaceVariables(body, session?.variables);
      }

      // Calculate request size in KB
      requestSizeKB = getObjectSizeKB(body, this.platform) + getObjectSizeKB(headers, this.platform);

      // --- BEFORE REQUEST HOOK ---
      if (endpoint.beforeRequest) {
        try {
          const hookContext = {
            request: {
              url,
              method: endpoint.method || 'GET',
              headers,
              body
            },
            variables: Object.fromEntries(session?.variables || this.variables)
          };

          this.runHookInSandbox(endpoint.beforeRequest, hookContext, 'beforeRequest', endpointName);
          
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
      const response = transport === 'http'
        ? await this.axiosInstance({
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
        })
        : transport === 'websocket'
          ? await executeWebSocketRequest({ endpoint, url, headers, body, timeout })
          : await executeGrpcRequest({ endpoint, url, headers, body, timeout });

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
            variables: Object.fromEntries(session?.variables || this.variables)
          };

          this.runHookInSandbox(endpoint.afterRequest, hookContext, 'afterRequest', endpointName);
          
          // Allow the hook to modify data or status
          response.data = hookContext.response.data;
          response.status = hookContext.response.status;
          Object.assign(response.headers, hookContext.response.headers);
          
          // Allow the hook to update variables directly
          for (const [key, value] of Object.entries(hookContext.variables)) {
            if (session) {
              session.variables.set(key, value);
            } else {
              this.variables.set(key, value);
            }
          }
        } catch (hookError) {
          console.error(`Error in afterRequest hook for endpoint "${endpointName}":`, hookError);
        }
      }
      // ---------------------------

      this.captureSetCookies(response.headers, session, virtualUsersConfig);

      // Calculate response size in KB
      let responseSizeKB = 0;
      const contentLength = response.headers['content-length'];
      if (contentLength) {
        responseSizeKB = parseInt(contentLength, 10) / 1024;
      } else {
        const responseHeadersSize = getObjectSizeKB(response.headers, this.platform);
        const responseDataSize = getObjectSizeKB(response.data, this.platform);
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
        requestUrl: diagnosticsConfig?.enabled ? url : undefined,
        requestMethod: diagnosticsConfig?.enabled ? (endpoint.method || 'GET') : undefined,
        requestHeaders: diagnosticsConfig?.enabled ? headers : undefined,
        requestBody: diagnosticsConfig?.enabled ? body : undefined,
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
        requestUrl: diagnosticsConfig?.enabled ? endpoint.url : undefined,
        requestMethod: diagnosticsConfig?.enabled ? (endpoint.method || 'GET') : undefined,
        requestHeaders: diagnosticsConfig?.enabled
          ? this.replaceVariablesInObject({ ...(this.options.headers || {}), ...(endpoint.headers || {}) }, session?.variables)
          : undefined,
        requestBody: diagnosticsConfig?.enabled
          ? this.replaceVariablesInObject(endpoint.body, session?.variables)
          : undefined,
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
      const safeHeaders = headers || {};
      const actualValue = this.getValueByPath(data, assertion.path)
        ?? safeHeaders[assertion.path]
        ?? safeHeaders[assertion.path.toLowerCase()];
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
  private extractVariables(
    extractions: any[],
    responseData: any,
    headers: any,
    variableScope?: Map<string, any>
  ): Record<string, any> {
    const extractedResults: Record<string, any> = {};
    const scopedVariables = variableScope || this.variables;
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
          scopedVariables.set(extraction.name, value);
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
  private replaceVariables(text: string, variableScope?: Map<string, any>): string {
    if (!text) return text;
    
    let result = text;
    
    // Replace environment variables
    result = result.replace(/{{(\$env\.(.*?))}}/g, (_, __, envVarName) => {
      return this.platform.getEnvVar(envVarName) || `{{$env.${envVarName}}}`;
    });

    // Replace custom variables
    const scopedVariables = variableScope || this.variables;
    for (const [key, value] of scopedVariables) {
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
  private replaceVariablesInObject(obj: any, variableScope?: Map<string, any>): any {
    if (!obj) return obj;
    if (typeof obj === 'string') return this.replaceVariables(obj, variableScope);
    if (Array.isArray(obj)) return obj.map(item => this.replaceVariablesInObject(item, variableScope));
    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceVariablesInObject(value, variableScope);
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

  private initializeDataFeeder(dataFeeder?: DataFeederConfig): void {
    this.dataFeedRows = [];
    this.dataFeederIndex = 0;
    this.dataFeederStrategy = dataFeeder?.strategy || 'sequential';

    if (!dataFeeder) {
      return;
    }

    this.dataFeedRows = loadDataFeederRows(dataFeeder, this.platform.name);

    if (this.progressTracker) {
      this.progressTracker.log(`📦 Loaded data feeder rows: ${this.dataFeedRows.length}`);
    }
  }

  private parseCsvData(raw: string): Array<Record<string, any>> {
    return parseCsvDataUtil(raw);
  }

  private parseCsvRows(raw: string): string[][] {
    return parseCsvRowsUtil(raw);
  }

  private applyNextDataFeederRow(variableScope?: Map<string, any>): void {
    if (!this.dataFeedRows.length) {
      return;
    }

    const index = this.dataFeederStrategy === 'random'
      ? Math.floor(Math.random() * this.dataFeedRows.length)
      : (this.dataFeederIndex++ % this.dataFeedRows.length);

    const row = this.dataFeedRows[index];
    const scopedVariables = variableScope || this.variables;
    scopedVariables.set('feederRow', row);

    for (const [key, value] of Object.entries(row)) {
      scopedVariables.set(key, value);
    }
  }

  private resolveVirtualUserConfig(config?: VirtualUserConfig): Required<VirtualUserConfig> {
    return resolveVirtualUserConfigUtil(config);
  }

  private createVirtualUserSession(id: string): VirtualUserSession {
    return createVirtualUserSessionUtil(id, this.variables);
  }

  private getCookieHeader(session: VirtualUserSession | undefined, virtualUsersConfig?: VirtualUserConfig): string | undefined {
    return getCookieHeaderUtil(session, virtualUsersConfig);
  }

  private captureSetCookies(headers: any, session: VirtualUserSession | undefined, virtualUsersConfig?: VirtualUserConfig): void {
    captureSetCookiesUtil(headers, session, virtualUsersConfig);
  }

  private getEffectiveRequestDelayMs(
    configuredDelayMs: number,
    executor: 'concurrency' | 'arrival-rate',
    arrivalRate: number | undefined,
    workerCount: number
  ): number {
    return getEffectiveRequestDelayMsUtil(configuredDelayMs, executor, arrivalRate, workerCount);
  }

  private applyLoadShape(
    baseArrivalRate: number | undefined,
    loadShape: LoadShapeConfig | undefined,
    elapsedMs: number
  ): number | undefined {
    return applyLoadShapeUtil(baseArrivalRate, loadShape, elapsedMs);
  }

  private selectWeightedScenario(scenarios: Array<{ name: string; weight?: number; flow: string[] }>) {
    return selectWeightedScenarioUtil(scenarios);
  }

  private resolveCoordinatedOmissionSettings(
    globalConfig: any,
    arrivalRate?: number
  ): { enabled: boolean; expectedIntervalMs?: number } {
    return resolveCoordinatedOmissionSettingsUtil(globalConfig, arrivalRate);
  }

  private applyCoordinatedOmissionCorrection(
    values: number[],
    expectedIntervalMs: number
  ): { values: number[]; addedSamples: number } {
    return applyCoordinatedOmissionCorrectionUtil(values, expectedIntervalMs);
  }

  private calculatePercentiles(values: number[]): ResponseTimePercentiles {
    return calculatePercentilesUtil(values);
  }

  private evaluateSlo(summary: BenchmarkSummary, slo: SloConfig): SloEvaluation {
    const failures: string[] = [];

    if (slo.maxErrorRate !== undefined && summary.errorRate > slo.maxErrorRate) {
      failures.push(`errorRate ${summary.errorRate.toFixed(4)} > ${slo.maxErrorRate}`);
    }

    if (slo.maxAvgResponseTimeMs !== undefined && summary.averageResponseTime > slo.maxAvgResponseTimeMs) {
      failures.push(`avgResponseTime ${summary.averageResponseTime.toFixed(2)}ms > ${slo.maxAvgResponseTimeMs}ms`);
    }

    if (slo.p95Ms !== undefined && summary.responseTimePercentiles.p95 > slo.p95Ms) {
      failures.push(`p95 ${summary.responseTimePercentiles.p95.toFixed(2)}ms > ${slo.p95Ms}ms`);
    }

    if (slo.p99Ms !== undefined && summary.responseTimePercentiles.p99 > slo.p99Ms) {
      failures.push(`p99 ${summary.responseTimePercentiles.p99.toFixed(2)}ms > ${slo.p99Ms}ms`);
    }

    if (slo.minRequestsPerSecond !== undefined && summary.overallRequestsPerSecond < slo.minRequestsPerSecond) {
      failures.push(`requestsPerSecond ${summary.overallRequestsPerSecond.toFixed(2)} < ${slo.minRequestsPerSecond}`);
    }

    return {
      passed: failures.length === 0,
      failures
    };
  }

  private buildDiagnosticsSummary(results: EndpointResult[], config: DiagnosticsConfig): DiagnosticsSummary {
    return buildDiagnosticsSummaryUtil(results, config, DEFAULT_MASK_KEYS);
  }

  private buildTransactionGroupResults(
    groups: TransactionGroupConfig[],
    endpointResults: EndpointResult[],
    totalDurationMs: number,
    coSettings: { enabled: boolean; expectedIntervalMs?: number }
  ): TransactionGroupResult[] {
    return buildTransactionGroupResultsUtil(groups, endpointResults, totalDurationMs, coSettings);
  }

  /**
   * Saves benchmark results to JSON, CSV, and HTML files.
   * @param results BenchmarkResult object.
   * @param jsonPath Path to save JSON file.
   * @param csvPath Path to save CSV file.
   * @param htmlPath Optional path to save HTML file.
   */
  async saveResults(results: BenchmarkResult, jsonPath: string, csvPath: string, htmlPath?: string): Promise<void> {
    const outputs: ReporterOutputConfig[] = [
      { type: 'json', path: jsonPath },
      { type: 'csv', path: csvPath }
    ];

    if (htmlPath) {
      outputs.push({ type: 'html', path: htmlPath });
    }

    await this.saveWithReporters(results, outputs);
  }

  /**
   * Saves benchmark results with pluggable reporters.
   */
  async saveWithReporters(results: BenchmarkResult, outputs: ReporterOutputConfig[]): Promise<void> {
    for (const output of outputs) {
      const type = output.type.trim().toLowerCase();

      if (!type) {
        throw new Error('Reporter type must be a non-empty string');
      }

      if (type === 'json') {
        if (!output.path) {
          throw new Error('JSON reporter requires a path');
        }
        await this.platform.saveResults(results, output.path, undefined, undefined);
        continue;
      }

      if (type === 'csv') {
        if (!output.path) {
          throw new Error('CSV reporter requires a path');
        }
        await this.platform.saveResults(results, undefined, output.path, undefined);
        continue;
      }

      if (type === 'html') {
        if (!output.path) {
          throw new Error('HTML reporter requires a path');
        }
        const html = generateHtmlReport(results);
        await this.platform.saveHtmlReport(html, output.path);
        results.htmlPath = output.path;
        continue;
      }

      if (type === 'junit') {
        if (!output.path) {
          throw new Error('JUnit reporter requires a path');
        }
        const xml = generateJunitReport(results);
        await this.savePlainTextFile(xml, output.path);
        continue;
      }

      const customReporter = this.reporters.get(type);
      if (!customReporter) {
        throw new Error(`Unknown reporter type: ${output.type}`);
      }

      await customReporter(results, output, {
        platform: this.platform,
        generateHtmlReport: () => generateHtmlReport(results),
        generateJunitReport: () => generateJunitReport(results)
      });
    }
  }

  private async savePlainTextFile(content: string, outputPath: string): Promise<void> {
    if (this.platform.name !== 'node') {
      throw new Error('junit reporter is currently supported only on the node platform');
    }

    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(outputPath, content, 'utf8');
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

export { NodePlatform } from './platform/node-platform';
export { BrowserPlatform } from './platform/browser-platform';
export { ObservabilityManager } from './observability/observability';
export { DistributedCoordinator, mergeDistributedResults } from './distributed/distributed';
export * from './types';

