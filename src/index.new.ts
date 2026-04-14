import axios from 'axios';
import chalk from 'chalk';
import { ProgressTracker } from './platform/progress';
import { NodePlatform } from './platform/node-platform';

import {
  BenchmarkConfig,
  BenchmarkResult,
  EndpointConfig,
  EndpointResult,
  BenchmarkSummary,
  ConfigValidator,
  GlockitOptions,
  AuthDependencyConfig,
  Platform,
  DataFeederConfig,
  ReporterOutputConfig,
  BenchmarkReporter,
  DistributedConfig,
  TransactionGroupConfig,
  DiagnosticsConfig
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
import { loadDataFeederRows } from './runtime/data-feeder';
import {
  resolveCoordinatedOmissionSettings as resolveCoordinatedOmissionSettingsUtil,
  selectWeightedScenario as selectWeightedScenarioUtil
} from './runtime/traffic';
import {
  createVirtualUserSession as createVirtualUserSessionUtil,
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

import { evaluateSlo } from './core/slo-evaluator';
import { sleep, extractVariables } from './core/variable-engine';
import { RequestContext, handleAuthDependency, makeRequest } from './core/request-executor';
import { BenchmarkContext, applyNextDataFeederRow, benchmarkEndpoint } from './core/endpoint-runner';

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

  private createRequestContext(): RequestContext {
    return {
      axiosInstance: this.axiosInstance,
      platform: this.platform,
      progressTracker: this.progressTracker,
      options: this.options,
      variables: this.variables,
      authVariablesMap: this.authVariablesMap
    };
  }

  private createBenchmarkContext(): BenchmarkContext {
    return {
      ...this.createRequestContext(),
      dataFeedRows: this.dataFeedRows,
      dataFeederIndex: this.dataFeederIndex,
      dataFeederStrategy: this.dataFeederStrategy
    };
  }

  /**
   * Runs the benchmark for the provided configuration.
   */
  async run(config: BenchmarkConfig, enableProgress?: boolean): Promise<BenchmarkResult> {
    const showProgress = enableProgress !== undefined ? enableProgress : this.options.progress;
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

    const processedEndpoints = this.resolveDependencies(validatedConfig.endpoints);

    this.variables.clear();
    this.initializeDataFeeder(validatedConfig.global?.dataFeeder);

    const totalWeight = processedEndpoints.reduce((sum, e) => sum + (e.weight || 0), 0);
    const useWeights = totalWeight > 0;

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

    // Create context after tracker & data feeder are initialized
    const ctx = this.createBenchmarkContext();

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
          if (endpoint.auth) {
            const authName = endpoint.auth.name;
            if (!ctx.authVariablesMap.has(authName)) {
              await handleAuthDependency(ctx, endpoint.auth, validatedConfig.global);
            }

            const authVars = ctx.authVariablesMap.get(authName);
            if (authVars) {
              authVars.forEach((val, key) => ctx.variables.set(key, val));
            }
          }

          let maxRequestsOverride = endpoint.maxRequests;
          if (useWeights && endpoint.weight) {
            const globalMax = validatedConfig.global?.maxRequests || 0;
            if (globalMax > 0) {
              maxRequestsOverride = Math.round((endpoint.weight / totalWeight) * globalMax);
            }
          }

          const endpointResult = await benchmarkEndpoint(ctx, endpoint, {
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

      const coSettings = resolveCoordinatedOmissionSettingsUtil(validatedConfig.global, validatedConfig.global?.arrivalRate);
      let responseTimesForPercentiles = globalResponseTimes;

      if (coSettings.enabled && coSettings.expectedIntervalMs !== undefined) {
        const corrected = applyCoordinatedOmissionCorrectionUtil(globalResponseTimes, coSettings.expectedIntervalMs);
        responseTimesForPercentiles = corrected.values;
        summary.coordinatedOmission = {
          enabled: true,
          expectedIntervalMs: coSettings.expectedIntervalMs,
          appliedSamples: corrected.addedSamples
        };
      }

      summary.responseTimePercentiles = calculatePercentilesUtil(responseTimesForPercentiles);
    }

    if (validatedConfig.global?.slo) {
      summary.slo = evaluateSlo(summary, validatedConfig.global.slo);
    }

    if (validatedConfig.global?.transactionGroups?.length) {
      const coSettings = resolveCoordinatedOmissionSettingsUtil(validatedConfig.global, validatedConfig.global?.arrivalRate);
      summary.transactionGroups = buildTransactionGroupResultsUtil(
        validatedConfig.global.transactionGroups,
        results,
        totalDuration,
        coSettings
      );
    }

    if (validatedConfig.global?.diagnostics?.enabled) {
      summary.diagnostics = buildDiagnosticsSummaryUtil(results, validatedConfig.global.diagnostics, DEFAULT_MASK_KEYS);
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
      sleep
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
            sleep,
            log: this.platform.log.bind(this.platform)
          });

          continue;
        }

        if (this.platform.now() - start > joinTimeoutMs) {
          throw new Error('Timed out waiting for distributed worker plan from coordinator');
        }

        await sleep(pollIntervalMs);
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

    const ctx = this.createBenchmarkContext();

    return runScenarioMix(endpoints, globalConfig, {
      now: () => ctx.platform.now(),
      resolveVirtualUserConfig: resolveVirtualUserConfigUtil,
      createVirtualUserSession: (id: string) => createVirtualUserSessionUtil(id, ctx.variables),
      selectWeightedScenario: selectWeightedScenarioUtil,
      handleAuthDependency: (auth: AuthDependencyConfig, gc: any) => handleAuthDependency(ctx, auth, gc),
      authVariablesMap: ctx.authVariablesMap,
      sharedVariables: ctx.variables,
      applyNextDataFeederRow: (scope?: Map<string, any>) => applyNextDataFeederRow(ctx, scope),
      makeRequest: (ep: EndpointConfig, timeout: number, baseUrl?: string, session?: VirtualUserSession, vuConfig?: any, diag?: DiagnosticsConfig) =>
        makeRequest(ctx, ep, timeout, baseUrl, session, vuConfig, diag),
      extractVariables: (extr: any, data: any, headers: any, scope?: Map<string, any>) =>
        extractVariables(extr, data, headers, scope ?? ctx.variables),
      resolveCoordinatedOmissionSettings: resolveCoordinatedOmissionSettingsUtil,
      applyCoordinatedOmissionCorrection: applyCoordinatedOmissionCorrectionUtil,
      calculatePercentiles: calculatePercentilesUtil,
      onProgress: (endpointName: string, completed: number, total: number, scenarioName: string) => {
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

  /**
   * Saves benchmark results to JSON, CSV, and HTML files.
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
        if (!output.path) throw new Error('JSON reporter requires a path');
        await this.platform.saveResults(results, output.path, undefined, undefined);
        continue;
      }

      if (type === 'csv') {
        if (!output.path) throw new Error('CSV reporter requires a path');
        await this.platform.saveResults(results, undefined, output.path, undefined);
        continue;
      }

      if (type === 'html') {
        if (!output.path) throw new Error('HTML reporter requires a path');
        const html = generateHtmlReport(results);
        await this.platform.saveHtmlReport(html, output.path);
        results.htmlPath = output.path;
        continue;
      }

      if (type === 'junit') {
        if (!output.path) throw new Error('JUnit reporter requires a path');
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
}

export { NodePlatform } from './platform/node-platform';
export { BrowserPlatform } from './platform/browser-platform';
export { ObservabilityManager } from './observability/observability';
export { DistributedCoordinator, mergeDistributedResults } from './distributed/distributed';
export * from './types';
