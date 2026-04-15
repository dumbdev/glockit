# Glockit

## Overview

Glockit is a lightweight TypeScript CLI and library for benchmarking REST APIs. It supports advanced request chaining, authorization dependencies, concurrent execution, variable extraction, and outputs results in JSON, CSV, and HTML formats. The tool features a clean, minimal-dependency console interface for real-time progress tracking.


## Table of Contents
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Programmatic Usage](#programmatic-usage)
- [Configuration Reference](#configuration-reference)
- [Variable Extraction](#variable-extraction)
- [Dynamic Variables & Functions](#dynamic-variables--functions)
- [Pre/Post Request Hooks](#prepost-request-hooks)
- [Summary Mode](#summary-mode)
- [API Response Result Check](#api-response-result-check)
- [Authorization Dependencies](#authorization-dependencies)
- [Output Formats](#output-formats)
- [API Reference](#api-reference)
- [License](#license)

## Features

- **Configuration-driven**: Define benchmarks in simple JSON files.
- **Real-time Progress Tracking**: Clean console-based progress bars showing request status without clearing your terminal scrollback.
- **Request Chaining**: Extract variables from responses and use them in subsequent requests.
- **Authorization Dependencies**: Handle complex auth flows (like OAuth2) once and share credentials across multiple endpoints.
- **Concurrent Execution**: Run multiple requests in parallel with configurable concurrency.
- **Response Assertions**: Validate response status, body content, and headers.
- **Response Result Checks**: Perform "soft" validations that record pass/fail status without stopping the benchmark.
- **Flexible Execution Modes**: Supports both request-count and duration-based benchmarking.
- **Automatic Retries**: Configurable retry mechanism with exponential backoff for flaky endpoints.
- **Minimal Dependencies**: Optimized for performance and reliability.
- **Multi-format Output**: Generates detailed JSON, CSV, and **HTML** reports with timing and size metrics.
- **Pluggable Reporters**: Built-in `json`, `csv`, `html`, and `junit` reporters, plus custom sinks via `registerReporter`.
- **Cross-Platform Support**: Works in Node.js and Browser environments via a platform abstraction layer.
- **Security-conscious Logging**: Automatically sanitizes sensitive data (like tokens and passwords) in logs.
- **Observability Ready**: Optional Prometheus endpoint and OpenTelemetry OTLP metrics and traces export.

## Installation

### Global Installation (CLI)
```sh
npm install -g glockit
```

### Local Installation (Library)
```sh
npm install glockit
```

## Quick Start

1. Create a `benchmark.json` file:

```json
{
  "name": "Quick API Test",
  "global": {
    "baseUrl": "https://api.example.com",
    "maxRequests": 50,
    "concurrent": 5
  },
  "endpoints": [
    {
      "name": "Health Check",
      "url": "/health",
      "method": "GET",
      "assertions": [
        { "path": "status", "operator": "equals", "value": "OK" }
      ]
    }
  ]
}
```

2. Run the benchmark:

```sh
npx glockit run --config benchmark.json --save
```

## CLI Usage

```sh
glockit run [options]
```

**Options:**
- `-c, --config <file>`: Configuration file path (JSON or YAML, default: `benchmark.json`).
- `-o, --output <dir>`: Output directory for results (default: `.`).
- `--no-progress`: Disable real-time progress bar.
- `-d, --delay <ms>`: Delay between requests.
- `--save`: Save results to `.json`, `.csv`, and `.html` files.
- `--reporters <list>`: Comma-separated reporters to save (for example: `json,csv,html,junit`).
- `--compare-with <file>`: Compare the current run with a previous benchmark JSON result.
- `--preview-feeder [count]`: Preview feeder rows before benchmark run (default: 5).
- `--preview-feeder-only [count]`: Preview feeder rows and exit without running benchmark.
- `--no-fail-on-slo`: Do not exit with non-zero status when SLO checks fail.
- `-v, --version`: Show version number.

When observability is enabled in configuration, Glockit will also print exporter status in the benchmark summary.

## Programmatic Usage

Glockit can be integrated into your TypeScript projects.

### Node.js
By default, Glockit uses the `NodePlatform`.

```typescript
import { Glockit, BenchmarkConfig } from 'glockit';

async function run() {
  const config: BenchmarkConfig = {
    endpoints: [
      { name: 'Home', url: 'https://example.com', method: 'GET' }
    ],
    global: { maxRequests: 10 }
  };

  const benchmark = new Glockit({ progress: true });
  const results = await benchmark.run(config);
  
  console.log(`Success rate: ${results.summary.totalSuccessful / results.summary.totalRequests * 100}%`);
}

run();
```

### Browser
To use Glockit in the browser, provide the `BrowserPlatform` in the options.

```typescript
import { Glockit, BrowserPlatform } from 'glockit';

const benchmark = new Glockit({ 
  platform: new BrowserPlatform(),
  progress: false // Progress bar is optimized for CLI
});
```

### Custom Platform
You can also implement the `Platform` interface to support other environments or mock behavior for testing.

## Configuration Reference

- `name` (string): Benchmark name
- `description` (string): Description
- `global` (object): Global settings
  - `baseUrl` (string): Base URL for endpoints.
  - `maxRequests` (number): Total requests to perform across all endpoints.
  - `duration` (number): Duration in ms to run the benchmark (alternative to `maxRequests`).
  - `throttle` (number): Throttle rate (requests per second).
  - `concurrent` (number): Number of concurrent requests (default: 1).
  - `timeout` (number): Request timeout in ms (default: 5000).
  - `requestDelay` (number): Delay in ms between requests.
  - `executor` (string): Scheduling mode: `concurrency` (default) or `arrival-rate`.
  - `arrivalRate` (number): Target requests/second when using `arrival-rate` executor.
  - `loadShape` (object): Optional rate curve applied to `arrivalRate`.
    - `mode` (string): `step`, `burst`, or `jitter`.
    - `steps` (array, mode=`step`): sequence of `{ afterMs, rate }` transitions.
    - `burstIntervalMs` (number, mode=`burst`): burst cycle length.
    - `burstDurationMs` (number, mode=`burst`): active burst window per cycle.
    - `burstMultiplier` (number, mode=`burst`): multiplier applied during burst window.
    - `jitterRatio` (number, mode=`jitter`): random variation ratio from `0` to `1`.
  - `phases` (array): Optional sequential load phases for timed traffic.
    - `name` (string): Phase label (e.g., `warmup`, `steady`).
    - `duration` (number): Phase duration in ms.
    - `concurrent` (number): Optional phase-specific concurrency.
    - `throttle` (number): Optional phase-specific throttle delay in ms.
    - `requestDelay` (number): Optional phase-specific request delay in ms.
    - `arrivalRate` (number): Optional phase-specific target requests/second.
  - `dataFeeder` (object): Optional external test data source.
    - `path` (string): Path to CSV or JSON file.
    - `format` (string): `csv` or `json`.
    - `strategy` (string): `sequential` (default) or `random`.
    - CSV supports quoted values and escaped quotes (`""`).
  - `headers` (object): Global request headers.
  - `slo` (object): Optional CI quality gates.
    - `maxErrorRate` (number): Maximum allowed error rate from 0 to 1.
    - `maxAvgResponseTimeMs` (number): Maximum allowed average response time.
    - `p95Ms` (number): Maximum allowed p95 response time.
    - `p99Ms` (number): Maximum allowed p99 response time.
    - `minRequestsPerSecond` (number): Minimum required throughput.
  - `coordinatedOmission` (object): Optional latency percentile correction.
    - `enabled` (boolean): Enables coordinated omission correction.
    - `expectedIntervalMs` (number): Expected request interval for correction.
      - If omitted, Glockit derives it from `arrivalRate` when available.
  - `scenarioMix` (object): Optional weighted multi-scenario execution mode.
    - `enabled` (boolean): Enables scenario-mix mode.
    - `strategy` (string): `weighted-random` (default behavior).
    - `scenarios` (array): Weighted scenario definitions.
      - `name` (string): Scenario label.
      - `weight` (number): Relative scenario selection probability (default: 1).
      - `flow` (array): Ordered list of endpoint names to execute as one scenario journey.
  - `virtualUsers` (object): Optional per-worker session behavior.
    - `sessionScope` (boolean): Isolates variables per worker session.
    - `persistCookies` (boolean): Stores and replays cookies per session.
  - `transactionGroups` (array): Optional grouped user-journey metrics.
    - `name` (string): Group label (for example `checkout-journey`).
    - `endpoints` (array): Ordered endpoint names included in this transaction.
  - `diagnostics` (object): Optional sampled failure diagnostics.
    - `enabled` (boolean): Enables diagnostics collection for failed requests.
    - `sampleSize` (number): Maximum failure samples retained in summary.
    - `maskKeys` (array): Case-insensitive keys to mask in headers/bodies.
    - `maxBodyLength` (number): Maximum serialized body length retained.
    - `includeHeaders` (boolean): Include request/response headers in diagnostics samples.
  - `observability` (object): Optional exporters.
    - `prometheus` (object): Prometheus-compatible text exposition endpoint.
      - `enabled` (boolean): Enables Prometheus endpoint server.
      - `host` (string): Bind host (default: `127.0.0.1`).
      - `port` (number): Bind port, supports `0` for random free port (default: `9464`).
      - `path` (string): Exposition path (default: `/metrics`).
      - `keepAlive` (boolean): If `false`, server is unref'd so it does not keep CLI process alive.
    - `otel` (object): OpenTelemetry OTLP metric export.
      - `enabled` (boolean): Enables OTLP export.
      - `endpoint` (string): OTLP HTTP metrics endpoint (e.g. `http://localhost:4318/v1/metrics`).
      - `headers` (object): Optional OTLP HTTP headers.
      - `intervalMs` (number): Export interval for metric reader (minimum `1000`).
      - `serviceName` (string): `service.name` resource attribute (default: `glockit`).
      - `attributes` (object): Additional resource attributes.
      - `traces` (object): Optional OTLP traces export.
        - `enabled` (boolean): Enables OTLP trace export.
        - `endpoint` (string): OTLP HTTP traces endpoint (e.g. `http://localhost:4318/v1/traces`).
        - `headers` (object): Optional OTLP HTTP headers for traces.
        - `serviceName` (string): Trace `service.name` override.
        - `attributes` (object): Additional trace resource attributes.
        - `samplingRatio` (number): Sampling ratio from `0` to `1`.
  - `reporters` (array): Optional reporter outputs for saved benchmark artifacts.
    - `type` (string): Reporter key (`json`, `csv`, `html`, `junit`, or registered custom reporter).
    - `path` (string): Output destination path (optional; CLI can auto-generate one).
    - `options` (object): Reporter-specific options passed to custom reporters.
  - `distributed` (object): Optional coordinator/worker distributed execution.
    - `enabled` (boolean): Enables distributed mode.
    - `role` (string): `coordinator` or `worker`.
    - `coordinatorUrl` (string): Required for worker role.
    - `workerId` (string): Optional worker identifier.
    - `expectedWorkers` (number): Required for coordinator role.
    - `host` (string): Coordinator bind host (default: `127.0.0.1`).
    - `port` (number): Coordinator bind port (default: `9876`, supports `0`).
    - `joinTimeoutMs` (number): Wait time for worker join.
    - `resultTimeoutMs` (number): Wait time for worker results.
    - `pollIntervalMs` (number): Worker poll interval while waiting for assignment.
    - `heartbeatIntervalMs` (number): Worker heartbeat interval to coordinator.
    - `staleWorkerTimeoutMs` (number): Coordinator stale worker timeout.
    - `authToken` (string): Optional shared token required by coordinator endpoints.
    - `authHeaderName` (string): Header key used for auth token exchange (default: `x-glockit-token`).
    - `resultSubmitRetries` (number): Worker retry count for submitting final result (default: `3`).
    - `resultSubmitBackoffMs` (number): Base exponential backoff for submit retries in ms (default: `1000`).
    - `leaseBatchSize` (number): Endpoints leased per plan response (default: `1`).
    - `assignmentStrategy` (string): Lease scheduler strategy: `round-robin` or `least-loaded`.
    - `partitionStrategy` (string): `round-robin`.
- `endpoints` (array): List of endpoint configurations.
  - `name` (string): Unique identifier for the endpoint.
  - `url` (string): Endpoint path (relative to `baseUrl`).
  - `method` (string): HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`).
  - `headers` (object): Request headers (merges with global headers).
  - `body` (any): Request body.
  - `query` (object): Query parameters.
  - `maxRequests`, `throttle`, `requestDelay`: Endpoint-specific overrides.
  - `variables` (array): List of `VariableConfig` objects to extract from responses.
  - `dependencies` (array): List of endpoint names that must complete before this one starts.
  - `weight` (number): Relative frequency of this endpoint (default: 1).
  - `assertions` (array): List of `AssertionConfig` objects to validate responses.
  - `responseCheck` (array): List of `ResponseCheckConfig` objects for soft validation.
  - `retries` (number): Number of retries on failure (uses exponential backoff).
  - `auth` (object): `AuthDependencyConfig` for pre-requisite auth flows.

### Query Parameters

Query parameters can be defined as an object in the `endpoint` or `global` configuration. They are automatically encoded and appended to the URL. Dynamic variables are supported.

```json
{
  "query": {
    "search": "{{$randomWord}}",
    "page": 1,
    "active": true
  }
}
```

### Variable Extraction

Extract values from responses using dot-notation paths to use in subsequent requests.

- **Sources**: Extract from `response` (body), `headers`, or `cookies`.
- **Paths**: Use dot-notation for nested objects and arrays (e.g., `data.items.0.id`).
- **Scoping**: Variables extracted during a benchmark are available to all subsequent requests.

```json
{
  "variables": [
    {
      "name": "userId",
      "path": "user.id",
      "from": "response"
    },
    {
      "name": "authHeader",
      "path": "authorization",
      "from": "headers"
    },
    {
      "name": "sessionId",
      "path": "session_id",
      "from": "cookies"
    }
  ]
}
```

### Response Handling

- **JSON**: If the response is JSON, it is automatically parsed, and variables can be extracted using dot-notation paths.
- **Text**: If the response is not JSON, it is treated as a string.
- **Binary**: For binary data, `getObjectSizeKB` uses the `Content-Length` header or calculates the buffer size.
- **Default Headers**: Glockit uses `axios` and assumes `application/json` for both requests and responses unless overridden.

## Coordinated Omission Correction

When load generators slow down under stress, observed latency percentiles can look artificially optimistic.
Enable coordinated omission correction to compensate by adding synthetic latency samples based on the expected request interval.

```json
{
  "global": {
    "executor": "arrival-rate",
    "arrivalRate": 50,
    "coordinatedOmission": {
      "enabled": true,
      "expectedIntervalMs": 20
    }
  }
}
```

CLI summary will show when correction is active, including interval and number of synthetic samples applied.

## Weighted Scenario Mix

Use `scenarioMix` when you want realistic traffic patterns composed of multiple user journeys with relative weights.

```json
{
  "global": {
    "maxRequests": 200,
    "concurrent": 10,
    "scenarioMix": {
      "enabled": true,
      "strategy": "weighted-random",
      "scenarios": [
        {
          "name": "browse",
          "weight": 4,
          "flow": ["list-products", "get-product"]
        },
        {
          "name": "checkout",
          "weight": 1,
          "flow": ["login", "add-to-cart", "checkout"]
        }
      ]
    }
  },
  "endpoints": [
    { "name": "list-products", "url": "/products", "method": "GET" },
    { "name": "get-product", "url": "/products/1", "method": "GET" },
    { "name": "login", "url": "/auth/login", "method": "POST" },
    { "name": "add-to-cart", "url": "/cart", "method": "POST" },
    { "name": "checkout", "url": "/checkout", "method": "POST" }
  ]
}
```

In this mode, Glockit picks a scenario based on weight and executes its flow sequentially, while workers run scenarios concurrently.

## Virtual User Session Scope

Enable session scope to isolate variables and cookies per worker so one virtual user does not leak state into another.

```json
{
  "global": {
    "concurrent": 10,
    "virtualUsers": {
      "sessionScope": true,
      "persistCookies": true
    }
  }
}
```

When enabled:

- extracted variables are stored per worker session
- `Set-Cookie` headers are captured and sent back as `Cookie` on subsequent requests for that session
- shared global variables remain unchanged for other sessions

## Transaction Grouping

Transaction groups let you aggregate endpoint-level results into journey-level metrics such as browse, login, or checkout flows.

```json
{
  "global": {
    "transactionGroups": [
      {
        "name": "browse-journey",
        "endpoints": ["list-products", "get-product"]
      },
      {
        "name": "checkout-journey",
        "endpoints": ["login", "add-to-cart", "checkout"]
      }
    ]
  }
}
```

Glockit prints transaction-group summary rows in CLI output, including total requests, success/failure counts, average latency, p95 latency, and grouped RPS.

## Failure Diagnostics

Enable diagnostics to capture sampled failed-request payloads for troubleshooting while masking sensitive fields.

```json
{
  "global": {
    "diagnostics": {
      "enabled": true,
      "sampleSize": 20,
      "maskKeys": ["authorization", "password", "token", "cookie"],
      "maxBodyLength": 2000,
      "includeHeaders": true
    }
  }
}
```

When enabled, Glockit reports sampled/total failure counts in CLI summary and includes masked samples in the JSON result summary.

## Load Shape Curves

Load shapes let arrival-rate tests mimic production traffic variation without manually splitting many tiny phases.

Step curve example:

```json
{
  "global": {
    "executor": "arrival-rate",
    "arrivalRate": 10,
    "loadShape": {
      "mode": "step",
      "steps": [
        { "afterMs": 0, "rate": 10 },
        { "afterMs": 30000, "rate": 25 },
        { "afterMs": 60000, "rate": 50 }
      ]
    }
  }
}
```

Burst curve example:

```json
{
  "global": {
    "executor": "arrival-rate",
    "arrivalRate": 20,
    "loadShape": {
      "mode": "burst",
      "burstIntervalMs": 10000,
      "burstDurationMs": 2000,
      "burstMultiplier": 3
    }
  }
}
```

Jitter curve example:

```json
{
  "global": {
    "executor": "arrival-rate",
    "arrivalRate": 40,
    "loadShape": {
      "mode": "jitter",
      "jitterRatio": 0.2
    }
  }
}
```

## Observability Export

Glockit can emit benchmark telemetry in standard formats:

- **Prometheus endpoint** for pull-based scraping.
- **OpenTelemetry OTLP metrics** for push/export to collectors and observability backends.
- **OpenTelemetry OTLP traces** for benchmark run and per-endpoint summary spans.

Example:

```json
{
  "global": {
    "maxRequests": 100,
    "observability": {
      "prometheus": {
        "enabled": true,
        "host": "127.0.0.1",
        "port": 9464,
        "path": "/metrics",
        "keepAlive": false
      },
      "otel": {
        "enabled": true,
        "endpoint": "http://localhost:4318/v1/metrics",
        "serviceName": "glockit-benchmark",
        "attributes": {
          "deployment.environment": "staging"
        },
        "traces": {
          "enabled": true,
          "endpoint": "http://localhost:4318/v1/traces",
          "samplingRatio": 1
        }
      }
    }
  },
  "endpoints": [
    { "name": "Health", "url": "/health", "method": "GET" }
  ]
}
```

## Distributed Worker Mode

Distributed mode supports multi-node execution by leasing endpoint work to workers.

Coordinator config example:

```json
{
  "global": {
    "distributed": {
      "enabled": true,
      "role": "coordinator",
      "host": "127.0.0.1",
      "port": 9876,
      "expectedWorkers": 2,
      "assignmentStrategy": "least-loaded",
      "leaseBatchSize": 2,
      "authToken": "shared-secret",
      "authHeaderName": "x-glockit-token",
      "staleWorkerTimeoutMs": 20000,
      "joinTimeoutMs": 60000,
      "resultTimeoutMs": 300000
    }
  }
}
```

Worker config example:

```json
{
  "global": {
    "distributed": {
      "enabled": true,
      "role": "worker",
      "coordinatorUrl": "http://127.0.0.1:9876",
      "workerId": "worker-a",
      "pollIntervalMs": 500,
      "heartbeatIntervalMs": 5000,
      "authToken": "shared-secret",
      "resultSubmitRetries": 5,
      "resultSubmitBackoffMs": 1200
    }
  }
}
```

Flow:

- workers join coordinator
- workers send heartbeat events while waiting/running
- coordinator leases endpoint assignments to workers on each plan poll (single or batched)
- coordinator can prioritize leases by `assignmentStrategy` (`round-robin` or `least-loaded`)
- workers run assigned endpoints, post results, then pull the next assignment
- coordinator prunes stale workers by timeout, re-queues unfinished endpoints, and merges all completed results into one benchmark summary

### Assertions

Validate that your API is returning the expected data. If an assertion fails, the request is marked as failed.

- **Operators**: `equals`, `contains`, `exists`, `matches` (regex).
- **Paths**: Same dot-notation syntax as variables.

```json
{
  "assertions": [
    { "path": "status", "operator": "equals", "value": "success" },
    { "path": "data.id", "operator": "exists" },
    { "path": "message", "operator": "contains", "value": "created" }
  ]
}
```

### Retries & Exponential Backoff

Handle flaky APIs by configuring retries. Glockit uses exponential backoff (200ms, 400ms, 800ms...) between attempts.

```json
{
  "name": "Reliable Endpoint",
  "url": "/flaky",
  "retries": 3
}
```

### Dynamic Variables & Functions

Glockit supports dynamic variables that are generated uniquely for **each request** to avoid caching and simulate realistic load:

- `{{$uuid}}` or `{{$randomUUID()}}`: Generates a random V4 UUID.
- `{{$randomInt(min, max)}}`: Generates a random integer between min and max (inclusive).
- `{{$randomFrom(['a', 'b', 'c'])}}`: Randomly selects one item from the provided list.
- `{{$randomWord}}`: Generates a random word from a built-in dictionary.
- `{{$env.MY_SECRET_TOKEN}}`: Value from your environment variables (`process.env.MY_SECRET_TOKEN`).

Example usage in URL, headers, or body:
`"url": "/users/{{$randomInt(1, 100)}}"`
`"headers": { "Authorization": "Bearer {{$env.API_KEY}}" }`

## Pre/Post Request Hooks

Glockit allows you to run custom JavaScript snippets before or after each request. This is useful for dynamic request manipulation or custom response processing.

### Pre-request Hook (`beforeRequest`)
Modify the request URL, headers, or body before it's sent.

```json
{
  "name": "Hook Test",
  "url": "/test",
  "method": "POST",
  "beforeRequest": "request.body.timestamp = Date.now(); request.headers['X-Request-ID'] = 'req-' + Math.random().toString(36).substr(2, 9);"
}
```

### Post-request Hook (`afterRequest`)
Access the response data and modify it or set variables for subsequent requests.

```json
{
  "name": "Hook Test",
  "url": "/test",
  "method": "GET",
  "afterRequest": "if (response.status === 200) { variables['custom_token'] = response.data.token; }"
}
```

## Summary Mode

When benchmarking with a very large number of requests (e.g., millions), Glockit can consume a lot of memory by storing every single request result. You can enable `summaryOnly` in the global configuration to only keep aggregate statistics.

```json
{
  "global": {
    "summaryOnly": true,
    "maxRequests": 1000000
  },
  "endpoints": [...]
}
```

In `summaryOnly` mode:
- `requestResults` will be an empty array in the output.
- Only aggregate metrics like `averageResponseTime`, `totalRequests`, etc., are calculated and saved.

### API Response Result Check

Glockit allows you to configure an optional check for the API response. Unlike assertions, a failed `responseCheck` **does not** mark the request as failed. It simply records the outcome in the `responseCheckPassed` field of the results.

```json
{
  "endpoints": [
    {
      "name": "Get User",
      "url": "/users/1",
      "method": "GET",
      "responseCheck": [
        {
          "path": "status",
          "operator": "equals",
          "value": "active"
        }
      ]
    }
  ]
}
```

- **Result**: Look for the `responseCheckPassed` key in the JSON output or the summary of the endpoint.

### Authorization Dependencies

Authorization Dependencies are a powerful way to handle auth flows that should only happen once, even if many endpoints depend on them.

- **Efficiency**: The auth dependency is executed only once per group name. Results (extracted variables) are cached and shared.
- **Chaining**: You can chain multiple endpoints within a single `auth` block.

```json
{
  "endpoints": [
    {
      "name": "Secure Endpoint",
      "url": "/secure/data",
      "method": "GET",
      "auth": {
        "name": "MainAuthGroup",
        "endpoints": [
          {
            "name": "Login",
            "url": "/auth/login",
            "method": "POST",
            "body": { "apiKey": "secret" },
            "variables": [
              { "name": "token", "path": "token", "from": "response" }
            ]
          }
        ]
      },
      "headers": {
        "Authorization": "Bearer {{token}}"
      }
    }
  ]
}
```

### Load Distribution (Weights)

When running benchmarks with `maxRequests` or `duration`, you can control the frequency of each endpoint using `weight`.

```json
{
  "endpoints": [
    { "name": "Heavy Traffic", "url": "/low-cost", "weight": 10 },
    { "name": "Light Traffic", "url": "/high-cost", "weight": 1 }
  ]
}
```
In this example, "Heavy Traffic" will be called approximately 10 times more often than "Light Traffic".

### Execution Modes

1. **Request Count**: Set `global.maxRequests`. The benchmark stops when the total count is reached.
2. **Duration Based**: Set `global.duration` (in ms). The benchmark runs until the time expires.
3. **Throttling**: Set `global.throttle` (requests per second) to limit the load.
4. **Concurrency**: Set `global.concurrent` to control how many requests are in-flight at once.

---

### Example: Advanced Configuration

A complete example showing multiple features working together:

```json
{
  "name": "E-Commerce Load Test",
  "global": {
    "baseUrl": "https://api.example.com/v1",
    "duration": 60000,
    "concurrent": 20,
    "headers": { "X-Request-ID": "{{$uuid}}" }
  },
  "endpoints": [
    {
      "name": "Search",
      "url": "/search",
      "query": { "q": "{{$randomWord}}", "limit": 10 },
      "weight": 5
    },
    {
      "name": "Add to Cart",
      "url": "/cart",
      "method": "POST",
      "body": { "id": "{{$randomInt(1, 1000)}}" },
      "retries": 2,
      "assertions": [
        { "path": "status", "operator": "equals", "value": 201 }
      ]
    }
  ]
}
```

## Output Formats

### JSON Output
Detailed results including timing metrics, success rates, and error information:
```json
{
  "summary": {
    "totalRequests": 100,
    "totalTime": 1250,
    "requestsPerSecond": 80.0,
    "successRate": 0.98,
    "totalErrors": 2,
    "endpoints": {
      "Login": {
        "requests": 100,
        "successful": 98,
        "failed": 2,
        "avgResponseTime": 45.2,
        "minResponseTime": 12,
        "maxResponseTime": 210,
        "responseCheckPassed": true
      }
    }
  },
  "errors": [
    {
      "endpoint": "Login",
      "error": "Request timed out",
      "timestamp": "2023-01-01T12:00:00.000Z"
    }
  ]
}
```

### CSV Output
Tabular format suitable for analysis in spreadsheet software:
```
timestamp,endpoint,method,status,responseTime,contentLength
2023-01-01T12:00:00.000Z,Login,POST,200,45,128
2023-01-01T12:00:00.100Z,Get Products,GET,200,78,2048
```

### JUnit Output
JUnit XML output is useful for CI/CD systems that ingest test artifacts.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="glockit" tests="2" failures="1" time="12.345">
  <testsuite name="Login" tests="1" failures="1" time="6.100">
    <testcase classname="glockit.endpoint" name="POST /auth/login" time="6.100">
      <failure message="2 request(s) failed">timeout; 500 Internal Server Error</failure>
    </testcase>
  </testsuite>
</testsuites>
```

## API Reference

### Class: Glockit

#### Constructor
```typescript
new Glockit(options?: {
  progress?: boolean;  // Show progress (default: true)
  delay?: number;     // Global delay between requests in ms (default: 0)
  dryRun?: boolean;   // If true, no actual requests are made (default: false)
  headers?: Record<string, string>; // Global headers for all requests
  platform?: Platform; // Platform implementation (default: NodePlatform)
})
```

#### Methods

##### run(config: BenchmarkConfig, enableProgress?: boolean): Promise<BenchmarkResults>
Run the benchmark. `enableProgress` can override the constructor option.

##### addRequestInterceptor(onFulfilled, onRejected): number
Add an Axios request interceptor for advanced authentication or logging.

##### addResponseInterceptor(onFulfilled, onRejected): number
Add an Axios response interceptor.

##### saveResults(
  results: BenchmarkResults,
  jsonFile: string,
  csvFile: string,
  htmlFile?: string
): Promise<void>
Save benchmark results to files.

##### saveWithReporters(
  results: BenchmarkResults,
  outputs: ReporterOutputConfig[]
): Promise<void>
Save benchmark results with one or more reporter outputs.

##### registerReporter(name: string, reporter: BenchmarkReporter): void
Register a custom reporter sink for `saveWithReporters` and CLI `--reporters` usage.

##### generateExampleConfig(): BenchmarkConfig
Generate an example configuration object.

### Types

```typescript
interface BenchmarkConfig {
  name?: string;
  description?: string;
  global: {
    baseUrl?: string;
    maxRequests?: number;
    duration?: number;
    throttle?: number;
    concurrent?: number;
    timeout?: number;
    headers?: Record<string, string>;
  };
  endpoints: EndpointConfig[];
}

interface EndpointConfig {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string | number | boolean>;
  variables?: VariableConfig[];
  dependencies?: string[];
  weight?: number;
  assertions?: AssertionConfig[];
  retries?: number;
  auth?: AuthDependencyConfig;
}

interface AuthDependencyConfig {
  name: string;
  endpoints: EndpointConfig[];
}

interface AssertionConfig {
  path: string;
  operator: 'equals' | 'contains' | 'exists' | 'matches';
  value?: any;
}

interface VariableConfig {
  name: string;
  path: string;
  from: 'response' | 'headers' | 'cookies';
}
```

## License

MIT © 2023 Glockit
