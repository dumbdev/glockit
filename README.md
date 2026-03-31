# Glockit

## Overview

Glockit is a lightweight TypeScript CLI and library for benchmarking REST APIs. It supports advanced request chaining, authorization dependencies, concurrent execution, variable extraction, and outputs results in JSON, CSV, and HTML formats. The tool features a clean, minimal-dependency console interface for real-time progress tracking.

## New Features (v1.0.5)
- **YAML Configuration Support**: Define benchmarks in `.yaml` or `.yml` files.
- **Environment Variable Substitution**: Use `{{$env.VAR_NAME}}` in your configuration files.
- **Pre/Post Request Hooks**: Run custom JavaScript logic before or after requests.
- **Summary Mode**: Efficiently benchmark millions of requests with minimal memory overhead.

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
- **Cross-Platform Support**: Works in Node.js and Browser environments via a platform abstraction layer.
- **Security-conscious Logging**: Automatically sanitizes sensitive data (like tokens and passwords) in logs.

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
- `-v, --version`: Show version number.

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
  - `headers` (object): Global request headers.
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
  csvFile?: string
): Promise<void>
Save benchmark results to files.

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
