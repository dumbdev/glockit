import { AxiosInstance } from 'axios';
import {
  EndpointConfig,
  RequestResult,
  Platform,
  GlockitOptions,
  AuthDependencyConfig,
  DiagnosticsConfig,
  VirtualUserConfig,
  AssertionConfig
} from '../types';
import { ProgressTracker } from '../platform/progress';
import {
  VirtualUserSession,
  getCookieHeader,
  captureSetCookies
} from '../runtime/virtual-user';
import { executeWebSocketRequest, executeGrpcRequest } from '../runtime/request-engines';
import {
  checkAssertions,
  extractVariables,
  replaceVariables,
  replaceVariablesInObject,
  sleep
} from './variable-engine';
import { runHookInSandbox } from './hooks';

/**
 * Shared context holding all runtime state needed to execute requests.
 */
export interface RequestContext {
  axiosInstance: AxiosInstance;
  platform: Platform;
  progressTracker: ProgressTracker | undefined;
  options: GlockitOptions;
  variables: Map<string, any>;
  authVariablesMap: Map<string, Map<string, any>>;
}

/**
 * Builds a full URL by joining baseUrl and endpointUrl.
 */
export function buildFullUrl(endpointUrl: string, baseUrl?: string): string {
  if (!endpointUrl) return '';
  if (/^https?:\/\//i.test(endpointUrl)) return endpointUrl;
  if (!baseUrl) return endpointUrl;
  return baseUrl.replace(/\/$/, '') + '/' + endpointUrl.replace(/^\//, '');
}

/**
 * Executes a single HTTP, WebSocket, or gRPC request with variable substitution and hooks.
 */
export async function executeSingleRequest(
  ctx: RequestContext,
  endpoint: EndpointConfig,
  timeout: number,
  baseUrl?: string,
  session?: VirtualUserSession,
  virtualUsersConfig?: VirtualUserConfig,
  diagnosticsConfig?: DiagnosticsConfig
): Promise<RequestResult> {
  const startTime = process.hrtime();
  let requestSizeKB = 0;
  const endpointName = endpoint.name;
  const vars = session?.variables ?? ctx.variables;
  const platform = ctx.platform;

  if (ctx.progressTracker) {
    ctx.progressTracker.updateRequestProgress(endpointName, 0, 1, 'Starting request...');
  }

  if (ctx.options.dryRun) {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const responseTime = (seconds * 1000) + (nanoseconds / 1e6);
    return {
      success: true,
      responseTime,
      statusCode: 200,
      data: { message: 'Dry run: No actual request made' },
      headers: {},
      requestUrl: endpoint.url,
      requestMethod: endpoint.method,
      requestSizeKB: 0,
      responseSizeKB: 0
    };
  }

  try {
    const transport = endpoint.transport || 'http';

    let url = transport === 'grpc'
      ? replaceVariables(endpoint.url, vars, platform)
      : buildFullUrl(replaceVariables(endpoint.url, vars, platform), baseUrl);

    if (endpoint.query && transport !== 'grpc') {
      const queryParams = replaceVariablesInObject(endpoint.query, vars, platform);
      const urlObj = new URL(url);
      Object.entries(queryParams).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value));
      });
      url = urlObj.toString();
    }

    const headers: Record<string, any> = {
      ...ctx.options.headers,
      ...replaceVariablesInObject(endpoint.headers || {}, vars, platform)
    };

    const cookieHeader = getCookieHeader(session, virtualUsersConfig);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    let body = endpoint.body;
    if (body && typeof body === 'object') {
      body = replaceVariablesInObject(body, vars, platform);
    } else if (typeof body === 'string') {
      body = replaceVariables(body, vars, platform);
    }

    requestSizeKB = platform.getObjectSizeKB(body) + platform.getObjectSizeKB(headers);

    // --- BEFORE REQUEST HOOK ---
    if (endpoint.beforeRequest) {
      try {
        const hookContext = {
          request: { url, method: endpoint.method || 'GET', headers, body },
          variables: Object.fromEntries(vars)
        };
        runHookInSandbox(endpoint.beforeRequest, hookContext, 'beforeRequest', endpointName, platform.name);
        url = hookContext.request.url;
        Object.assign(headers, hookContext.request.headers);
        body = hookContext.request.body;
      } catch (hookError) {
        console.error(`Error in beforeRequest hook for endpoint "${endpointName}":`, hookError);
      }
    }
    // ---------------------------

    if (ctx.progressTracker) {
      ctx.progressTracker.updateRequestProgress(endpointName, 0, 1, 'Sending request...');
    }

    const response = transport === 'http'
      ? await ctx.axiosInstance({
        method: endpoint.method || 'GET',
        url,
        headers: { 'Content-Type': 'application/json', ...headers },
        data: body,
        timeout,
        validateStatus: () => true,
        onUploadProgress: (progressEvent) => {
          if (ctx.progressTracker && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            ctx.progressTracker.updateRequestProgress(
              endpointName, progressEvent.loaded, progressEvent.total, `Uploading: ${percent}%`
            );
          }
        },
        onDownloadProgress: (progressEvent) => {
          if (ctx.progressTracker && progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            ctx.progressTracker.updateRequestProgress(
              endpointName, progressEvent.loaded, progressEvent.total, `Downloading: ${percent}%`
            );
          }
        }
      })
      : transport === 'websocket'
        ? await executeWebSocketRequest({ endpoint, url, headers, body, timeout })
        : await executeGrpcRequest({ endpoint, url, headers, body, timeout });

    const [seconds, nanoseconds] = process.hrtime(startTime);
    const responseTime = (seconds * 1000) + (nanoseconds / 1e6);

    // --- AFTER REQUEST HOOK ---
    if (endpoint.afterRequest) {
      try {
        const hookContext = {
          response: { data: response.data, status: response.status, headers: response.headers },
          variables: Object.fromEntries(vars)
        };
        runHookInSandbox(endpoint.afterRequest, hookContext, 'afterRequest', endpointName, platform.name);
        response.data = hookContext.response.data;
        response.status = hookContext.response.status;
        Object.assign(response.headers, hookContext.response.headers);
        for (const [key, value] of Object.entries(hookContext.variables)) {
          if (session) {
            session.variables.set(key, value);
          } else {
            ctx.variables.set(key, value);
          }
        }
      } catch (hookError) {
        console.error(`Error in afterRequest hook for endpoint "${endpointName}":`, hookError);
      }
    }
    // ---------------------------

    captureSetCookies(response.headers, session, virtualUsersConfig);

    let responseSizeKB = 0;
    const contentLength = response.headers['content-length'];
    if (contentLength) {
      responseSizeKB = parseInt(contentLength, 10) / 1024;
    } else {
      responseSizeKB = platform.getObjectSizeKB(response.headers) + platform.getObjectSizeKB(response.data);
    }

    const statusCode = response.status;
    const data = response.data;
    const responseHeaders = response.headers as Record<string, string>;

    if (ctx.progressTracker) {
      ctx.progressTracker.updateRequestProgress(endpointName, 1, 1, `Completed (${statusCode})`);
    }

    return {
      success: response.status >= 200 && response.status < 300,
      responseTime,
      statusCode,
      data,
      headers: responseHeaders,
      requestUrl: diagnosticsConfig?.enabled ? url : undefined,
      requestMethod: diagnosticsConfig?.enabled ? (endpoint.method || 'GET') : undefined,
      requestHeaders: diagnosticsConfig?.enabled ? headers : undefined,
      requestBody: diagnosticsConfig?.enabled ? body : undefined,
      requestSizeKB: parseFloat(requestSizeKB.toFixed(6)),
      responseSizeKB: parseFloat(responseSizeKB.toFixed(6))
    };
  } catch (error) {
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const responseTime = (seconds * 1000) + (nanoseconds / 1e6);
    const fallbackVars = session?.variables ?? ctx.variables;

    return {
      success: false,
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
      statusCode: (error as any)?.response?.status,
      requestUrl: diagnosticsConfig?.enabled ? endpoint.url : undefined,
      requestMethod: diagnosticsConfig?.enabled ? (endpoint.method || 'GET') : undefined,
      requestHeaders: diagnosticsConfig?.enabled
        ? replaceVariablesInObject({ ...(ctx.options.headers || {}), ...(endpoint.headers || {}) }, fallbackVars, ctx.platform)
        : undefined,
      requestBody: diagnosticsConfig?.enabled
        ? replaceVariablesInObject(endpoint.body, fallbackVars, ctx.platform)
        : undefined,
      requestSizeKB: parseFloat(requestSizeKB.toFixed(6)),
      responseSizeKB: 0
    };
  }
}

/**
 * Makes a request with retry logic and assertion checking.
 */
export async function makeRequest(
  ctx: RequestContext,
  endpoint: EndpointConfig,
  timeout: number,
  baseUrl?: string,
  session?: VirtualUserSession,
  virtualUsersConfig?: VirtualUserConfig,
  diagnosticsConfig?: DiagnosticsConfig
): Promise<RequestResult> {
  const retries = endpoint.retries || 0;
  let attempt = 0;
  let lastResult: RequestResult | undefined;

  while (attempt <= retries) {
    if (attempt > 0 && ctx.progressTracker) {
      ctx.progressTracker.log(`🔄 Retrying ${endpoint.name} (attempt ${attempt}/${retries})...`);
      const backoff = Math.pow(2, attempt) * 1000;
      await sleep(backoff);
    }

    lastResult = await executeSingleRequest(ctx, endpoint, timeout, baseUrl, session, virtualUsersConfig, diagnosticsConfig);

    if (lastResult.success && endpoint.assertions && endpoint.assertions.length > 0) {
      const assertionResults = checkAssertions(endpoint.assertions, lastResult.data, lastResult.headers);
      if (assertionResults.some(r => !r.success)) {
        lastResult.success = false;
        lastResult.error = `Assertion failed: ${assertionResults.filter(r => !r.success).map(r => r.message).join(', ')}`;
      }
    }

    if (lastResult.success && endpoint.responseCheck && endpoint.responseCheck.length > 0) {
      const checkResults = checkAssertions(endpoint.responseCheck as AssertionConfig[], lastResult.data, lastResult.headers);
      lastResult.responseCheckPassed = checkResults.every(r => r.success);
    }

    if (lastResult.success) {
      return lastResult;
    }

    attempt++;
  }

  return lastResult!;
}

/**
 * Runs all auth dependency endpoints, stores extracted variables, and caches auth state.
 */
export async function handleAuthDependency(
  ctx: RequestContext,
  auth: AuthDependencyConfig,
  globalConfig: any = {}
): Promise<void> {
  if (ctx.progressTracker) {
    ctx.progressTracker.log(`🔑 Processing authorization dependency: ${auth.name}`);
  } else {
    console.log(`🔑 Processing authorization dependency: ${auth.name}`);
  }

  const authVars = new Map<string, any>();

  for (const endpoint of auth.endpoints) {
    const result = await makeRequest(ctx, endpoint, globalConfig?.timeout || 15000, globalConfig?.baseUrl);

    if (!result.success) {
      throw new Error(`Authorization failed for "${auth.name}" at endpoint "${endpoint.name}": ${result.error}`);
    }

    if (endpoint.variables && result.data) {
      extractVariables(endpoint.variables, result.data, result.headers || {}, authVars);
      authVars.forEach((val, key) => {
        ctx.variables.set(key, val);
      });
    }
  }

  ctx.authVariablesMap.set(auth.name, authVars);
}
