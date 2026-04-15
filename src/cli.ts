#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { Glockit } from './index';
import { BenchmarkConfig, BenchmarkResult, ConfigValidator, ConfigValidationError, ReporterOutputConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { importBenchmarkConfig, ImportSourceType } from './runtime/importers';

interface ComparisonEndpointDelta {
  name: string;
  avgResponseTimeDeltaMs: number;
  p95DeltaMs: number;
  requestsPerSecondDelta: number;
  successRateDelta: number;
}

interface ComparisonReport {
  baselineTimestamp: string;
  currentTimestamp: string;
  summaryDelta: {
    totalRequests: number;
    totalSuccessful: number;
    totalFailed: number;
    overallRequestsPerSecond: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  endpointDeltas: ComparisonEndpointDelta[];
}

function buildComparisonReport(baseline: BenchmarkResult, current: BenchmarkResult): ComparisonReport {
  const byName = new Map(baseline.results.map(r => [r.name, r]));

  const endpointDeltas: ComparisonEndpointDelta[] = current.results
    .filter(r => byName.has(r.name))
    .map(r => {
      const b = byName.get(r.name)!;
      return {
        name: r.name,
        avgResponseTimeDeltaMs: r.averageResponseTime - b.averageResponseTime,
        p95DeltaMs: (r.responseTimePercentiles?.p95 || 0) - (b.responseTimePercentiles?.p95 || 0),
        requestsPerSecondDelta: r.requestsPerSecond - b.requestsPerSecond,
        successRateDelta: r.successRate - b.successRate
      };
    })
    .sort((a, b) => b.avgResponseTimeDeltaMs - a.avgResponseTimeDeltaMs);

  return {
    baselineTimestamp: baseline.timestamp,
    currentTimestamp: current.timestamp,
    summaryDelta: {
      totalRequests: current.summary.totalRequests - baseline.summary.totalRequests,
      totalSuccessful: current.summary.totalSuccessful - baseline.summary.totalSuccessful,
      totalFailed: current.summary.totalFailed - baseline.summary.totalFailed,
      overallRequestsPerSecond: current.summary.overallRequestsPerSecond - baseline.summary.overallRequestsPerSecond,
      averageResponseTime: current.summary.averageResponseTime - baseline.summary.averageResponseTime,
      p95ResponseTime: (current.summary.responseTimePercentiles?.p95 || 0) - (baseline.summary.responseTimePercentiles?.p95 || 0),
      p99ResponseTime: (current.summary.responseTimePercentiles?.p99 || 0) - (baseline.summary.responseTimePercentiles?.p99 || 0)
    },
    endpointDeltas
  };
}

function formatSigned(value: number, decimals: number = 2): string {
  const formatted = value.toFixed(decimals);
  return value >= 0 ? `+${formatted}` : formatted;
}

function getReporterExtension(type: string): string {
  const normalized = type.trim().toLowerCase();
  switch (normalized) {
    case 'json':
      return 'json';
    case 'csv':
      return 'csv';
    case 'html':
      return 'html';
    case 'junit':
      return 'xml';
    default:
      return 'out';
  }
}

const program = new Command();

program
  .name('glockit')
  .description('A tool to benchmark REST APIs with request chaining capabilities')
  .version('1.0.9');

program
  .command('import')
  .description('Import benchmark config from OpenAPI, Postman, or HAR')
  .requiredOption('-i, --input <file>', 'Input source file path')
  .option('-t, --type <type>', 'Source type: auto, openapi, postman, har', 'auto')
  .option('-o, --output <file>', 'Output benchmark file path (JSON/YAML)', 'benchmark.imported.json')
  .action((options) => {
    try {
      if (!fs.existsSync(options.input)) {
        console.error(chalk.red(`❌ Input file not found: ${options.input}`));
        process.exit(1);
      }

      const sourceType = typeof options.type === 'string' ? options.type.toLowerCase() : 'auto';
      if (!['auto', 'openapi', 'postman', 'har'].includes(sourceType)) {
        console.error(chalk.red('❌ Invalid import type. Use one of: auto, openapi, postman, har'));
        process.exit(1);
      }

      const typedSourceType: ImportSourceType | undefined = sourceType === 'auto'
        ? undefined
        : sourceType as ImportSourceType;

      const imported = importBenchmarkConfig({
        filePath: options.input,
        sourceType: typedSourceType
      });
      const validated = ConfigValidator.validate(imported);

      const outputPath = options.output;
      const isYamlOutput = outputPath.endsWith('.yaml') || outputPath.endsWith('.yml');
      const content = isYamlOutput
        ? yaml.dump(validated)
        : JSON.stringify(validated, null, 2);

      fs.writeFileSync(outputPath, content, 'utf8');
      console.log(chalk.green(`✅ Imported benchmark config written to: ${outputPath}`));
      console.log(chalk.blue(`   Endpoints imported: ${validated.endpoints.length}`));
    } catch (error) {
      console.error(chalk.red('❌ Failed to import benchmark config:'));
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown import error'));
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run benchmark from configuration file')
  .option('-c, --config <file>', 'Configuration file path (JSON/YAML)', 'benchmark.json')
  .option('-o, --output <dir>', 'Output directory for results (only used with --save, defaults to current directory)', '.')
  .option('--no-progress', 'Disable progress bar and use simple console output', false)
  .option('-d, --delay <ms>', 'Delay between requests in milliseconds', '0')
  .option('--save', 'Save results to files in the current directory', false)
  .option('--reporters <list>', 'Comma-separated reporters to save (e.g. json,csv,html,junit)')
  .option('--compare-with <file>', 'Compare current run with a previous JSON benchmark result file')
  .option('--preview-feeder [count]', 'Preview loaded feeder rows before running benchmark (default: 5)')
  .option('--preview-feeder-only [count]', 'Preview feeder rows and exit without running benchmark')
  .option('--no-fail-on-slo', 'Do not exit with non-zero code when SLO checks fail')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔥 Glockit Starting...'));
      
      // Check if config file exists
      if (!fs.existsSync(options.config)) {
        console.error(chalk.red(`❌ Configuration file not found: ${options.config}`));
        console.log(chalk.yellow('💡 Create a benchmark.json or benchmark.yaml file with your API endpoints configuration.'));
        process.exit(1);
      }

      // Load and validate configuration
      const configData = fs.readFileSync(options.config, 'utf8');
      const isYaml = options.config.endsWith('.yaml') || options.config.endsWith('.yml');
      
      let parsedConfig;
      try {
        if (isYaml) {
          parsedConfig = yaml.load(configData);
        } else {
          parsedConfig = JSON.parse(configData);
        }
      } catch (parseError) {
        const format = isYaml ? 'YAML' : 'JSON';
        console.error(chalk.red(`❌ Invalid ${format} in configuration file:`));
        console.error(chalk.red(parseError instanceof Error ? parseError.message : `Unknown ${format} parsing error`));
        process.exit(1);
      }
      
      let config: BenchmarkConfig;
      try {
        config = ConfigValidator.validate(parsedConfig);
      } catch (validationError) {
        if (validationError instanceof ConfigValidationError) {
          console.error(chalk.red('❌ Configuration validation failed:'));
          console.error(chalk.red(validationError.message));
          console.log(chalk.yellow('\n💡 Use "glockit example" to generate a valid configuration template.'));
        } else {
          console.error(chalk.red('❌ Unexpected validation error:'), validationError);
        }
        process.exit(1);
      }
      
      // Create output directory
      if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
      }

      console.log(chalk.green(`📋 Configuration loaded: ${config.endpoints.length} endpoints`));
      
      // Parse delay
      const delay = parseInt(options.delay, 10) || 0;
      if (delay > 0) {
        console.log(chalk.yellow(`⏳ Adding ${delay}ms delay between requests`));
      }

      // Run benchmark with progress tracking
      const bench = new Glockit({
        delay,
        progress: options.progress !== false,
        dryRun: false // Could be added as CLI option in the future
      });

      const previewOptionValue = options.previewFeederOnly !== undefined
        ? options.previewFeederOnly
        : options.previewFeeder;
      const shouldExitAfterPreview = options.previewFeederOnly !== undefined;

      if (previewOptionValue !== undefined) {
        const previewCount = typeof previewOptionValue === 'string'
          ? Math.max(0, parseInt(previewOptionValue, 10) || 5)
          : 5;

        if (!config.global?.dataFeeder) {
          console.log(chalk.yellow('ℹ️  No global dataFeeder is configured to preview.'));
        } else {
          const rows = bench.previewDataFeeder(config.global.dataFeeder, previewCount);
          console.log(chalk.green(`\n📦 Data Feeder Preview (${rows.length} row(s)):`));
          rows.forEach((row, idx) => {
            console.log(chalk.blue(`   [${idx}] ${JSON.stringify(row)}`));
          });
        }

        if (shouldExitAfterPreview) {
          console.log(chalk.green('✅ Feeder preview complete. Exiting without running benchmark.'));
          return;
        }
      }

      const results = await bench.run(config);
      
      // Save results if --save flag is set
      if (options.save) {
        const outputDir = options.output || '.'; // Use current directory if no output specified
        
        // Ensure output directory exists if it's not the current directory
        if (outputDir !== '.' && !fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const configReporters = config.global?.reporters || [];
        const cliReporterTypes = typeof options.reporters === 'string'
          ? options.reporters.split(',').map((entry: string) => entry.trim()).filter((entry: string) => entry.length > 0)
          : [];

        let reportOutputs: ReporterOutputConfig[];

        if (cliReporterTypes.length > 0) {
          reportOutputs = cliReporterTypes.map((type: string) => ({
            type,
            path: path.join(outputDir, `benchmark-${timestamp}.${getReporterExtension(type)}`)
          }));
        } else if (configReporters.length > 0) {
          reportOutputs = configReporters.map(reporter => ({
            ...reporter,
            path: reporter.path || path.join(outputDir, `benchmark-${timestamp}.${getReporterExtension(reporter.type)}`)
          }));
        } else {
          reportOutputs = ['json', 'csv', 'html'].map(type => ({
            type,
            path: path.join(outputDir, `benchmark-${timestamp}.${getReporterExtension(type)}`)
          }));
        }

        await bench.saveWithReporters(results, reportOutputs);
        
        if (options.progress === false) {
          const outputPath = outputDir === '.' ? 'current directory' : outputDir;
          const outputTypes = reportOutputs.map(output => output.type).join(', ');
          console.log(chalk.blue(`📊 Results saved (${outputTypes}) to: ${outputPath}`));
        }
      } else if (options.progress === false) {
        console.log(chalk.yellow('ℹ️  Results not saved (use --save to save results)'));
      }
      
      if (options.progress === false) {
        console.log(chalk.green('✅ Benchmark completed!'));
      }
      
      // Print summary
      const summary = results.summary;
      console.log(chalk.green('\n📈 Benchmark Summary:'));
      console.log(chalk.blue(`   Total Requests: ${summary.totalRequests}`));
      console.log(chalk.green(`   Successful: ${summary.totalSuccessful}`));
      console.log(chalk.red(`   Failed: ${summary.totalFailed}`));
      console.log(chalk.blue(`   Total Duration: ${(summary.totalDuration / 1000).toFixed(2)}s`));
      console.log(chalk.blue(`   Requests/Second: ${summary.overallRequestsPerSecond.toFixed(2)}`));
      console.log(chalk.blue(`   Avg. Response Time: ${summary.averageResponseTime.toFixed(2)}ms`));
      console.log(chalk.blue(`   P95 Response Time: ${summary.responseTimePercentiles.p95.toFixed(2)}ms`));
      console.log(chalk.blue(`   P99 Response Time: ${summary.responseTimePercentiles.p99.toFixed(2)}ms`));

      if (summary.coordinatedOmission?.enabled) {
        console.log(
          chalk.blue(
            `   CO Correction: enabled (interval=${summary.coordinatedOmission.expectedIntervalMs.toFixed(2)}ms, syntheticSamples=${summary.coordinatedOmission.appliedSamples})`
          )
        );
      }

      if (summary.slo) {
        if (summary.slo.passed) {
          console.log(chalk.green('   SLO Status: PASSED'));
        } else {
          console.log(chalk.red('   SLO Status: FAILED'));
          for (const failure of summary.slo.failures) {
            console.log(chalk.red(`   - ${failure}`));
          }
        }
      }

      if (results.observability?.prometheus?.endpoint) {
        console.log(chalk.blue(`   Prometheus Endpoint: ${results.observability.prometheus.endpoint}`));
      }

      if (results.observability?.otel) {
        if (results.observability.otel.exported) {
          console.log(chalk.green(`   OpenTelemetry Export: OK${results.observability.otel.endpoint ? ` (${results.observability.otel.endpoint})` : ''}`));
        } else {
          console.log(chalk.red(`   OpenTelemetry Export: FAILED${results.observability.otel.error ? ` (${results.observability.otel.error})` : ''}`));
        }
      }

      if (results.observability?.otelTraces) {
        if (results.observability.otelTraces.exported) {
          console.log(chalk.green(`   OpenTelemetry Traces: OK${results.observability.otelTraces.endpoint ? ` (${results.observability.otelTraces.endpoint})` : ''}`));
        } else {
          console.log(chalk.red(`   OpenTelemetry Traces: FAILED${results.observability.otelTraces.error ? ` (${results.observability.otelTraces.error})` : ''}`));
        }
      }

      if ((results.observability?.warnings || []).length > 0) {
        console.log(chalk.yellow('   Observability Warnings:'));
        for (const warning of results.observability!.warnings) {
          console.log(chalk.yellow(`   - ${warning}`));
        }
      }

      if (results.distributed) {
        console.log(chalk.green('\n🌐 Distributed Execution:'));
        console.log(chalk.blue(`   Role: ${results.distributed.role}`));
        if (results.distributed.workerId) {
          console.log(chalk.blue(`   Worker ID: ${results.distributed.workerId}`));
        }
        if (results.distributed.coordinatorUrl) {
          console.log(chalk.blue(`   Coordinator: ${results.distributed.coordinatorUrl}`));
        }
        if (results.distributed.workersTotal !== undefined) {
          console.log(chalk.blue(`   Workers: ${results.distributed.workersCompleted ?? 0}/${results.distributed.workersTotal}`));
        }
        if (results.distributed.workerCompletedLeaseCounts && Object.keys(results.distributed.workerCompletedLeaseCounts).length > 0) {
          const leaseCounts = Object.entries(results.distributed.workerCompletedLeaseCounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([workerId, completed]) => `${workerId}:${completed}`)
            .join(', ');
          console.log(chalk.blue(`   Worker Lease Completions: ${leaseCounts}`));
        }
      }

      if (summary.transactionGroups && summary.transactionGroups.length > 0) {
        console.log(chalk.green('\n🧩 Transaction Groups:'));
        for (const group of summary.transactionGroups) {
          console.log(
            chalk.blue(
              `   - ${group.name}: total=${group.totalRequests}, success=${group.successfulRequests}, failed=${group.failedRequests}, avg=${group.averageResponseTime.toFixed(2)}ms, p95=${group.responseTimePercentiles.p95.toFixed(2)}ms, rps=${group.requestsPerSecond.toFixed(2)}`
            )
          );
        }
      }

      if (summary.diagnostics) {
        console.log(chalk.green('\n🛠️ Failure Diagnostics:'));
        console.log(
          chalk.blue(
            `   sampled=${summary.diagnostics.sampledFailures}/${summary.diagnostics.totalFailures}`
          )
        );
      }

      const endpointsWithPhases = results.results.filter(r => r.phaseResults && r.phaseResults.length > 0);
      if (endpointsWithPhases.length > 0) {
        console.log(chalk.green('\n🧭 Phase Summary:'));
        for (const endpoint of endpointsWithPhases) {
          console.log(chalk.blue(`   Endpoint: ${endpoint.name}`));
          for (const phase of endpoint.phaseResults || []) {
            console.log(
              chalk.blue(
                `   - ${phase.name}: total=${phase.totalRequests}, success=${phase.successfulRequests}, failed=${phase.failedRequests}, rps=${phase.requestsPerSecond.toFixed(2)}, duration=${phase.durationMs.toFixed(0)}ms`
              )
            );
          }
        }
      }

      if (options.compareWith) {
        if (!fs.existsSync(options.compareWith)) {
          console.error(chalk.red(`❌ Compare file not found: ${options.compareWith}`));
          process.exit(1);
        }

        const baselineRaw = fs.readFileSync(options.compareWith, 'utf8');
        const baseline = JSON.parse(baselineRaw) as BenchmarkResult;
        const comparison = buildComparisonReport(baseline, results);

        console.log(chalk.green('\n📊 Comparison vs Baseline:'));
        console.log(chalk.blue(`   Avg Response Time Delta: ${formatSigned(comparison.summaryDelta.averageResponseTime)}ms`));
        console.log(chalk.blue(`   P95 Delta: ${formatSigned(comparison.summaryDelta.p95ResponseTime)}ms`));
        console.log(chalk.blue(`   P99 Delta: ${formatSigned(comparison.summaryDelta.p99ResponseTime)}ms`));
        console.log(chalk.blue(`   RPS Delta: ${formatSigned(comparison.summaryDelta.overallRequestsPerSecond)}`));

        const topRegressions = comparison.endpointDeltas.slice(0, 3);
        if (topRegressions.length > 0) {
          console.log(chalk.yellow('   Top Endpoint Regressions (by avg latency):'));
          for (const delta of topRegressions) {
            console.log(chalk.yellow(`   - ${delta.name}: avg ${formatSigned(delta.avgResponseTimeDeltaMs)}ms, p95 ${formatSigned(delta.p95DeltaMs)}ms, rps ${formatSigned(delta.requestsPerSecondDelta)}`));
          }
        }
      }

      if (summary.slo && !summary.slo.passed && options.failOnSlo !== false) {
        process.exit(2);
      }
      
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        // This should already be handled above, but just in case
        console.error(chalk.red('❌ Configuration error:'), error.message);
      } else {
        console.error(chalk.red('❌ Error running benchmark:'));
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
        if (error instanceof Error && error.stack) {
          console.error(chalk.gray('Stack trace:'), error.stack);
        }
      }
      process.exit(1);
    }
  });

program
  .command('example')
  .description('Generate an example configuration file')
  .option('-o, --output <file>', 'Output file path (JSON or YAML)', 'benchmark.json')
  .action((options) => {
    const exampleConfig = Glockit.generateExampleConfig();
    const isYaml = options.output.endsWith('.yaml') || options.output.endsWith('.yml');
    
    let content: string;
    if (isYaml) {
      content = yaml.dump(exampleConfig);
    } else {
      content = JSON.stringify(exampleConfig, null, 2);
    }
    
    fs.writeFileSync(options.output, content);
    console.log(chalk.green(`✅ Example configuration saved to: ${options.output}`));
  });

// Add help command
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}