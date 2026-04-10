import { BenchmarkResult, OTelExportConfig, OTelTraceExportConfig, ObservabilityConfig, ObservabilityResult, PrometheusExportConfig } from '../types';

interface OTelRuntime {
  provider: any;
  endpoint?: string;
  benchmarkRuns: any;
  totalRequests: any;
  successfulRequests: any;
  failedRequests: any;
  runDurationMs: any;
  avgResponseTimeMs: any;
  p95ResponseTimeMs: any;
  p99ResponseTimeMs: any;
  endpointRequests: any;
  endpointFailedRequests: any;
  endpointAvgResponseTimeMs: any;
  endpointRps: any;
}

interface OTelTraceRuntime {
  provider: any;
  tracer: any;
  endpoint?: string;
}

export class ObservabilityManager {
  private config?: ObservabilityConfig;
  private prometheusServer?: import('node:http').Server;
  private prometheusEndpoint?: string;
  private prometheusPayload = '# No benchmark has been executed yet\n';
  private warnings: string[] = [];
  private otelRuntime?: OTelRuntime;
  private otelTraceRuntime?: OTelTraceRuntime;
  private readonly platformName: string;

  constructor(platformName: string) {
    this.platformName = platformName;
  }

  public async initialize(config?: ObservabilityConfig): Promise<void> {
    this.config = config;
    if (!config) {
      return;
    }

    if (this.platformName !== 'node') {
      this.warnings.push('Observability exports are currently supported only on the node platform.');
      return;
    }

    if (config.prometheus?.enabled) {
      await this.initializePrometheus(config.prometheus);
    }

    if (config.otel?.enabled) {
      this.initializeOtel(config.otel);
    }
  }

  public async publish(result: BenchmarkResult): Promise<ObservabilityResult | undefined> {
    if (!this.config) {
      return undefined;
    }

    this.prometheusPayload = this.buildPrometheusPayload(result);

    const otelExport = await this.publishOtelMetrics(result);
    const otelTracesExport = await this.publishOtelTraces(result);

    const status: ObservabilityResult = {
      warnings: [...this.warnings]
    };

    if (this.prometheusEndpoint) {
      status.prometheus = {
        endpoint: this.prometheusEndpoint,
        active: true
      };
    }

    if (otelExport) {
      status.otel = otelExport;
    }

    if (otelTracesExport) {
      status.otelTraces = otelTracesExport;
    }

    return status;
  }

  private async initializePrometheus(config: PrometheusExportConfig): Promise<void> {
    try {
      const http = require('node:http') as typeof import('node:http');
      const host = config.host || '127.0.0.1';
      const port = config.port ?? 9464;
      const endpointPath = this.normalizePrometheusPath(config.path || '/metrics');

      this.prometheusServer = http.createServer((req, res) => {
        const incomingPath = (req.url || '/').split('?')[0];
        if (incomingPath !== endpointPath) {
          res.statusCode = 404;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end('Not Found');
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
        res.end(this.prometheusPayload);
      });

      await new Promise<void>((resolve, reject) => {
        this.prometheusServer!.once('error', reject);
        this.prometheusServer!.listen(port, host, () => {
          this.prometheusServer!.off('error', reject);
          resolve();
        });
      });

      const address = this.prometheusServer.address();
      if (address && typeof address === 'object') {
        const normalizedHost = host === '0.0.0.0' ? '127.0.0.1' : host;
        this.prometheusEndpoint = `http://${normalizedHost}:${address.port}${endpointPath}`;
      }

      if (!config.keepAlive) {
        this.prometheusServer.unref();
      }
    } catch (error) {
      this.warnings.push(`Failed to initialize Prometheus endpoint: ${this.toErrorMessage(error)}`);
    }
  }

  private initializeOtel(config: OTelExportConfig): void {
    try {
      const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics') as typeof import('@opentelemetry/sdk-metrics');
      const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http') as typeof import('@opentelemetry/exporter-metrics-otlp-http');
      const { resourceFromAttributes } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');

      const endpoint =
        config.endpoint ||
        process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

      const headers = config.headers || {};
      const exporter = new OTLPMetricExporter(
        endpoint
          ? { url: endpoint, headers }
          : { headers }
      );

      const exportIntervalMillis = Math.max(1000, config.intervalMs ?? 1000);

      const reader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis
      });

      const resourceAttributes: Record<string, string | number | boolean> = {
        'service.name': config.serviceName || 'glockit',
        ...config.attributes
      };

      const provider = new MeterProvider({
        resource: resourceFromAttributes(resourceAttributes),
        readers: [reader]
      });

      const meter = provider.getMeter('glockit');
      this.otelRuntime = {
        provider,
        endpoint,
        benchmarkRuns: meter.createCounter('glockit_benchmark_runs_total', {
          description: 'Number of benchmark runs executed'
        }),
        totalRequests: meter.createCounter('glockit_requests_total', {
          description: 'Total number of benchmark requests'
        }),
        successfulRequests: meter.createCounter('glockit_requests_success_total', {
          description: 'Total number of successful benchmark requests'
        }),
        failedRequests: meter.createCounter('glockit_requests_failed_total', {
          description: 'Total number of failed benchmark requests'
        }),
        runDurationMs: meter.createHistogram('glockit_run_duration_ms', {
          description: 'Benchmark run duration in milliseconds'
        }),
        avgResponseTimeMs: meter.createHistogram('glockit_avg_response_time_ms', {
          description: 'Average response time across the benchmark run in milliseconds'
        }),
        p95ResponseTimeMs: meter.createHistogram('glockit_p95_response_time_ms', {
          description: 'p95 response time for the benchmark run in milliseconds'
        }),
        p99ResponseTimeMs: meter.createHistogram('glockit_p99_response_time_ms', {
          description: 'p99 response time for the benchmark run in milliseconds'
        }),
        endpointRequests: meter.createCounter('glockit_endpoint_requests_total', {
          description: 'Per-endpoint request totals'
        }),
        endpointFailedRequests: meter.createCounter('glockit_endpoint_requests_failed_total', {
          description: 'Per-endpoint failed request totals'
        }),
        endpointAvgResponseTimeMs: meter.createHistogram('glockit_endpoint_avg_response_time_ms', {
          description: 'Per-endpoint average response time in milliseconds'
        }),
        endpointRps: meter.createHistogram('glockit_endpoint_rps', {
          description: 'Per-endpoint requests per second'
        })
      };

      if (config.traces?.enabled) {
        this.initializeOtelTraces(config.traces, config);
      }
    } catch (error) {
      this.warnings.push(`Failed to initialize OpenTelemetry export: ${this.toErrorMessage(error)}`);
      this.otelRuntime = undefined;
    }
  }

  private initializeOtelTraces(config: OTelTraceExportConfig, parentMetricsConfig: OTelExportConfig): void {
    try {
      const { resourceFromAttributes } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
      const {
        BasicTracerProvider,
        BatchSpanProcessor,
        ParentBasedSampler,
        TraceIdRatioBasedSampler
      } = require('@opentelemetry/sdk-trace-base') as typeof import('@opentelemetry/sdk-trace-base');

      const endpoint =
        config.endpoint ||
        process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

      const headers = config.headers || parentMetricsConfig.headers || {};
      const exporter = new OTLPTraceExporter(
        endpoint
          ? { url: endpoint, headers }
          : { headers }
      );

      const samplingRatio = Math.min(1, Math.max(0, config.samplingRatio ?? 1));
      const sampler = new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(samplingRatio)
      });

      const resourceAttributes: Record<string, string | number | boolean> = {
        'service.name': config.serviceName || parentMetricsConfig.serviceName || 'glockit',
        ...(parentMetricsConfig.attributes || {}),
        ...(config.attributes || {})
      };

      const provider = new BasicTracerProvider({
        resource: resourceFromAttributes(resourceAttributes),
        sampler,
        spanProcessors: [new BatchSpanProcessor(exporter)]
      });

      this.otelTraceRuntime = {
        provider,
        tracer: provider.getTracer('glockit'),
        endpoint
      };
    } catch (error) {
      this.warnings.push(`Failed to initialize OpenTelemetry trace export: ${this.toErrorMessage(error)}`);
      this.otelTraceRuntime = undefined;
    }
  }

  private async publishOtelMetrics(result: BenchmarkResult): Promise<ObservabilityResult['otel'] | undefined> {
    if (!this.otelRuntime) {
      return this.config?.otel?.enabled
        ? {
            exported: false,
            endpoint: this.config.otel.endpoint
          }
        : undefined;
    }

    const benchmarkName = result.config.name || 'unnamed';
    const attrs = { benchmark_name: benchmarkName };

    try {
      this.otelRuntime.benchmarkRuns.add(1, attrs);
      this.otelRuntime.totalRequests.add(result.summary.totalRequests, attrs);
      this.otelRuntime.successfulRequests.add(result.summary.totalSuccessful, attrs);
      this.otelRuntime.failedRequests.add(result.summary.totalFailed, attrs);
      this.otelRuntime.runDurationMs.record(result.summary.totalDuration, attrs);
      this.otelRuntime.avgResponseTimeMs.record(result.summary.averageResponseTime, attrs);
      this.otelRuntime.p95ResponseTimeMs.record(result.summary.responseTimePercentiles.p95, attrs);
      this.otelRuntime.p99ResponseTimeMs.record(result.summary.responseTimePercentiles.p99, attrs);

      for (const endpoint of result.results) {
        const endpointAttrs = {
          ...attrs,
          endpoint_name: endpoint.name,
          method: endpoint.method
        };

        this.otelRuntime.endpointRequests.add(endpoint.totalRequests, endpointAttrs);
        this.otelRuntime.endpointFailedRequests.add(endpoint.failedRequests, endpointAttrs);
        this.otelRuntime.endpointAvgResponseTimeMs.record(endpoint.averageResponseTime, endpointAttrs);
        this.otelRuntime.endpointRps.record(endpoint.requestsPerSecond, endpointAttrs);
      }

      await this.otelRuntime.provider.forceFlush();
      return {
        exported: true,
        endpoint: this.otelRuntime.endpoint
      };
    } catch (error) {
      const message = `OpenTelemetry export failed: ${this.toErrorMessage(error)}`;
      this.warnings.push(message);
      return {
        exported: false,
        endpoint: this.otelRuntime.endpoint,
        error: message
      };
    }
  }

  private async publishOtelTraces(result: BenchmarkResult): Promise<ObservabilityResult['otelTraces'] | undefined> {
    if (!this.config?.otel?.traces?.enabled) {
      return undefined;
    }

    if (!this.otelTraceRuntime) {
      return {
        exported: false,
        endpoint: this.config.otel.traces.endpoint
      };
    }

    try {
      const benchmarkName = result.config.name || 'unnamed';
      const runSpan = this.otelTraceRuntime.tracer.startSpan('glockit.benchmark.run', {
        attributes: {
          'glockit.benchmark.name': benchmarkName,
          'glockit.total_requests': result.summary.totalRequests,
          'glockit.total_successful': result.summary.totalSuccessful,
          'glockit.total_failed': result.summary.totalFailed,
          'glockit.avg_response_time_ms': result.summary.averageResponseTime,
          'glockit.p95_response_time_ms': result.summary.responseTimePercentiles.p95,
          'glockit.p99_response_time_ms': result.summary.responseTimePercentiles.p99,
          'glockit.requests_per_second': result.summary.overallRequestsPerSecond
        }
      });

      for (const endpoint of result.results) {
        const endpointSpan = this.otelTraceRuntime.tracer.startSpan('glockit.endpoint.summary', {
          attributes: {
            'glockit.endpoint.name': endpoint.name,
            'http.method': endpoint.method,
            'url.path': endpoint.url,
            'glockit.endpoint.total_requests': endpoint.totalRequests,
            'glockit.endpoint.failed_requests': endpoint.failedRequests,
            'glockit.endpoint.avg_response_time_ms': endpoint.averageResponseTime,
            'glockit.endpoint.p95_response_time_ms': endpoint.responseTimePercentiles.p95,
            'glockit.endpoint.p99_response_time_ms': endpoint.responseTimePercentiles.p99,
            'glockit.endpoint.rps': endpoint.requestsPerSecond
          }
        }, runSpan);
        endpointSpan.end();
      }

      runSpan.end();

      await this.otelTraceRuntime.provider.forceFlush();
      return {
        exported: true,
        endpoint: this.otelTraceRuntime.endpoint
      };
    } catch (error) {
      const message = `OpenTelemetry trace export failed: ${this.toErrorMessage(error)}`;
      this.warnings.push(message);
      return {
        exported: false,
        endpoint: this.otelTraceRuntime.endpoint,
        error: message
      };
    }
  }

  private buildPrometheusPayload(result: BenchmarkResult): string {
    const lines: string[] = [];

    lines.push('# HELP glockit_benchmark_runs_total Number of benchmark runs executed');
    lines.push('# TYPE glockit_benchmark_runs_total counter');
    lines.push('glockit_benchmark_runs_total 1');

    lines.push('# HELP glockit_requests_total Total benchmark requests');
    lines.push('# TYPE glockit_requests_total gauge');
    lines.push(`glockit_requests_total ${result.summary.totalRequests}`);

    lines.push('# HELP glockit_requests_success_total Successful benchmark requests');
    lines.push('# TYPE glockit_requests_success_total gauge');
    lines.push(`glockit_requests_success_total ${result.summary.totalSuccessful}`);

    lines.push('# HELP glockit_requests_failed_total Failed benchmark requests');
    lines.push('# TYPE glockit_requests_failed_total gauge');
    lines.push(`glockit_requests_failed_total ${result.summary.totalFailed}`);

    lines.push('# HELP glockit_run_duration_ms Benchmark run duration in milliseconds');
    lines.push('# TYPE glockit_run_duration_ms gauge');
    lines.push(`glockit_run_duration_ms ${result.summary.totalDuration.toFixed(2)}`);

    lines.push('# HELP glockit_avg_response_time_ms Average response time in milliseconds');
    lines.push('# TYPE glockit_avg_response_time_ms gauge');
    lines.push(`glockit_avg_response_time_ms ${result.summary.averageResponseTime.toFixed(4)}`);

    lines.push('# HELP glockit_p95_response_time_ms p95 response time in milliseconds');
    lines.push('# TYPE glockit_p95_response_time_ms gauge');
    lines.push(`glockit_p95_response_time_ms ${result.summary.responseTimePercentiles.p95.toFixed(4)}`);

    lines.push('# HELP glockit_p99_response_time_ms p99 response time in milliseconds');
    lines.push('# TYPE glockit_p99_response_time_ms gauge');
    lines.push(`glockit_p99_response_time_ms ${result.summary.responseTimePercentiles.p99.toFixed(4)}`);

    lines.push('# HELP glockit_error_rate Benchmark error rate between 0 and 1');
    lines.push('# TYPE glockit_error_rate gauge');
    lines.push(`glockit_error_rate ${result.summary.errorRate.toFixed(6)}`);

    lines.push('# HELP glockit_requests_per_second Benchmark throughput in requests per second');
    lines.push('# TYPE glockit_requests_per_second gauge');
    lines.push(`glockit_requests_per_second ${result.summary.overallRequestsPerSecond.toFixed(6)}`);

    for (const endpoint of result.results) {
      const labels = this.formatLabels({
        endpoint: endpoint.name,
        method: endpoint.method
      });

      lines.push(`glockit_endpoint_requests_total{${labels}} ${endpoint.totalRequests}`);
      lines.push(`glockit_endpoint_failed_requests_total{${labels}} ${endpoint.failedRequests}`);
      lines.push(`glockit_endpoint_avg_response_time_ms{${labels}} ${endpoint.averageResponseTime.toFixed(4)}`);
      lines.push(`glockit_endpoint_rps{${labels}} ${endpoint.requestsPerSecond.toFixed(6)}`);
    }

    return `${lines.join('\n')}\n`;
  }

  private formatLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(([key, value]) => `${key}="${this.escapePrometheusLabel(value)}"`)
      .join(',');
  }

  private escapePrometheusLabel(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"');
  }

  private normalizePrometheusPath(pathValue: string): string {
    return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
  }

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}