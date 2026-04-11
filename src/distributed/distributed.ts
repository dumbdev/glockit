import express from 'express';
import cors from 'cors';
import { BenchmarkConfig, BenchmarkResult, DistributedConfig, EndpointResult, Platform, ResponseTimePercentiles } from '../types';

interface WorkerPlan {
  ready: boolean;
  done?: boolean;
  assignedEndpoints?: string[];
  config?: BenchmarkConfig;
}

export class DistributedCoordinator {
  private readonly app = express();
  private server?: import('node:http').Server;
  private coordinatorUrl?: string;
  private readonly joinedWorkers: string[] = [];
  private readonly workerResults: BenchmarkResult[] = [];
  private readonly pendingEndpoints: string[] = [];
  private readonly activeAssignments = new Map<string, string[]>();
  private readonly completedEndpoints = new Set<string>();
  private readonly workerLastSeen = new Map<string, number>();
  private readonly staleWorkers = new Set<string>();
  private readonly workerCompletedCounts = new Map<string, number>();
  private nextRoundRobinIndex = 0;
  private planPrepared = false;

  constructor(
    private readonly config: DistributedConfig,
    private readonly benchmarkConfig: BenchmarkConfig,
    private readonly platform: Platform
  ) {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use((req, res, next) => {
      if (!this.config.authToken) {
        next();
        return;
      }

      const headerName = (this.config.authHeaderName || 'x-glockit-token').toLowerCase();
      const incoming = req.headers[headerName];
      const token = Array.isArray(incoming) ? incoming[0] : incoming;

      if (typeof token !== 'string' || token !== this.config.authToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      next();
    });
    this.registerRoutes();
  }

  public async run(): Promise<BenchmarkResult> {
    await this.startServer();

    try {
      await this.waitForWorkers();
      this.prepareAssignments();
      await this.waitForResults();

      const merged = mergeDistributedResults(this.benchmarkConfig, this.workerResults);
      merged.distributed = {
        role: 'coordinator',
        coordinatorUrl: this.coordinatorUrl,
        workersTotal: this.config.expectedWorkers,
        workersCompleted: this.completedEndpoints.size,
        staleWorkers: Array.from(this.staleWorkers),
        workerCompletedLeaseCounts: this.getWorkerCompletedLeaseCounts()
      };
      return merged;
    } finally {
      await this.stopServer();
    }
  }

  public getCoordinatorUrl(): string | undefined {
    return this.coordinatorUrl;
  }

  private registerRoutes(): void {
    this.app.post('/join', (req, res) => {
      const workerId = typeof req.body?.workerId === 'string' ? req.body.workerId.trim() : '';
      if (!workerId) {
        res.status(400).json({ error: 'workerId is required' });
        return;
      }

      if (!this.joinedWorkers.includes(workerId)) {
        this.joinedWorkers.push(workerId);
      }
      if (!this.workerCompletedCounts.has(workerId)) {
        this.workerCompletedCounts.set(workerId, 0);
      }
      this.markWorkerSeen(workerId);
      this.staleWorkers.delete(workerId);

      res.json({ ok: true, workers: this.joinedWorkers.length });
    });

    this.app.post('/heartbeat', (req, res) => {
      const workerId = typeof req.body?.workerId === 'string' ? req.body.workerId.trim() : '';
      if (!workerId || !this.joinedWorkers.includes(workerId)) {
        res.status(404).json({ error: 'worker not registered' });
        return;
      }

      this.markWorkerSeen(workerId);
      this.staleWorkers.delete(workerId);
      res.json({ ok: true, workerId, ts: Date.now() });
    });

    this.app.get('/plan/:workerId', (req, res) => {
      const workerId = req.params.workerId;
      if (!workerId || !this.joinedWorkers.includes(workerId)) {
        res.status(404).json({ error: 'worker not registered' });
        return;
      }

      this.markWorkerSeen(workerId);

      if (!this.planPrepared) {
        const waitingPlan: WorkerPlan = { ready: false };
        res.json(waitingPlan);
        return;
      }

      const alreadyAssigned = this.activeAssignments.get(workerId);
      let assignedEndpoints = alreadyAssigned && alreadyAssigned.length > 0
        ? alreadyAssigned
        : [];

      if (assignedEndpoints.length === 0) {
        const selectedWorker = this.selectWorkerForNextLease();
        if (!selectedWorker || selectedWorker !== workerId) {
          const waitingPlan: WorkerPlan = { ready: false };
          res.json(waitingPlan);
          return;
        }

        assignedEndpoints = this.allocateEndpointsToWorker(workerId);
      }

      if (assignedEndpoints.length === 0) {
        const donePlan: WorkerPlan = {
          ready: true,
          done: this.isAllWorkCompleted()
        };
        res.json(donePlan);
        return;
      }

      const assignedConfig = this.buildWorkerConfig(assignedEndpoints);
      const plan: WorkerPlan = {
        ready: true,
        done: false,
        assignedEndpoints,
        config: assignedConfig
      };
      res.json(plan);
    });

    this.app.post('/result', (req, res) => {
      const workerId = typeof req.body?.workerId === 'string' ? req.body.workerId.trim() : '';
      const result = req.body?.result as BenchmarkResult | undefined;

      if (!workerId || !this.joinedWorkers.includes(workerId)) {
        res.status(400).json({ error: 'unknown workerId' });
        return;
      }

      this.markWorkerSeen(workerId);

      if (!result || typeof result !== 'object') {
        res.status(400).json({ error: 'result is required' });
        return;
      }

      this.acceptWorkerResult(workerId, result);
      res.json({ ok: true, received: this.workerResults.length });
    });

    this.app.get('/status', (_req, res) => {
      res.json({
        workersJoined: this.joinedWorkers.length,
        workersExpected: this.config.expectedWorkers,
        workersCompleted: this.completedEndpoints.size,
        planPrepared: this.planPrepared,
        staleWorkers: Array.from(this.staleWorkers),
        workerCompletedLeaseCounts: this.getWorkerCompletedLeaseCounts(),
        pendingEndpoints: this.pendingEndpoints.length,
        activeAssignments: Array.from(this.activeAssignments.values()).reduce((sum, names) => sum + names.length, 0)
      });
    });
  }

  private async startServer(): Promise<void> {
    const host = this.config.host || '127.0.0.1';
    const port = this.config.port ?? 9876;

    await new Promise<void>((resolve, reject) => {
      this.server = this.app.listen(port, host, () => resolve());
      this.server.once('error', reject);
    });

    const server = this.server;
    if (!server) {
      throw new Error('Failed to initialize distributed coordinator server');
    }

    const address = server.address();
    if (address && typeof address === 'object') {
      const normalizedHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      this.coordinatorUrl = `http://${normalizedHost}:${address.port}`;
      this.platform.log(`🌐 Distributed coordinator listening at ${this.coordinatorUrl}`);
    }
  }

  private async stopServer(): Promise<void> {
    if (!this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
  }

  private async waitForWorkers(): Promise<void> {
    const expectedWorkers = this.config.expectedWorkers || 1;
    const joinTimeoutMs = this.config.joinTimeoutMs ?? 60000;
    const start = this.platform.now();

    while (this.joinedWorkers.length < expectedWorkers) {
      this.pruneStaleWorkers();
      if (this.platform.now() - start > joinTimeoutMs) {
        throw new Error(`Timed out waiting for workers to join (${this.joinedWorkers.length}/${expectedWorkers})`);
      }
      await sleep(200);
    }

    this.platform.log(`🤝 All workers joined (${this.joinedWorkers.length}/${expectedWorkers})`);
  }

  private prepareAssignments(): void {
    this.pendingEndpoints.length = 0;
    this.pendingEndpoints.push(...this.benchmarkConfig.endpoints.map(endpoint => endpoint.name));

    this.planPrepared = true;
  }

  private async waitForResults(): Promise<void> {
    const resultTimeoutMs = this.config.resultTimeoutMs ?? 300000;
    const start = this.platform.now();

    while (!this.isAllWorkCompleted()) {
      this.pruneStaleWorkers();

      if (this.platform.now() - start > resultTimeoutMs) {
        throw new Error(`Timed out waiting for worker results (completed=${this.completedEndpoints.size}, pending=${this.pendingEndpoints.length})`);
      }
      await sleep(250);
    }
  }

  private isAllWorkCompleted(): boolean {
    if (this.pendingEndpoints.length > 0) {
      return false;
    }

    for (const endpoints of this.activeAssignments.values()) {
      if (endpoints.length > 0) {
        return false;
      }
    }

    return true;
  }

  private allocateEndpointsToWorker(workerId: string): string[] {
    if (this.pendingEndpoints.length === 0) {
      return [];
    }

    const maxBatch = this.getWorkerLeaseLimit();
    const assigned: string[] = [];
    while (assigned.length < maxBatch && this.pendingEndpoints.length > 0) {
      assigned.push(this.pendingEndpoints.shift()!);
    }

    this.activeAssignments.set(workerId, assigned);
    return assigned;
  }

  private acceptWorkerResult(workerId: string, result: BenchmarkResult): void {
    this.workerResults.push(result);

    const reportedNames = new Set(result.results.map(endpoint => endpoint.name));
    const assigned = this.activeAssignments.get(workerId) || [];

    for (const endpointName of assigned) {
      if (reportedNames.has(endpointName)) {
        this.completedEndpoints.add(endpointName);
        const previousCount = this.workerCompletedCounts.get(workerId) ?? 0;
        this.workerCompletedCounts.set(workerId, previousCount + 1);
      } else {
        this.pendingEndpoints.push(endpointName);
      }
    }

    this.activeAssignments.delete(workerId);
  }

  private markWorkerSeen(workerId: string): void {
    this.workerLastSeen.set(workerId, this.platform.now());
  }

  private pruneStaleWorkers(): void {
    const staleTimeoutMs = this.config.staleWorkerTimeoutMs;
    if (!staleTimeoutMs) {
      return;
    }

    const now = this.platform.now();
    const activeWorkers = [...this.joinedWorkers];
    for (const workerId of activeWorkers) {
      const lastSeen = this.workerLastSeen.get(workerId) ?? 0;
      if (now - lastSeen <= staleTimeoutMs) {
        continue;
      }

      this.staleWorkers.add(workerId);

      const assigned = this.activeAssignments.get(workerId) || [];
      for (const endpointName of assigned) {
        if (!this.completedEndpoints.has(endpointName)) {
          this.pendingEndpoints.push(endpointName);
        }
      }

      this.activeAssignments.delete(workerId);
      this.workerCompletedCounts.delete(workerId);
      this.workerLastSeen.delete(workerId);
      this.joinedWorkers.splice(this.joinedWorkers.indexOf(workerId), 1);
      this.platform.log(`⚠️ Marked worker as stale: ${workerId}`);
    }
  }

  private selectWorkerForNextLease(): string | undefined {
    const liveWorkers = this.joinedWorkers.filter(workerId => !this.staleWorkers.has(workerId));
    if (liveWorkers.length === 0) {
      return undefined;
    }

    const strategy = this.config.assignmentStrategy || 'round-robin';
    if (strategy === 'least-loaded') {
      return this.selectLeastLoadedIdleWorker(liveWorkers);
    }

    const idleWorkers = liveWorkers.filter(workerId => (this.activeAssignments.get(workerId)?.length ?? 0) === 0);
    if (idleWorkers.length === 0) {
      return undefined;
    }

    if (this.nextRoundRobinIndex >= idleWorkers.length) {
      this.nextRoundRobinIndex = 0;
    }

    const selected = idleWorkers[this.nextRoundRobinIndex];
    this.nextRoundRobinIndex = (this.nextRoundRobinIndex + 1) % idleWorkers.length;
    return selected;
  }

  private selectLeastLoadedWorker(workers: string[]): string {
    const ranked = [...workers].sort((a, b) => {
      const loadA = this.workerCompletedCounts.get(a) ?? 0;
      const loadB = this.workerCompletedCounts.get(b) ?? 0;

      if (loadA === loadB) {
        return a.localeCompare(b);
      }
      return loadA - loadB;
    });

    return ranked[0];
  }

  private selectLeastLoadedIdleWorker(workers: string[]): string | undefined {
    let minCompleted = Number.MAX_SAFE_INTEGER;
    for (const workerId of workers) {
      const completed = this.workerCompletedCounts.get(workerId) ?? 0;
      if (completed < minCompleted) {
        minCompleted = completed;
      }
    }

    const leastCompletedWorkers = workers.filter(workerId => (this.workerCompletedCounts.get(workerId) ?? 0) === minCompleted);
    const idleLeastCompletedWorkers = leastCompletedWorkers.filter(workerId => (this.activeAssignments.get(workerId)?.length ?? 0) === 0);
    if (idleLeastCompletedWorkers.length === 0) {
      return undefined;
    }

    return this.selectLeastLoadedWorker(idleLeastCompletedWorkers);
  }

  private getWorkerLeaseLimit(): number {
    const leaseBatchSize = Math.max(1, this.config.leaseBatchSize ?? 1);
    const maxInFlight = this.config.maxInFlightLeasedEndpointsPerWorker;

    if (maxInFlight === undefined) {
      return leaseBatchSize;
    }

    return Math.max(1, Math.min(leaseBatchSize, maxInFlight));
  }

  private getWorkerCompletedLeaseCounts(): Record<string, number> {
    return Object.fromEntries(
      [...this.workerCompletedCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    );
  }

  private buildWorkerConfig(endpointNames: string[]): BenchmarkConfig {
    const endpointSet = new Set(endpointNames);
    return {
      ...this.benchmarkConfig,
      global: {
        ...(this.benchmarkConfig.global || {}),
        distributed: undefined
      },
      endpoints: this.benchmarkConfig.endpoints.filter(endpoint => endpointSet.has(endpoint.name))
    };
  }
}

export function mergeDistributedResults(config: BenchmarkConfig, workerResults: BenchmarkResult[]): BenchmarkResult {
  const endpointResults: EndpointResult[] = workerResults.flatMap(result => result.results || []);

  const totalDuration = workerResults.length > 0
    ? Math.max(...workerResults.map(result => result.summary.totalDuration || 0))
    : 0;

  const totalRequests = endpointResults.reduce((sum, endpoint) => sum + endpoint.totalRequests, 0);
  const totalSuccessful = endpointResults.reduce((sum, endpoint) => sum + endpoint.successfulRequests, 0);
  const totalFailed = endpointResults.reduce((sum, endpoint) => sum + endpoint.failedRequests, 0);

  const weightedAvg = totalRequests > 0
    ? endpointResults.reduce((sum, endpoint) => sum + (endpoint.averageResponseTime * endpoint.totalRequests), 0) / totalRequests
    : 0;

  const responseTimes = endpointResults.flatMap(endpoint =>
    endpoint.requestResults.filter(request => request.success).map(request => request.responseTime)
  );

  const summary = {
    totalDuration,
    totalRequests,
    totalSuccessful,
    totalFailed,
    overallRequestsPerSecond: totalDuration > 0 ? totalRequests / (totalDuration / 1000) : 0,
    averageResponseTime: weightedAvg,
    responseTimePercentiles: calculatePercentiles(responseTimes),
    errorRate: totalRequests > 0 ? totalFailed / totalRequests : 0
  };

  return {
    config,
    results: endpointResults,
    summary,
    timestamp: new Date().toISOString()
  };
}

function calculatePercentiles(values: number[]): ResponseTimePercentiles {
  if (!values.length) {
    return { p50: 0, p90: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const getValue = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const safeIndex = Math.min(sorted.length - 1, Math.max(0, index));
    return sorted[safeIndex];
  };

  return {
    p50: getValue(50),
    p90: getValue(90),
    p95: getValue(95),
    p99: getValue(99)
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
