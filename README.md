# Glockit

## Overview

Glockit is a lightweight TypeScript CLI and library for benchmarking REST APIs. It supports advanced request chaining, concurrent execution, variable extraction, and outputs results in JSON and CSV formats. The tool features a clean, dependency-minimal console interface for real-time progress tracking.

## Table of Contents
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Programmatic Usage](#programmatic-usage)
- [Configuration Reference](#configuration-reference)
- [Output Formats](#output-formats)
- [API Reference](#api-reference)
- [License](#license)

## Features

- **Configuration-driven**: Define benchmarks in simple JSON files
- **Real-time Progress Tracking**: Clean console-based progress bars showing request status
- **Request Chaining**: Extract variables from responses and use them in subsequent requests
- **Concurrent Execution**: Run multiple requests in parallel with configurable concurrency
- **Zero Dependencies**: Built with minimal external dependencies for reliability
- **Flexible Execution Modes**: Supports both request-count and duration-based benchmarking
- **Comprehensive Validation**: Validates configuration with clear error messages
- **Multi-format Output**: Generates detailed JSON and CSV reports
- **Security-conscious Logging**: Sanitizes sensitive data in logs and outputs

## Installation

### Global Installation (Recommended for CLI usage)
```sh
npm install -g glockit
```

### Local Installation (For programmatic usage)
```sh
npm install glockit
```

## Quick Start

1. Create a `benchmark.json` file with your API endpoints:

```json
{
  "name": "E-Commerce API Benchmark",
  "description": "Performance test for an e-commerce API workflow",
  "global": {
    "baseUrl": "https://api.example.com/v1",
    "maxRequests": 100,
    "concurrent": 10,
    "timeout": 5000,
    "headers": {
      "Content-Type": "application/json",
      "Accept": "application/json"
    }
  },
  "endpoints": [
    {
      "name": "User Login",
      "path": "/auth/login",
      "method": "POST",
      "body": {
        "email": "test@example.com",
        "password": "test123"
      },
      "variables": [
        {
          "name": "authToken",
          "path": "token",
          "from": "response"
        }
      ]
    },
    {
      "name": "Get Products",
      "path": "/products",
      "method": "GET",
      "headers": {
        "Authorization": "Bearer {{authToken}}"
      },
      "dependencies": ["User Login"],
      "variables": [
        {
          "name": "firstProductId",
          "path": "products.0.id",
          "from": "response"
        }
      ]
    },
    {
      "name": "Add to Cart",
      "path": "/cart/items",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer {{authToken}}"
      },
      "body": {
        "productId": "{{firstProductId}}",
        "quantity": 1
      },
      "dependencies": ["Get Products"]
    }
  ]
}
```

2. Run the benchmark:
```sh
glockit run -c benchmark.json -o results/
```

## CLI Usage

### Generate Example Configuration
Create a sample `benchmark.json` file to get started:
```sh
glockit example
```

### Run Benchmark
Run a benchmark with the default configuration file (`benchmark.json`):
```sh
glockit run
```

Run with custom configuration and output directory:
```sh
glockit run -c path/to/your/config.json -o ./results/
```

### Available Options
```
Options:
  -c, --config <file>    Path to configuration file (default: benchmark.json)
  -o, --output <dir>     Output directory for results (default: results)
  --no-progress          Disable progress bar and use simple console output
  -d, --delay <ms>       Delay between requests in milliseconds (default: 0)
  -h, --help             Display help for command
```

## Programmatic Usage

```typescript
import { Glockit, BenchmarkConfig } from 'glockit';

// Define your benchmark configuration
const config: BenchmarkConfig = {
  name: 'API Performance Test',
  global: {
    baseUrl: 'https://api.example.com',
    maxRequests: 50,
    concurrent: 5,
    timeout: 10000
  },
  endpoints: [
    {
      name: 'Health Check',
      path: '/health',
      method: 'GET'
    },
    {
      name: 'Search Products',
      path: '/products/search',
      method: 'GET',
      query: {
        q: 'test',
        limit: '10'
      }
    }
  ]
};

// Create a new benchmark instance
const benchmark = new Glockit({
  progress: true,  // Show progress bar (default: true)
  delay: 100       // Delay between requests in ms (default: 0)
});

// Run the benchmark
async function runBenchmark() {
  try {
    console.log('🚀 Starting benchmark...');
    
    // Run the benchmark
    const results = await benchmark.run(config);
    
    // Save results to files
    await benchmark.saveResults(results, 'benchmark-results.json', 'benchmark-results.csv');
    
    // Log summary
    console.log('\n📊 Benchmark Results:');
    console.log(`✅ Total Requests: ${results.summary.totalRequests}`);
    console.log(`⏱️  Total Time: ${(results.summary.totalTime / 1000).toFixed(2)}s`);
    console.log(`📈 Requests per Second: ${results.summary.requestsPerSecond.toFixed(2)}`);
    console.log(`✅ Success Rate: ${(results.summary.successRate * 100).toFixed(2)}%`);
    
    // Detailed results are available in the results object
    console.log('\n🔍 Check benchmark-results.json and benchmark-results.csv for detailed results');
    
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

runBenchmark();
```

## Configuration Reference

### Global Configuration

| Property     | Type   | Required | Default | Description |
|--------------|--------|----------|---------|-------------|
| `name`       | string | No       | -       | Name of the benchmark test |
| `description`| string | No       | -       | Description of the benchmark |
| `baseUrl`    | string | No       | -       | Base URL for all endpoints (can be overridden per endpoint) |
| `maxRequests`| number | No       | 100     | Total number of requests to make |
| `concurrent` | number | No       | 10      | Number of concurrent requests |
| `timeout`    | number | No       | 10000   | Request timeout in milliseconds |
| `headers`    | object | No       | {}      | Default headers for all requests |

### Endpoint Configuration

Each endpoint can have the following properties:

| Property     | Type     | Required | Description |
|--------------|----------|----------|-------------|
| `name`       | string   | Yes      | Unique name for the endpoint |
| `path`       | string   | Yes*     | API endpoint path (relative to baseUrl) |
| `url`        | string   | Yes*     | Full URL (alternative to path) |
| `method`     | string   | No       | HTTP method (GET, POST, etc.) |
| `headers`    | object   | No       | Request headers |
| `body`       | any      | No       | Request body (for POST, PUT, PATCH) |
| `query`      | object   | No       | Query parameters |
| `variables`  | array    | No       | Variables to extract from response |
| `dependencies`| array   | No       | Names of endpoints that must complete first |
| `weight`     | number   | No       | Weight for request distribution |

### Variable Extraction

Extract values from responses to use in subsequent requests:

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
      "path": "headers.authorization",
      "from": "response"
    }
  ]
}
```

### Example: Advanced Configuration

```json
{
  "name": "E-Commerce API Load Test",
  "description": "Simulates a user flow through an e-commerce site",
  "global": {
    "baseUrl": "https://api.example.com/v1",
    "maxRequests": 1000,
    "concurrent": 50,
    "timeout": 10000,
    "headers": {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Request-ID": "{{$uuid}}"
    }
  },
  "endpoints": [
    {
      "name": "Homepage",
      "path": "/home",
      "method": "GET",
      "weight": 3  // This endpoint will be called 3x more often than others
    },
    {
      "name": "Search Products",
      "path": "/products/search",
      "method": "GET",
      "query": {
        "q": "{{$randomWord}}",
        "page": "{{$randomInt(1, 5)}}",
        "sort": "{{$randomFrom(['price', 'popularity', 'newest'])}}"
      }
    },
    {
      "name": "Product Detail",
      "path": "/products/{{$randomFrom([1,2,3,4,5])}}",
      "method": "GET"
    },
    {
      "name": "Add to Cart",
      "path": "/cart/items",
      "method": "POST",
      "headers": {
        "Authorization": "Bearer {{authToken}}"
      },
      "body": {
        "productId": "{{$randomUUID()}}",
        "quantity": "{{$randomInt(1, 5)}}",
        "color": "{{$randomFrom(['red', 'blue', 'green'])}}"
      },
      "dependencies": ["Login"]
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
        "p50": 42,
        "p90": 78,
        "p95": 95,
        "p99": 180
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
  progress?: boolean;  // Show progress bar (default: true)
  delay?: number;      // Delay between requests in ms (default: 0)
})
```

#### Methods

##### run(config: BenchmarkConfig): Promise<BenchmarkResults>
Run the benchmark with the given configuration.

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
    maxRequests: number;
    concurrent: number;
    timeout: number;
    headers?: Record<string, string>;
  };
  endpoints: EndpointConfig[];
}

interface EndpointConfig {
  name: string;
  path?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string | number | boolean>;
  variables?: VariableConfig[];
  dependencies?: string[];
  weight?: number;
}

interface VariableConfig {
  name: string;
  path: string;
  from: 'response' | 'headers' | 'cookies';
}
```

## License

MIT © 2023 Glockit
