# Introduction

Glockit is a benchmarking tool for API workloads. It supports:

- HTTP request benchmarking with chaining, variables, hooks, and assertions
- WebSocket request/response benchmarking
- Unary gRPC benchmarking via proto-based client execution
- Distributed coordinator-worker benchmarking
- OpenAPI, Postman, and HAR import into runnable benchmark configs
- Rich output formats including JSON, CSV, HTML, and JUnit
- Interactive HTML reporting with filtering, sorting, charts, and endpoint drilldowns

This book is designed to be operationally complete. It covers both feature usage and implementation-level constraints from the validator and runtime behavior.

## Who this is for

- Performance engineers validating latency, throughput, and reliability
- API teams creating repeatable benchmark scenarios for CI/CD
- Platform teams running distributed benchmark jobs
- Developers importing existing API definitions into benchmark configs

## What you will find here

- End-to-end setup and CLI usage
- Complete configuration model and constraints
- Transport-specific details for HTTP, WebSocket, and gRPC
- Distributed mode behavior and leasing model
- Observability and diagnostics guidance
- Production-ready example configurations

## Example

```json
{
  "name": "intro-example",
  "global": { "baseUrl": "https://api.example.com", "maxRequests": 10, "concurrent": 2 },
  "endpoints": [{ "name": "health", "url": "/health", "method": "GET" }]
}
```

```bash
glockit run --config benchmark.json
```

