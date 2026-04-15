# Architecture

## High-level flow

1. CLI loads and validates configuration.
2. Benchmark engine resolves dependencies and runtime context.
3. Requests execute through selected transport engine.
4. Metrics, diagnostics, and optional telemetry are collected.
5. Results are aggregated and written through reporters.

## Main modules

- src/index.ts: benchmark orchestration and request loop
- src/runtime: transport execution, importers, feeder, traffic, dependency resolution
- src/metrics: analytics and reporting orchestration
- src/templates/reporting: HTML and JUnit template builders
- src/distributed: coordinator and worker distributed runtime
- src/observability: Prometheus and OTEL integration
- src/types: contracts and validator

## Reporting architecture

- Metrics/reporting delegates rendering to template modules.
- HTML report provides interactive client-side behavior.
- JUnit report supports CI test-style consumption.

## Distributed architecture

- Coordinator exposes join, heartbeat, plan, result, and status routes.
- Work is leased to workers and merged on completion.
- Stale worker handling requeues active assignments.

## Example

```text
CLI -> Config Validator -> Scheduler/Executor -> Metrics -> Reporters -> Optional Observability Export
```

```bash
glockit run --config benchmark.json --save --reporters json,html,junit
```

