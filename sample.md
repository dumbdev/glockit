# Barbarians-Bench

## Overview

Barbarians-Bench is a TypeScript-based CLI tool for benchmarking REST APIs with advanced request chaining capabilities. The tool allows users to define complex API testing scenarios where endpoints can depend on data from previous requests, enabling realistic performance testing of multi-step workflows. It supports concurrent request execution, variable extraction from responses, and comprehensive result reporting in both JSON and CSV formats.

## User Preferences

Preferred communication style: Simple, everyday language.

## Current Project Status

**COMPLETED**: Full TypeScript library implementation with both CLI and programmatic interfaces for API benchmarking.

### Key Features Implemented
- **Dual-purpose library**: Can be used as a standalone CLI tool or imported into other Node.js projects
- **JSON configuration**: Define complex benchmark scenarios with endpoints, request parameters, throttling, and max requests
- **Request chaining**: Extract data from API responses (like authentication tokens) and use them in subsequent requests
- **Concurrent execution**: Run multiple requests in parallel with configurable concurrency limits
- **Multiple execution modes**: Support both request-count-based and time-duration-based benchmarking
- **Comprehensive validation**: Robust configuration validation with clear error messages
- **Result outputs**: Generate detailed benchmark results in both JSON and CSV formats
- **Security-conscious**: Sanitizes sensitive data (tokens, passwords) in logs to prevent exposure

## System Architecture

### Core Design Pattern
The application follows a modular architecture with clear separation of concerns:

- **Configuration-driven approach**: All benchmark scenarios are defined in JSON configuration files, making the tool highly flexible and reusable
- **Command pattern**: The CLI uses Commander.js to provide a clean interface for running benchmarks with various options
- **Dependency resolution**: Built-in dependency graph resolution ensures endpoints execute in the correct order when chaining requests

### Request Processing Engine
The benchmarking engine implements several key architectural decisions:

- **Variable extraction system**: Responses from API calls can extract data using JSONPath-like syntax, storing values for use in subsequent requests
- **Template substitution**: Request headers and bodies support `{{variable}}` syntax for dynamic content injection
- **Concurrent execution**: Multiple requests can run simultaneously within dependency constraints, maximizing throughput while respecting order requirements
- **Flexible execution modes**: Supports both request-count-based and time-duration-based benchmarking strategies

### Error Handling and Validation
Robust validation and error handling throughout the system:

- **Configuration validation**: Comprehensive validation of JSON configuration files with detailed error messages
- **Runtime error collection**: Failed requests are tracked and reported without stopping the entire benchmark
- **Type safety**: Full TypeScript implementation ensures compile-time safety and better IDE support

### Results and Reporting
Multi-format output system for comprehensive analysis:

- **JSON results**: Detailed benchmark results with request timing, success rates, and error information
- **CSV export**: Tabular data format for integration with analysis tools
- **Real-time console feedback**: Progress indicators and colored output for immediate feedback during execution

## External Dependencies

### Core Runtime Dependencies
- **axios**: HTTP client library for making API requests with robust error handling and timeout support
- **commander**: CLI framework providing argument parsing and command structure
- **chalk**: Terminal output styling for enhanced user experience with colored console messages
- **csv-writer**: CSV file generation for exporting benchmark results in tabular format

### Development Dependencies
- **TypeScript**: Primary language with strict type checking and modern JavaScript features
- **ts-node**: Development-time TypeScript execution for rapid iteration
- **@types/node**: Node.js type definitions for TypeScript compatibility

### External Services
The tool is designed to benchmark any REST API endpoint and includes test configurations for:
- **httpbin.org**: Used in test configurations for reliable HTTP testing endpoints
- No specific database requirements - results are stored as local JSON/CSV files
- No authentication services required - supports arbitrary authentication schemes through configurable headers

## Usage Examples

### CLI Usage
```bash
# Generate example configuration
npm run dev example

# Run benchmark with default config
npm run dev run

# Run with custom config and output directory
npm run dev run -c my-config.json -o my-results/
```

### Programmatic Usage
```typescript
import { BarbariansBench, BenchmarkConfig } from 'barbarians-bench';

const config: BenchmarkConfig = {
  // ... your configuration
};

const bench = new BarbariansBench();
const results = await bench.run(config);
```