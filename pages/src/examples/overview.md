# Examples Overview

Use this page to choose the right example quickly.

## Decision matrix

| Goal | Start here | Why |
| --- | --- | --- |
| Validate endpoint availability fast | [HTTP Smoke and Load](http-smoke-and-load.md) | Includes a minimal smoke profile and a steady-state load profile |
| Verify WebSocket request/response behavior | [WebSocket Check](websocket-check.md) | Shows message payloads and response timeout handling |
| Benchmark unary gRPC methods | [gRPC Unary](grpc-unary.md) | Covers proto path, package, metadata, and deadlines |
| Scale tests across workers | [Distributed Coordinator and Workers](distributed-coordinator-workers.md) | Includes coordinator and worker configs with lease controls |
| Bootstrap from API contract files | [Import OpenAPI to Benchmark](import-openapi-to-benchmark.md) | Demonstrates import and post-import refinement |
| Publish CI test and report artifacts | [CI Reporting Workflow](ci-reporting-workflow.md) | Combines JSON, JUnit, and HTML reporting in one flow |
| Use an all-features reference setup | [Complete Setups](complete-setups.md) | Full reference configs for broad feature coverage |

## Common paths

### Path A: New project onboarding

1. Start with [Import OpenAPI to Benchmark](import-openapi-to-benchmark.md).
2. Run a quick check from [HTTP Smoke and Load](http-smoke-and-load.md).
3. Add CI outputs from [CI Reporting Workflow](ci-reporting-workflow.md).

### Path B: Protocol-focused validation

1. Pick [WebSocket Check](websocket-check.md) or [gRPC Unary](grpc-unary.md).
2. Add SLO thresholds and HTML reporting.
3. Compare results against a baseline JSON output.

### Path C: High-scale distributed runs

1. Apply [Distributed Coordinator and Workers](distributed-coordinator-workers.md).
2. Keep lease size conservative and observe worker completion counts.
3. Move to load profiles in [HTTP Smoke and Load](http-smoke-and-load.md).

## By team role

### QA engineer

1. Start with [HTTP Smoke and Load](http-smoke-and-load.md) for basic coverage.
2. Add pass/fail visibility with [CI Reporting Workflow](ci-reporting-workflow.md).
3. Use [Complete Setups](complete-setups.md) when validating advanced options.

### Backend engineer

1. Bootstrap from contracts using [Import OpenAPI to Benchmark](import-openapi-to-benchmark.md).
2. Validate protocol behavior with [WebSocket Check](websocket-check.md) or [gRPC Unary](grpc-unary.md).
3. Calibrate endpoint assertions in your imported benchmark.

### Platform engineer

1. Use [Distributed Coordinator and Workers](distributed-coordinator-workers.md) for horizontal execution.
2. Tune worker lease controls and heartbeat intervals.
3. Feed stable outputs into [CI Reporting Workflow](ci-reporting-workflow.md).

### SRE

1. Begin with [HTTP Smoke and Load](http-smoke-and-load.md) and add strict SLO thresholds.
2. Run distributed scenarios from [Distributed Coordinator and Workers](distributed-coordinator-workers.md).
3. Publish trend artifacts with [CI Reporting Workflow](ci-reporting-workflow.md).

## Example

```bash
# Pick a scenario page config and execute
glockit run --config ./examples/http-smoke.json
```

