import { ConfigValidationError, ConfigValidator } from '../types';
import { DistributedCoordinator, mergeDistributedResults } from '../distributed/distributed';
import axios from 'axios';

describe('distributed regression coverage', () => {
  test('rejects distributed worker without coordinatorUrl', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'worker'
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.coordinatorUrl is required when distributed.role is "worker"');
  });

  test('rejects distributed auth header name when empty', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          authToken: 'abc123',
          authHeaderName: ''
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.authHeaderName must be a non-empty string when provided');
  });

  test('rejects distributed negative resultSubmitRetries', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          resultSubmitRetries: -1
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.resultSubmitRetries must be a non-negative integer when provided');
  });

  test('rejects distributed heartbeatIntervalMs when non-positive', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          heartbeatIntervalMs: 0
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.heartbeatIntervalMs must be a positive integer when provided');
  });

  test('rejects distributed staleWorkerTimeoutMs when non-positive', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          staleWorkerTimeoutMs: 0
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.staleWorkerTimeoutMs must be a positive integer when provided');
  });

  test('rejects distributed leaseBatchSize when non-positive', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          leaseBatchSize: 0
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.leaseBatchSize must be a positive integer when provided');
  });

  test('rejects distributed maxInFlightLeasedEndpointsPerWorker when non-positive', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          maxInFlightLeasedEndpointsPerWorker: 0
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.maxInFlightLeasedEndpointsPerWorker must be a positive integer when provided');
  });

  test('rejects distributed assignmentStrategy when invalid', () => {
    const config = {
      global: {
        distributed: {
          enabled: true,
          role: 'coordinator',
          expectedWorkers: 1,
          assignmentStrategy: 'invalid'
        }
      },
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global distributed.assignmentStrategy must be either "round-robin" or "least-loaded" when provided');
  });

  test('leases multiple endpoints per worker plan when leaseBatchSize is set', async () => {
    const benchmarkConfig = ConfigValidator.validate({
      global: { maxRequests: 1 },
      endpoints: [
        { name: 'a', url: 'https://example.com/a', method: 'GET' },
        { name: 'b', url: 'https://example.com/b', method: 'GET' },
        { name: 'c', url: 'https://example.com/c', method: 'GET' }
      ]
    } as any);

    const distributedConfig = {
      enabled: true,
      role: 'coordinator',
      expectedWorkers: 1,
      host: '127.0.0.1',
      port: 0,
      joinTimeoutMs: 2000,
      resultTimeoutMs: 5000,
      leaseBatchSize: 2
    } as any;

    const platform = {
      name: 'node',
      now: () => Date.now(),
      log: () => {},
      error: () => {}
    } as any;

    const coordinator = new DistributedCoordinator(distributedConfig, benchmarkConfig, platform);
    const runPromise = coordinator.run();

    let coordinatorUrl: string | undefined;
    for (let i = 0; i < 20; i++) {
      coordinatorUrl = coordinator.getCoordinatorUrl();
      if (coordinatorUrl) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    if (!coordinatorUrl) {
      throw new Error('coordinator URL was not initialized');
    }

    await axios.post(`${coordinatorUrl}/join`, { workerId: 'w1' });

    const waitForAssignedPlan = async () => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const plan = await axios.get(`${coordinatorUrl}/plan/w1`);
        if (plan.data?.ready && Array.isArray(plan.data.assignedEndpoints) && plan.data.assignedEndpoints.length > 0) {
          return plan;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out waiting for assigned plan');
    };

    const firstPlan = await waitForAssignedPlan();
    expect(firstPlan.data.assignedEndpoints).toHaveLength(2);

    const buildResult = (endpointNames: string[]) => ({
      config: { endpoints: [] },
      results: endpointNames.map((endpointName: string) => ({
        name: endpointName,
        url: `/${endpointName}`,
        method: 'GET',
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
        successRate: 1,
        averageResponseTime: 10,
        minResponseTime: 10,
        maxResponseTime: 10,
        requestsPerSecond: 1,
        errors: [],
        requestResults: [{ success: true, responseTime: 10 }],
        totalRequestSizeKB: 0,
        averageRequestSizeKB: 0,
        totalResponseSizeKB: 0,
        averageResponseSizeKB: 0,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 }
      })),
      summary: {
        totalDuration: 1000,
        totalRequests: endpointNames.length,
        totalSuccessful: endpointNames.length,
        totalFailed: 0,
        overallRequestsPerSecond: endpointNames.length,
        averageResponseTime: 10,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 },
        errorRate: 0
      },
      timestamp: new Date().toISOString()
    });

    await axios.post(`${coordinatorUrl}/result`, {
      workerId: 'w1',
      result: buildResult(firstPlan.data.assignedEndpoints)
    });

    const secondPlan = await waitForAssignedPlan();
    expect(secondPlan.data.assignedEndpoints).toHaveLength(1);

    await axios.post(`${coordinatorUrl}/result`, {
      workerId: 'w1',
      result: buildResult(secondPlan.data.assignedEndpoints)
    });

    const merged = await runPromise;
    expect(merged.summary.totalRequests).toBe(3);
    expect(merged.results.map(r => r.name).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.distributed?.workerCompletedLeaseCounts).toEqual({ w1: 3 });
  }, 15000);

  test('caps in-flight leases per worker and reports completed lease counts in status', async () => {
    const benchmarkConfig = ConfigValidator.validate({
      global: { maxRequests: 1 },
      endpoints: [
        { name: 'a', url: 'https://example.com/a', method: 'GET' },
        { name: 'b', url: 'https://example.com/b', method: 'GET' },
        { name: 'c', url: 'https://example.com/c', method: 'GET' }
      ]
    } as any);

    const distributedConfig = {
      enabled: true,
      role: 'coordinator',
      expectedWorkers: 1,
      host: '127.0.0.1',
      port: 0,
      joinTimeoutMs: 2000,
      resultTimeoutMs: 5000,
      leaseBatchSize: 3,
      maxInFlightLeasedEndpointsPerWorker: 2
    } as any;

    const platform = {
      name: 'node',
      now: () => Date.now(),
      log: () => {},
      error: () => {}
    } as any;

    const coordinator = new DistributedCoordinator(distributedConfig, benchmarkConfig, platform);
    const runPromise = coordinator.run();

    let coordinatorUrl: string | undefined;
    for (let i = 0; i < 20; i++) {
      coordinatorUrl = coordinator.getCoordinatorUrl();
      if (coordinatorUrl) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    if (!coordinatorUrl) {
      throw new Error('coordinator URL was not initialized');
    }

    await axios.post(`${coordinatorUrl}/join`, { workerId: 'w1' });

    const waitForAssignedPlan = async () => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const plan = await axios.get(`${coordinatorUrl}/plan/w1`);
        if (plan.data?.ready && Array.isArray(plan.data.assignedEndpoints) && plan.data.assignedEndpoints.length > 0) {
          return plan;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Timed out waiting for assigned plan');
    };

    const buildResult = (endpointNames: string[]) => ({
      config: { endpoints: [] },
      results: endpointNames.map((endpointName: string) => ({
        name: endpointName,
        url: `/${endpointName}`,
        method: 'GET',
        totalRequests: 1,
        successfulRequests: 1,
        failedRequests: 0,
        successRate: 1,
        averageResponseTime: 10,
        minResponseTime: 10,
        maxResponseTime: 10,
        requestsPerSecond: 1,
        errors: [],
        requestResults: [{ success: true, responseTime: 10 }],
        totalRequestSizeKB: 0,
        averageRequestSizeKB: 0,
        totalResponseSizeKB: 0,
        averageResponseSizeKB: 0,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 }
      })),
      summary: {
        totalDuration: 1000,
        totalRequests: endpointNames.length,
        totalSuccessful: endpointNames.length,
        totalFailed: 0,
        overallRequestsPerSecond: endpointNames.length,
        averageResponseTime: 10,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 },
        errorRate: 0
      },
      timestamp: new Date().toISOString()
    });

    const firstPlan = await waitForAssignedPlan();
    expect(firstPlan.data.assignedEndpoints).toHaveLength(2);

    const firstStatus = await axios.get(`${coordinatorUrl}/status`);
    expect(firstStatus.data.workerCompletedLeaseCounts).toEqual({ w1: 0 });

    await axios.post(`${coordinatorUrl}/result`, {
      workerId: 'w1',
      result: buildResult(firstPlan.data.assignedEndpoints)
    });

    const secondStatus = await axios.get(`${coordinatorUrl}/status`);
    expect(secondStatus.data.workerCompletedLeaseCounts).toEqual({ w1: 2 });

    const secondPlan = await waitForAssignedPlan();
    expect(secondPlan.data.assignedEndpoints).toHaveLength(1);

    await axios.post(`${coordinatorUrl}/result`, {
      workerId: 'w1',
      result: buildResult(secondPlan.data.assignedEndpoints)
    });

    const merged = await runPromise;
    expect(merged.summary.totalRequests).toBe(3);
    expect(merged.results.map(r => r.name).sort()).toEqual(['a', 'b', 'c']);
  }, 15000);

  test('least-loaded assignment holds faster worker until slower worker catches up', async () => {
    const benchmarkConfig = ConfigValidator.validate({
      global: { maxRequests: 1 },
      endpoints: [
        { name: 'a', url: 'https://example.com/a', method: 'GET' },
        { name: 'b', url: 'https://example.com/b', method: 'GET' },
        { name: 'c', url: 'https://example.com/c', method: 'GET' }
      ]
    } as any);

    const distributedConfig = {
      enabled: true,
      role: 'coordinator',
      expectedWorkers: 2,
      host: '127.0.0.1',
      port: 0,
      joinTimeoutMs: 2000,
      resultTimeoutMs: 5000,
      assignmentStrategy: 'least-loaded'
    } as any;

    const platform = {
      name: 'node',
      now: () => Date.now(),
      log: () => {},
      error: () => {}
    } as any;

    const coordinator = new DistributedCoordinator(distributedConfig, benchmarkConfig, platform);
    const runPromise = coordinator.run();

    let coordinatorUrl: string | undefined;
    for (let i = 0; i < 20; i++) {
      coordinatorUrl = coordinator.getCoordinatorUrl();
      if (coordinatorUrl) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    if (!coordinatorUrl) {
      throw new Error('coordinator URL was not initialized');
    }

    await axios.post(`${coordinatorUrl}/join`, { workerId: 'w1' });
    await axios.post(`${coordinatorUrl}/join`, { workerId: 'w2' });

    const waitForAssignedPlan = async (workerId: string) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const plan = await axios.get(`${coordinatorUrl}/plan/${workerId}`);
        if (plan.data?.ready && Array.isArray(plan.data.assignedEndpoints) && plan.data.assignedEndpoints.length > 0) {
          return plan;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for assigned plan for ${workerId}`);
    };

    const buildResult = (endpointName: string) => ({
      config: { endpoints: [] },
      results: [
        {
          name: endpointName,
          url: `/${endpointName}`,
          method: 'GET',
          totalRequests: 1,
          successfulRequests: 1,
          failedRequests: 0,
          successRate: 1,
          averageResponseTime: 10,
          minResponseTime: 10,
          maxResponseTime: 10,
          requestsPerSecond: 1,
          errors: [],
          requestResults: [{ success: true, responseTime: 10 }],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 }
        }
      ],
      summary: {
        totalDuration: 1000,
        totalRequests: 1,
        totalSuccessful: 1,
        totalFailed: 0,
        overallRequestsPerSecond: 1,
        averageResponseTime: 10,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 },
        errorRate: 0
      },
      timestamp: new Date().toISOString()
    });

    const w1Plan = await waitForAssignedPlan('w1');
    const w2Plan = await waitForAssignedPlan('w2');
    const w1First = w1Plan.data.assignedEndpoints[0];
    const w2First = w2Plan.data.assignedEndpoints[0];

    await axios.post(`${coordinatorUrl}/result`, { workerId: 'w1', result: buildResult(w1First) });

    const fastWorkerPoll = await axios.get(`${coordinatorUrl}/plan/w1`);
    expect(fastWorkerPoll.data.ready).toBe(false);

    await axios.post(`${coordinatorUrl}/result`, { workerId: 'w2', result: buildResult(w2First) });

    const w1SecondPlan = await waitForAssignedPlan('w1');
    const w1Second = w1SecondPlan.data.assignedEndpoints[0];
    expect([w1First, w2First]).not.toContain(w1Second);

    await axios.post(`${coordinatorUrl}/result`, { workerId: 'w1', result: buildResult(w1Second) });

    const merged = await runPromise;
    expect(merged.summary.totalRequests).toBe(3);
    expect(merged.results.map(r => r.name).sort()).toEqual(['a', 'b', 'c']);
  }, 15000);

  test('reassigns stale worker endpoints to active workers', async () => {
    const benchmarkConfig = ConfigValidator.validate({
      global: {
        maxRequests: 1
      },
      endpoints: [
        {
          name: 'a',
          url: 'https://example.com/a',
          method: 'GET'
        },
        {
          name: 'b',
          url: 'https://example.com/b',
          method: 'GET'
        }
      ]
    } as any);

    const distributedConfig = {
      enabled: true,
      role: 'coordinator',
      expectedWorkers: 2,
      host: '127.0.0.1',
      port: 0,
      joinTimeoutMs: 2000,
      resultTimeoutMs: 5000,
      staleWorkerTimeoutMs: 1000
    } as any;

    const platform = {
      name: 'node',
      now: () => Date.now(),
      log: () => {},
      error: () => {}
    } as any;

    const coordinator = new DistributedCoordinator(distributedConfig, benchmarkConfig, platform);
    const runPromise = coordinator.run();

    let coordinatorUrl: string | undefined;
    for (let i = 0; i < 20; i++) {
      coordinatorUrl = coordinator.getCoordinatorUrl();
      if (coordinatorUrl) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    if (!coordinatorUrl) {
      throw new Error('coordinator URL was not initialized');
    }

    await axios.post(`${coordinatorUrl}/join`, { workerId: 'w1' });
    await axios.post(`${coordinatorUrl}/join`, { workerId: 'w2' });

    const waitForAssignedPlan = async (workerId: string) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const plan = await axios.get(`${coordinatorUrl}/plan/${workerId}`);
        if (plan.data?.ready && Array.isArray(plan.data.assignedEndpoints) && plan.data.assignedEndpoints.length > 0) {
          return plan;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for assigned plan for ${workerId}`);
    };

    const w1Plan = await waitForAssignedPlan('w1');
    const w2Plan = await waitForAssignedPlan('w2');

    expect(w1Plan.data.ready).toBe(true);
    expect(w2Plan.data.ready).toBe(true);

    const w1Endpoint = w1Plan.data.assignedEndpoints[0];
    const w2Endpoint = w2Plan.data.assignedEndpoints[0];
    expect(new Set([w1Endpoint, w2Endpoint]).size).toBe(2);

    const buildResult = (endpointName: string) => ({
      config: { endpoints: [] },
      results: [
        {
          name: endpointName,
          url: `/${endpointName}`,
          method: 'GET',
          totalRequests: 1,
          successfulRequests: 1,
          failedRequests: 0,
          successRate: 1,
          averageResponseTime: 10,
          minResponseTime: 10,
          maxResponseTime: 10,
          requestsPerSecond: 1,
          errors: [],
          requestResults: [{ success: true, responseTime: 10 }],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 }
        }
      ],
      summary: {
        totalDuration: 1000,
        totalRequests: 1,
        totalSuccessful: 1,
        totalFailed: 0,
        overallRequestsPerSecond: 1,
        averageResponseTime: 10,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 },
        errorRate: 0
      },
      timestamp: new Date().toISOString()
    });

    await axios.post(`${coordinatorUrl}/result`, {
      workerId: 'w2',
      result: buildResult(w2Endpoint)
    });

    await new Promise(resolve => setTimeout(resolve, 1200));

    const reassignedPlan = await waitForAssignedPlan('w2');
    expect(reassignedPlan.data.ready).toBe(true);
    expect(reassignedPlan.data.assignedEndpoints).toEqual([w1Endpoint]);

    await axios.post(`${coordinatorUrl}/result`, {
      workerId: 'w2',
      result: buildResult(w1Endpoint)
    });

    const merged = await runPromise;
    expect(merged.summary.totalRequests).toBe(2);
    expect(merged.results.map(r => r.name).sort()).toEqual(['a', 'b']);
    expect(merged.distributed?.staleWorkers).toContain('w1');
  }, 15000);

  test('merges distributed worker summaries', () => {
    const workerA = {
      config: { endpoints: [] },
      results: [
        {
          name: 'health',
          url: '/health',
          method: 'GET',
          totalRequests: 2,
          successfulRequests: 2,
          failedRequests: 0,
          successRate: 1,
          averageResponseTime: 15,
          minResponseTime: 10,
          maxResponseTime: 20,
          requestsPerSecond: 2,
          errors: [],
          requestResults: [
            { success: true, responseTime: 10 },
            { success: true, responseTime: 20 }
          ],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 10, p90: 20, p95: 20, p99: 20 }
        }
      ],
      summary: {
        totalDuration: 1000,
        totalRequests: 2,
        totalSuccessful: 2,
        totalFailed: 0,
        overallRequestsPerSecond: 2,
        averageResponseTime: 15,
        responseTimePercentiles: { p50: 10, p90: 20, p95: 20, p99: 20 },
        errorRate: 0
      },
      timestamp: new Date().toISOString()
    } as any;

    const workerB = {
      config: { endpoints: [] },
      results: [
        {
          name: 'users',
          url: '/users',
          method: 'GET',
          totalRequests: 1,
          successfulRequests: 0,
          failedRequests: 1,
          successRate: 0,
          averageResponseTime: 0,
          minResponseTime: 0,
          maxResponseTime: 0,
          requestsPerSecond: 1,
          errors: ['500'],
          requestResults: [
            { success: false, responseTime: 30, error: '500' }
          ],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 }
        }
      ],
      summary: {
        totalDuration: 1200,
        totalRequests: 1,
        totalSuccessful: 0,
        totalFailed: 1,
        overallRequestsPerSecond: 1,
        averageResponseTime: 0,
        responseTimePercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
        errorRate: 1
      },
      timestamp: new Date().toISOString()
    } as any;

    const merged = mergeDistributedResults(
      {
        endpoints: [
          { name: 'health', url: '/health', method: 'GET' },
          { name: 'users', url: '/users', method: 'GET' }
        ] as any
      },
      [workerA, workerB]
    );

    expect(merged.summary.totalRequests).toBe(3);
    expect(merged.summary.totalFailed).toBe(1);
    expect(merged.summary.errorRate).toBeCloseTo(1 / 3, 5);
    expect(merged.summary.responseTimePercentiles.p95).toBe(20);
    expect(merged.results).toHaveLength(2);
  });
});