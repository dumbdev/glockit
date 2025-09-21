export interface BenchmarkConfig {
  name?: string;
  endpoints: EndpointConfig[];
  global?: GlobalConfig;
}

export interface GlobalConfig {
  maxRequests?: number;
  duration?: number;
  throttle?: number;
  concurrent?: number;
  timeout?: number;
  /**
   * Delay in milliseconds between consecutive requests.
   * This delay is applied after each request, before the next one starts.
   * Default: 0 (no delay)
   */
  requestDelay?: number;
}

export interface EndpointConfig {
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  maxRequests?: number;
  throttle?: number;
  /**
   * Delay in milliseconds before making this specific request.
   * Overrides the global requestDelay if set.
   * Default: undefined (use global requestDelay)
   */
  requestDelay?: number;
  variables?: VariableExtraction[];
  dependencies?: string[];
}

export interface VariableExtraction {
  name: string;
  path: string;
  from: 'response' | 'headers';
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  results: EndpointResult[];
  summary: BenchmarkSummary;
  timestamp: string;
}

export interface EndpointResult {
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  /** Success rate as a value between 0 and 1 */
  successRate: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  requestsPerSecond: number;
  errors: string[];
  requestResults: RequestResult[];
  totalRequestSizeKB: number;
  averageRequestSizeKB: number;
  totalResponseSizeKB: number;
  averageResponseSizeKB: number;
}

export interface BenchmarkSummary {
  totalDuration: number;
  totalRequests: number;
  totalSuccessful: number;
  totalFailed: number;
  overallRequestsPerSecond: number;
  averageResponseTime: number;
}

export interface RequestResult {
  success: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
  data?: any;
  headers?: Record<string, string>;
  requestSizeKB?: number;
  responseSizeKB?: number;
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigValidator {
  static validate(config: any): BenchmarkConfig {
    if (!config || typeof config !== 'object') {
      throw new ConfigValidationError('Configuration must be a valid object');
    }

    if (!config.endpoints || !Array.isArray(config.endpoints)) {
      throw new ConfigValidationError('Configuration must have an "endpoints" array');
    }

    if (config.endpoints.length === 0) {
      throw new ConfigValidationError('At least one endpoint is required');
    }

    // Validate global config
    if (config.global) {
      this.validateGlobalConfig(config.global);
    }

    // Validate endpoints
    const endpointNames = new Set<string>();
    for (let i = 0; i < config.endpoints.length; i++) {
      const endpoint = config.endpoints[i];
      this.validateEndpoint(endpoint, i);
      
      if (endpointNames.has(endpoint.name)) {
        throw new ConfigValidationError(`Duplicate endpoint name: "${endpoint.name}"`);
      }
      endpointNames.add(endpoint.name);
    }

    // Validate dependencies
    this.validateDependencies(config.endpoints, endpointNames);

    return config as BenchmarkConfig;
  }

  private static validateGlobalConfig(global: any): void {
    if (typeof global !== 'object') {
      throw new ConfigValidationError('Global config must be an object');
    }

    if (global.maxRequests !== undefined && (!Number.isInteger(global.maxRequests) || global.maxRequests <= 0)) {
      throw new ConfigValidationError('Global maxRequests must be a positive integer');
    }

    if (global.duration !== undefined && (!Number.isInteger(global.duration) || global.duration <= 0)) {
      throw new ConfigValidationError('Global duration must be a positive integer (milliseconds)');
    }

    if (global.throttle !== undefined && (!Number.isInteger(global.throttle) || global.throttle < 0)) {
      throw new ConfigValidationError('Global throttle must be a non-negative integer (milliseconds)');
    }

    if (global.concurrent !== undefined && (!Number.isInteger(global.concurrent) || global.concurrent <= 0)) {
      throw new ConfigValidationError('Global concurrent must be a positive integer');
    }

    if (global.timeout !== undefined && (!Number.isInteger(global.timeout) || global.timeout <= 0)) {
      throw new ConfigValidationError('Global timeout must be a positive integer (milliseconds)');
    }
  }

  private static validateEndpoint(endpoint: any, index: number): void {
    const prefix = `Endpoint ${index + 1}`;

    if (!endpoint || typeof endpoint !== 'object') {
      throw new ConfigValidationError(`${prefix}: Must be an object`);
    }

    if (!endpoint.name || typeof endpoint.name !== 'string' || endpoint.name.trim() === '') {
      throw new ConfigValidationError(`${prefix}: Must have a non-empty "name" string`);
    }

    if (!endpoint.url || typeof endpoint.url !== 'string') {
      throw new ConfigValidationError(`${prefix}: Must have a valid "url" string`);
    }

    try {
      new URL(endpoint.url.replace(/{{[^}]+}}/g, 'placeholder'));
    } catch {
      throw new ConfigValidationError(`${prefix}: URL "${endpoint.url}" is not valid (variables like {{var}} are allowed)`);
    }

    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    if (!endpoint.method || !validMethods.includes(endpoint.method)) {
      throw new ConfigValidationError(`${prefix}: Method must be one of: ${validMethods.join(', ')}`);
    }

    if (endpoint.headers && typeof endpoint.headers !== 'object') {
      throw new ConfigValidationError(`${prefix}: Headers must be an object`);
    }

    if (endpoint.maxRequests !== undefined && (!Number.isInteger(endpoint.maxRequests) || endpoint.maxRequests <= 0)) {
      throw new ConfigValidationError(`${prefix}: maxRequests must be a positive integer`);
    }

    if (endpoint.throttle !== undefined && (!Number.isInteger(endpoint.throttle) || endpoint.throttle < 0)) {
      throw new ConfigValidationError(`${prefix}: throttle must be a non-negative integer (milliseconds)`);
    }

    if (endpoint.variables) {
      if (!Array.isArray(endpoint.variables)) {
        throw new ConfigValidationError(`${prefix}: variables must be an array`);
      }
      endpoint.variables.forEach((variable: any, vIndex: number) => {
        this.validateVariableExtraction(variable, `${prefix}, variable ${vIndex + 1}`);
      });
    }

    if (endpoint.dependencies) {
      if (!Array.isArray(endpoint.dependencies)) {
        throw new ConfigValidationError(`${prefix}: dependencies must be an array`);
      }
      if (!endpoint.dependencies.every((dep: any) => typeof dep === 'string')) {
        throw new ConfigValidationError(`${prefix}: all dependencies must be strings`);
      }
    }
  }

  private static validateVariableExtraction(variable: any, prefix: string): void {
    if (!variable || typeof variable !== 'object') {
      throw new ConfigValidationError(`${prefix}: Must be an object`);
    }

    if (!variable.name || typeof variable.name !== 'string' || variable.name.trim() === '') {
      throw new ConfigValidationError(`${prefix}: Must have a non-empty "name" string`);
    }

    if (!variable.path || typeof variable.path !== 'string' || variable.path.trim() === '') {
      throw new ConfigValidationError(`${prefix}: Must have a non-empty "path" string`);
    }

    if (!variable.from || !['response', 'headers'].includes(variable.from)) {
      throw new ConfigValidationError(`${prefix}: "from" must be either "response" or "headers"`);
    }
  }

  private static validateDependencies(endpoints: any[], endpointNames: Set<string>): void {
    for (const endpoint of endpoints) {
      if (endpoint.dependencies) {
        for (const dep of endpoint.dependencies) {
          if (!endpointNames.has(dep)) {
            throw new ConfigValidationError(`Endpoint "${endpoint.name}" depends on "${dep}" which doesn't exist`);
          }
          if (dep === endpoint.name) {
            throw new ConfigValidationError(`Endpoint "${endpoint.name}" cannot depend on itself`);
          }
        }
      }
    }
  }
}