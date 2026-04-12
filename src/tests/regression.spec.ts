import { Glockit } from '../index';
import { ConfigValidationError, ConfigValidator } from '../types';
import { importBenchmarkConfig } from '../runtime/importers';
import { executeGrpcRequest } from '../runtime/request-engines';
import { generateHtmlReport } from '../metrics/reporting';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { execFileSync } from 'child_process';

describe('regression coverage', () => {
  test('rejects non-string beforeRequest hook', () => {
    const config = {
      endpoints: [
        {
          name: 'invalid-hook',
          url: '/health',
          method: 'GET',
          beforeRequest: { bad: true }
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('beforeRequest must be a string');
  });

  test('rejects non-string afterRequest hook', () => {
    const config = {
      endpoints: [
        {
          name: 'invalid-after-hook',
          url: '/health',
          method: 'GET',
          afterRequest: 123
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('afterRequest must be a string');
  });

  test('rejects websocket transport with non-ws URL', () => {
    const config = {
      endpoints: [
        {
          name: 'ws-invalid-url',
          transport: 'websocket',
          url: 'https://example.com/socket',
          method: 'GET'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('websocket transport requires an absolute ws:// or wss:// URL');
  });

  test('rejects grpc transport without grpc config', () => {
    const config = {
      endpoints: [
        {
          name: 'grpc-missing-config',
          transport: 'grpc',
          url: 'https://grpc.example.com',
          method: 'POST'
        }
      ]
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('grpc config is required when transport is "grpc"');
  });

  test('imports OpenAPI document into benchmark config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glockit-openapi-import-'));
    const openApiPath = path.join(tmpDir, 'openapi.json');
    fs.writeFileSync(openApiPath, JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Import Test API' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers'
          }
        }
      }
    }), 'utf8');

    const imported = importBenchmarkConfig({ filePath: openApiPath, sourceType: 'openapi' });
    const validated = ConfigValidator.validate(imported);

    expect(validated.global?.baseUrl).toBe('https://api.example.com');
    expect(validated.endpoints).toHaveLength(1);
    expect(validated.endpoints[0].name).toBe('listUsers');
    expect(validated.endpoints[0].url).toBe('/users');
    expect(validated.endpoints[0].method).toBe('GET');
  });

  test('imports OpenAPI query, auth headers, and request example', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glockit-openapi-rich-import-'));
    const openApiPath = path.join(tmpDir, 'openapi-rich.json');
    fs.writeFileSync(openApiPath, JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Rich Import API' },
      servers: [{ url: 'https://api.example.com' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer'
          }
        }
      },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            security: [{ bearerAuth: [] }],
            parameters: [
              { name: 'page', in: 'query', schema: { default: 1 } },
              { name: 'x-trace-id', in: 'header', schema: { example: 'trace-123' } }
            ],
            requestBody: {
              content: {
                'application/json': {
                  example: { active: true }
                }
              }
            }
          }
        }
      }
    }), 'utf8');

    const imported = importBenchmarkConfig({ filePath: openApiPath, sourceType: 'openapi' });
    const validated = ConfigValidator.validate(imported);

    expect(validated.endpoints[0].query).toEqual({ page: 1 });
    expect(validated.endpoints[0].headers).toMatchObject({
      Authorization: 'Bearer {{TOKEN}}',
      'x-trace-id': 'trace-123'
    });
    expect(validated.endpoints[0].body).toEqual({ active: true });
  });

  test('imports Postman auth and query mappings', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glockit-postman-rich-import-'));
    const postmanPath = path.join(tmpDir, 'collection.json');
    fs.writeFileSync(postmanPath, JSON.stringify({
      info: { name: 'Postman Rich Import' },
      item: [
        {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/users?page=2',
              query: [{ key: 'page', value: '2' }]
            },
            auth: {
              type: 'bearer',
              bearer: [{ key: 'token', value: 'x' }]
            }
          }
        }
      ]
    }), 'utf8');

    const imported = importBenchmarkConfig({ filePath: postmanPath, sourceType: 'postman' });
    const validated = ConfigValidator.validate(imported);

    expect(validated.endpoints[0].query).toEqual({ page: '2' });
    expect(validated.endpoints[0].headers).toMatchObject({ Authorization: 'Bearer {{TOKEN}}' });
  });

  test('executes unary grpc request with proto loader', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glockit-grpc-runtime-'));
    const protoPath = path.join(tmpDir, 'echo.proto');
    fs.writeFileSync(protoPath, [
      'syntax = "proto3";',
      'package glockit.test;',
      'service EchoService {',
      '  rpc Echo (EchoRequest) returns (EchoReply);',
      '}',
      'message EchoRequest { string message = 1; }',
      'message EchoReply { string message = 1; }'
    ].join('\n'), 'utf8');

    const packageDefinition = await protoLoader.load(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    const loaded = grpc.loadPackageDefinition(packageDefinition) as any;

    const server = new grpc.Server();
    server.addService(loaded.glockit.test.EchoService.service, {
      Echo: (call: any, callback: any) => {
        callback(null, { message: `echo:${call.request.message}` });
      }
    });

    const boundPort = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, port) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });

    try {
      const response = await executeGrpcRequest({
        endpoint: {
          name: 'grpc-echo',
          transport: 'grpc',
          url: `127.0.0.1:${boundPort}`,
          method: 'POST',
          grpc: {
            protoPath,
            service: 'glockit.test.EchoService',
            method: 'Echo',
            payload: { message: 'hello' }
          }
        } as any,
        url: `127.0.0.1:${boundPort}`,
        headers: {},
        body: undefined,
        timeout: 4000
      });

      expect(response.status).toBe(200);
      expect(response.data).toEqual({ message: 'echo:hello' });
      expect(response.headers['x-glockit-transport']).toBe('grpc');
    } finally {
      await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
    }
  });

  test('html reporter includes interactive controls', () => {
    const report = generateHtmlReport({
      config: { endpoints: [] },
      timestamp: new Date().toISOString(),
      summary: {
        totalDuration: 1000,
        totalRequests: 2,
        totalSuccessful: 2,
        totalFailed: 0,
        overallRequestsPerSecond: 2,
        averageResponseTime: 10,
        responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 },
        errorRate: 0
      },
      results: [
        {
          name: 'health',
          url: '/health',
          method: 'GET',
          totalRequests: 2,
          successfulRequests: 2,
          failedRequests: 0,
          successRate: 1,
          averageResponseTime: 10,
          minResponseTime: 8,
          maxResponseTime: 12,
          requestsPerSecond: 2,
          errors: [],
          requestResults: [],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 10, p90: 10, p95: 10, p99: 10 }
        }
      ]
    } as any);

    expect(report).toContain('id="endpoint-search"');
    expect(report).toContain('id="sort-by"');
    expect(report).toContain('id="failed-only"');
    expect(report).toContain('id="latency-chart"');
    expect(report).toContain('id="rps-chart"');
    expect(report).toContain('id="endpoint-drilldown"');
  });

  test('sandboxed hook blocks eval usage', () => {
    const glockit = new Glockit({ progress: false });

    const runHook = (glockit as any).runHookInSandbox.bind(glockit);

    expect(() => {
      runHook(
        "variables.answer = eval('40 + 2');",
        { variables: {} },
        'beforeRequest',
        'sandbox-test'
      );
    }).toThrow();
  });

  test('sandboxed hook allows normal variable mutation', () => {
    const glockit = new Glockit({ progress: false });
    const context = { variables: { value: 1 } };

    const runHook = (glockit as any).runHookInSandbox.bind(glockit);

    runHook('variables.value = variables.value + 1;', context, 'beforeRequest', 'sandbox-test');

    expect(context.variables.value).toBe(2);
  });

  test('rejects invalid slo.maxErrorRate', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        slo: {
          maxErrorRate: 1.5
        }
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global slo.maxErrorRate must be a number between 0 and 1');
  });

  test('calculates response-time percentiles correctly', () => {
    const glockit = new Glockit({ progress: false });
    const calculatePercentiles = (glockit as any).calculatePercentiles.bind(glockit);

    const percentiles = calculatePercentiles([10, 20, 30, 40, 50]);

    expect(percentiles).toEqual({
      p50: 30,
      p90: 50,
      p95: 50,
      p99: 50
    });
  });

  test('evaluates slo failures from summary', () => {
    const glockit = new Glockit({ progress: false });
    const evaluateSlo = (glockit as any).evaluateSlo.bind(glockit);

    const evaluation = evaluateSlo(
      {
        totalDuration: 1000,
        totalRequests: 100,
        totalSuccessful: 95,
        totalFailed: 5,
        overallRequestsPerSecond: 100,
        averageResponseTime: 150,
        responseTimePercentiles: { p50: 100, p90: 140, p95: 220, p99: 280 },
        errorRate: 0.05
      },
      {
        maxErrorRate: 0.01,
        p95Ms: 200,
        p99Ms: 250
      }
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.failures.length).toBe(3);
  });

  test('rejects invalid global phases config', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        phases: []
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global phases must be a non-empty array when provided');
  });

  test('runs phase-based benchmark with dry-run mode', async () => {
    const glockit = new Glockit({ progress: false, dryRun: true });

    const result = await glockit.run({
      global: {
        phases: [
          { name: 'warmup', duration: 20, concurrent: 1 },
          { name: 'steady', duration: 20, concurrent: 1 }
        ]
      },
      endpoints: [
        {
          name: 'phase-endpoint',
          url: 'https://example.com/health',
          method: 'GET'
        }
      ]
    });

    expect(result.results[0].totalRequests).toBeGreaterThan(0);
    expect(result.results[0].successfulRequests).toBeGreaterThan(0);
  });

  test('rejects invalid executor value', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        executor: 'invalid-mode'
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global executor must be either "concurrency" or "arrival-rate"');
  });

  test('rejects invalid data feeder format', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        dataFeeder: {
          path: './sample/data.txt',
          format: 'txt'
        }
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global dataFeeder.format must be either "json" or "csv"');
  });

  test('arrival-rate executor computes pacing delay', () => {
    const glockit = new Glockit({ progress: false });
    const getDelay = (glockit as any).getEffectiveRequestDelayMs.bind(glockit);

    expect(getDelay(0, 'arrival-rate', 50, 5)).toBeGreaterThan(0);
    expect(getDelay(20, 'arrival-rate', 100, 5)).toBeGreaterThanOrEqual(20);
    expect(getDelay(10, 'concurrency', undefined, 5)).toBe(10);
  });

  test('parses quoted CSV feeder rows correctly', () => {
    const glockit = new Glockit({ progress: false });
    const parseCsvData = (glockit as any).parseCsvData.bind(glockit);

    const rows = parseCsvData(
      'id,name,note\n1,"Doe, John","hello, world"\n2,"Alice","She said ""hi"""'
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: '1', name: 'Doe, John', note: 'hello, world' });
    expect(rows[1]).toEqual({ id: '2', name: 'Alice', note: 'She said "hi"' });
  });

  test('previewDataFeeder returns configured number of rows', () => {
    const tmpFile = path.join(os.tmpdir(), `glockit-feeder-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]), 'utf8');

    try {
      const glockit = new Glockit({ progress: false });
      const preview = glockit.previewDataFeeder(
        {
          path: tmpFile,
          format: 'json',
          strategy: 'sequential'
        },
        2
      );

      expect(preview).toHaveLength(2);
      expect(preview[0]).toEqual({ id: 1 });
      expect(preview[1]).toEqual({ id: 2 });
    } finally {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  });

  test('cli preview-feeder-only exits before benchmark execution', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glockit-cli-preview-'));
    const feederPath = path.join(tmpDir, 'feeder.json');
    const configPath = path.join(tmpDir, 'config.json');

    fs.writeFileSync(feederPath, JSON.stringify([{ id: 1 }, { id: 2 }]), 'utf8');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        global: {
          dataFeeder: {
            path: feederPath,
            format: 'json',
            strategy: 'sequential'
          }
        },
        endpoints: [
          {
            name: 'will-not-run',
            url: 'https://example.com/health',
            method: 'GET'
          }
        ]
      }),
      'utf8'
    );

    try {
      const tsNodeBin = path.join(process.cwd(), 'node_modules', 'ts-node', 'dist', 'bin.js');
      const output = execFileSync(
        process.execPath,
        [
          tsNodeBin,
          'src/cli.ts',
          'run',
          '--config',
          configPath,
          '--preview-feeder-only',
          '1',
          '--no-progress'
        ],
        { encoding: 'utf8' }
      );

      expect(output).toContain('Data Feeder Preview');
      expect(output).toContain('Feeder preview complete. Exiting without running benchmark.');
      expect(output).not.toContain('Benchmark Summary');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('rejects invalid observability.prometheus.port', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        observability: {
          prometheus: {
            enabled: true,
            port: -1
          }
        }
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global observability.prometheus.port must be an integer between 0 and 65535');
  });

  test('rejects invalid observability.otel.traces.samplingRatio', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        observability: {
          otel: {
            enabled: true,
            traces: {
              enabled: true,
              samplingRatio: 2
            }
          }
        }
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global observability.otel.traces.samplingRatio must be a number between 0 and 1');
  });

  test('dry-run benchmark returns observability metadata for prometheus endpoint', async () => {
    const glockit = new Glockit({ progress: false, dryRun: true });

    const result = await glockit.run({
      global: {
        maxRequests: 1,
        observability: {
          prometheus: {
            enabled: true,
            host: '127.0.0.1',
            port: 0,
            keepAlive: false
          }
        }
      },
      endpoints: [
        {
          name: 'health',
          url: 'https://example.com/health',
          method: 'GET'
        }
      ]
    });

    expect(result.observability?.prometheus?.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/metrics$/);
    expect(result.observability?.prometheus?.active).toBe(true);
  });

  test('rejects invalid coordinatedOmission.expectedIntervalMs', () => {
    const config = {
      endpoints: [
        {
          name: 'health',
          url: '/health',
          method: 'GET'
        }
      ],
      global: {
        coordinatedOmission: {
          enabled: true,
          expectedIntervalMs: 0
        }
      }
    } as any;

    expect(() => ConfigValidator.validate(config)).toThrow(ConfigValidationError);
    expect(() => ConfigValidator.validate(config)).toThrow('Global coordinatedOmission.expectedIntervalMs must be a positive number');
  });

  test('coordinated omission correction expands latency samples', () => {
    const glockit = new Glockit({ progress: false });
    const applyCorrection = (glockit as any).applyCoordinatedOmissionCorrection.bind(glockit);
    const calculatePercentiles = (glockit as any).calculatePercentiles.bind(glockit);

    const corrected = applyCorrection([100], 20);

    expect(corrected.addedSamples).toBe(4);
    expect(corrected.values).toEqual([100, 80, 60, 40, 20]);

    const correctedPercentiles = calculatePercentiles(corrected.values);
    expect(correctedPercentiles.p50).toBe(60);
    expect(correctedPercentiles.p95).toBe(100);
  });

  test('rejects scenario mix flow with unknown endpoint', () => {
    const config = {
      global: {
        scenarioMix: {
          enabled: true,
          scenarios: [
            {
              name: 'happy-path',
              flow: ['missing-endpoint']
            }
          ]
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
    expect(() => ConfigValidator.validate(config)).toThrow('references unknown endpoint');
  });

  test('runs weighted scenario mix in dry-run mode', async () => {
    const glockit = new Glockit({ progress: false, dryRun: true });

    const result = await glockit.run({
      global: {
        maxRequests: 10,
        concurrent: 2,
        scenarioMix: {
          enabled: true,
          scenarios: [
            {
              name: 'browse',
              weight: 3,
              flow: ['list-products', 'get-product']
            },
            {
              name: 'healthcheck',
              weight: 1,
              flow: ['health']
            }
          ]
        }
      },
      endpoints: [
        {
          name: 'list-products',
          url: 'https://example.com/products',
          method: 'GET'
        },
        {
          name: 'get-product',
          url: 'https://example.com/products/1',
          method: 'GET'
        },
        {
          name: 'health',
          url: 'https://example.com/health',
          method: 'GET'
        }
      ]
    });

    expect(result.summary.totalRequests).toBe(10);
    expect(result.results.some(r => r.totalRequests > 0)).toBe(true);
  });

  test('rejects invalid jitter load shape ratio', () => {
    const config = {
      global: {
        arrivalRate: 10,
        loadShape: {
          mode: 'jitter',
          jitterRatio: 1.5
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
    expect(() => ConfigValidator.validate(config)).toThrow('Global loadShape.jitterRatio must be a number between 0 and 1 when mode=jitter');
  });

  test('step load shape selects rate by elapsed time', () => {
    const glockit = new Glockit({ progress: false });
    const applyLoadShape = (glockit as any).applyLoadShape.bind(glockit);

    const loadShape = {
      mode: 'step',
      steps: [
        { afterMs: 0, rate: 5 },
        { afterMs: 1000, rate: 20 }
      ]
    };

    expect(applyLoadShape(10, loadShape, 100)).toBe(5);
    expect(applyLoadShape(10, loadShape, 1500)).toBe(20);
  });

  test('rejects invalid virtualUsers.sessionScope type', () => {
    const config = {
      global: {
        virtualUsers: {
          sessionScope: 'yes'
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
    expect(() => ConfigValidator.validate(config)).toThrow('Global virtualUsers.sessionScope must be a boolean');
  });

  test('captures and formats cookies for a virtual user session', () => {
    const glockit = new Glockit({ progress: false });
    const createSession = (glockit as any).createVirtualUserSession.bind(glockit);
    const captureSetCookies = (glockit as any).captureSetCookies.bind(glockit);
    const getCookieHeader = (glockit as any).getCookieHeader.bind(glockit);

    const session = createSession('worker-1');
    captureSetCookies(
      { 'set-cookie': ['sid=abc123; Path=/; HttpOnly', 'theme=dark; Path=/'] },
      session,
      { persistCookies: true }
    );

    const cookieHeader = getCookieHeader(session, { persistCookies: true });
    expect(cookieHeader).toContain('sid=abc123');
    expect(cookieHeader).toContain('theme=dark');
  });

  test('rejects transaction group with unknown endpoint', () => {
    const config = {
      global: {
        transactionGroups: [
          {
            name: 'checkout',
            endpoints: ['missing-endpoint']
          }
        ]
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
    expect(() => ConfigValidator.validate(config)).toThrow('Transaction group "checkout" references unknown endpoint "missing-endpoint"');
  });

  test('builds grouped transaction summary metrics', () => {
    const glockit = new Glockit({ progress: false });
    const buildTransactionGroups = (glockit as any).buildTransactionGroupResults.bind(glockit);

    const grouped = buildTransactionGroups(
      [
        {
          name: 'browse',
          endpoints: ['list', 'details']
        }
      ],
      [
        {
          name: 'list',
          url: '/list',
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
        },
        {
          name: 'details',
          url: '/details',
          method: 'GET',
          totalRequests: 1,
          successfulRequests: 1,
          failedRequests: 0,
          successRate: 1,
          averageResponseTime: 30,
          minResponseTime: 30,
          maxResponseTime: 30,
          requestsPerSecond: 1,
          errors: [],
          requestResults: [
            { success: true, responseTime: 30 }
          ],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 30, p90: 30, p95: 30, p99: 30 }
        }
      ],
      1000,
      { enabled: false }
    );

    expect(grouped).toHaveLength(1);
    expect(grouped[0].name).toBe('browse');
    expect(grouped[0].totalRequests).toBe(3);
    expect(grouped[0].successfulRequests).toBe(3);
    expect(grouped[0].averageResponseTime).toBeCloseTo(20, 5);
    expect(grouped[0].responseTimePercentiles.p95).toBe(30);
    expect(grouped[0].requestsPerSecond).toBeCloseTo(3, 5);
  });

  test('rejects invalid diagnostics sample size', () => {
    const config = {
      global: {
        diagnostics: {
          enabled: true,
          sampleSize: 0
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
    expect(() => ConfigValidator.validate(config)).toThrow('Global diagnostics.sampleSize must be a positive integer');
  });

  test('builds masked diagnostic samples with size cap', () => {
    const glockit = new Glockit({ progress: false });
    const buildDiagnosticsSummary = (glockit as any).buildDiagnosticsSummary.bind(glockit);

    const summary = buildDiagnosticsSummary(
      [
        {
          name: 'login',
          url: '/auth/login',
          method: 'POST',
          totalRequests: 2,
          successfulRequests: 0,
          failedRequests: 2,
          successRate: 0,
          averageResponseTime: 0,
          minResponseTime: 0,
          maxResponseTime: 0,
          requestsPerSecond: 0,
          errors: ['401'],
          requestResults: [
            {
              success: false,
              responseTime: 10,
              statusCode: 401,
              error: 'Unauthorized',
              requestMethod: 'POST',
              requestUrl: '/auth/login',
              requestHeaders: { Authorization: 'Bearer secret-token' },
              requestBody: { password: 'super-secret', username: 'alice' },
              data: { token: 'abc123', detail: 'invalid creds' },
              headers: { 'set-cookie': 'sid=abc' }
            },
            {
              success: false,
              responseTime: 12,
              statusCode: 500,
              error: 'ServerError',
              requestMethod: 'POST',
              requestUrl: '/auth/login',
              requestHeaders: { Authorization: 'Bearer another-secret' },
              requestBody: { password: 'secret-2', username: 'bob' },
              data: { token: 'def456', detail: 'crash' },
              headers: { 'set-cookie': 'sid=def' }
            }
          ],
          totalRequestSizeKB: 0,
          averageRequestSizeKB: 0,
          totalResponseSizeKB: 0,
          averageResponseSizeKB: 0,
          responseTimePercentiles: { p50: 0, p90: 0, p95: 0, p99: 0 }
        }
      ],
      {
        enabled: true,
        sampleSize: 1,
        maskKeys: ['authorization', 'password', 'token']
      }
    );

    expect(summary.totalFailures).toBe(2);
    expect(summary.sampledFailures).toBe(1);
    expect(summary.samples[0].requestHeaders?.Authorization).toBe('********');
    expect(summary.samples[0].requestBody?.password).toBe('********');
    expect(summary.samples[0].responseBody?.token).toBe('********');
  });

  test('rejects invalid global reporters config', () => {
    const config = {
      global: {
        reporters: [
          {
            type: ''
          }
        ]
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
    expect(() => ConfigValidator.validate(config)).toThrow('Global reporters[0].type must be a non-empty string');
  });

  test('saveWithReporters emits junit xml report', async () => {
    const glockit = new Glockit({ progress: false, dryRun: true });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glockit-junit-'));
    const junitPath = path.join(tmpDir, 'benchmark.xml');

    try {
      const result = await glockit.run({
        global: {
          maxRequests: 1
        },
        endpoints: [
          {
            name: 'health',
            url: 'https://example.com/health',
            method: 'GET'
          }
        ]
      });

      await glockit.saveWithReporters(result, [{ type: 'junit', path: junitPath }]);

      const junit = fs.readFileSync(junitPath, 'utf8');
      expect(junit).toContain('<testsuites');
      expect(junit).toContain('testsuite name="health"');
      expect(junit).toContain('testcase classname="glockit.endpoint"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('saveWithReporters executes custom reporter', async () => {
    const glockit = new Glockit({ progress: false, dryRun: true });
    let invoked = false;

    glockit.registerReporter('custom', (result, output) => {
      invoked = true;
      expect(output.type).toBe('custom');
      expect(result.summary.totalRequests).toBeGreaterThan(0);
    });

    const result = await glockit.run({
      global: {
        maxRequests: 1
      },
      endpoints: [
        {
          name: 'health',
          url: 'https://example.com/health',
          method: 'GET'
        }
      ]
    });

    await glockit.saveWithReporters(result, [{ type: 'custom' }]);
    expect(invoked).toBe(true);
  });
});
