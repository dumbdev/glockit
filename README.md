# Barbarians-Bench

## Overview

Barbarians-Bench is a TypeScript CLI and library for benchmarking REST APIs. It supports advanced request chaining, concurrent execution, variable extraction, and outputs results in JSON and CSV formats.

## Features

- **Configuration-driven**: Define benchmarks in JSON files.
- **Request chaining**: Extract variables from responses and use them in subsequent requests.
- **Concurrent execution**: Run multiple requests in parallel.
- **Flexible execution modes**: Supports both request-count and duration-based benchmarking.
- **Comprehensive validation**: Validates configuration with clear error messages.
- **Multi-format output**: Generates JSON and CSV reports.
- **Security-conscious logging**: Sanitizes sensitive data in logs.

## Installation

```sh
npm install -g barbarians-bench
```

Or use locally in your project:

```sh
npm install barbarians-bench
```

## Usage

### CLI

Generate an example configuration:

```sh
barbarians-bench example
```

Run a benchmark:

```sh
barbarians-bench run -c benchmark.json -o results/
```

### Programmatic

```typescript
import { BarbariansBench, BenchmarkConfig } from 'barbarians-bench';

const config: BenchmarkConfig = {
  // ...your configuration...
};

const bench = new BarbariansBench();
const results = await bench.run(config);
await bench.saveResults(results, 'results.json', 'results.csv');
```

## Configuration

Example `benchmark.json`:

```json
{
  "name": "Example API Benchmark",
  "global": {
    "maxRequests": 100,
    "concurrent": 10,
    "timeout": 5000
  },
  "endpoints": [
    {
      "name": "Login",
      "url": "https://api.example.com/auth/login",
      "method": "POST",
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "username": "testuser",
        "password": "testpass"
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
      "name": "Get User Profile",
      "url": "https://api.example.com/user/profile",
      "method": "GET",
      "headers": {
        "Authorization": "Bearer {{authToken}}"
      },
      "dependencies": [
        "Login"
      ]
    }
  ]
}
```

## Output

- **JSON**: Detailed results including timings, success rates, and errors.
- **CSV**: Tabular summary for analysis.

## API Reference

See `src/index.ts` for full JSDoc documentation.

## License

MIT
