# Quick Start

## Prerequisites

- Node.js 18 or newer
- A benchmark config file in JSON or YAML

## Install and build

```bash
npm install
npm run build
```

## Generate a starter config

```bash
glockit example -o benchmark.json
```

## Run a benchmark

```bash
glockit run -c benchmark.json
```

## Save reports

```bash
glockit run -c benchmark.json --save --reporters json,csv,html,junit
```

## Import existing API definitions

```bash
glockit import -i openapi.yaml --type openapi -o benchmark.imported.json
glockit import -i collection.json --type postman -o benchmark.imported.json
glockit import -i traffic.har --type har -o benchmark.imported.json
```

## Common next steps

- Tune concurrency, duration, and request delay
- Add assertions and response checks
- Enable diagnostics and observability
- Move to distributed mode for large workloads

## Practical examples

- Start with [Examples Overview](examples/overview.md) to pick a scenario by outcome.
- For HTTP smoke and load patterns, see [HTTP Smoke and Load](examples/http-smoke-and-load.md)
- For WebSocket checks, see [WebSocket Check](examples/websocket-check.md)
- For gRPC unary runs, see [gRPC Unary](examples/grpc-unary.md)
- For coordinator/worker distributed runs, see [Distributed Coordinator and Workers](examples/distributed-coordinator-workers.md)
- For import-driven workflows, see [Import OpenAPI to Benchmark](examples/import-openapi-to-benchmark.md)
- For CI artifact publishing, see [CI Reporting Workflow](examples/ci-reporting-workflow.md)

## Example

```bash
# First run (baseline)
glockit run --config benchmark.json --save

# Compare another run with saved baseline output
glockit run --config benchmark.json --compare-with ./benchmark-latest.json
```

