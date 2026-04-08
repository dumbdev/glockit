import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BenchmarkConfig, EndpointConfig } from '../types';

export type ImportSourceType = 'openapi' | 'postman' | 'har';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

function slugify(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'endpoint';
}

function toObjectHeaders(input: any): Record<string, string> | undefined {
  if (!input) {
    return undefined;
  }

  if (Array.isArray(input)) {
    const headers = input.reduce<Record<string, string>>((acc, item) => {
      if (item && typeof item.key === 'string' && typeof item.value === 'string') {
        acc[item.key] = item.value;
      }
      return acc;
    }, {});
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  if (typeof input === 'object') {
    const headers = Object.entries(input).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') {
        acc[key] = value;
      }
      return acc;
    }, {});
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  return undefined;
}

function toQueryParams(input: any): Record<string, string | number | boolean> | undefined {
  if (!input) {
    return undefined;
  }

  if (Array.isArray(input)) {
    const query = input.reduce<Record<string, string | number | boolean>>((acc, entry) => {
      if (!entry || typeof entry.name !== 'string') {
        return acc;
      }

      const value = entry.value;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        acc[entry.name] = value;
      }

      return acc;
    }, {});

    return Object.keys(query).length > 0 ? query : undefined;
  }

  if (typeof input === 'object') {
    const query = Object.entries(input).reduce<Record<string, string | number | boolean>>((acc, [key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        acc[key] = value;
      }
      return acc;
    }, {});

    return Object.keys(query).length > 0 ? query : undefined;
  }

  return undefined;
}

function mergeHeaders(
  base?: Record<string, string>,
  incoming?: Record<string, string>
): Record<string, string> | undefined {
  const merged = {
    ...(base || {}),
    ...(incoming || {})
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeQuery(
  base?: Record<string, string | number | boolean>,
  incoming?: Record<string, string | number | boolean>
): Record<string, string | number | boolean> | undefined {
  const merged = {
    ...(base || {}),
    ...(incoming || {})
  };

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function extractOpenApiBodyExample(operation: any): any {
  const content = operation?.requestBody?.content;
  if (!content || typeof content !== 'object') {
    return undefined;
  }

  const jsonEntry = content['application/json'];
  if (jsonEntry?.example !== undefined) {
    return jsonEntry.example;
  }

  const jsonExamples = jsonEntry?.examples;
  if (jsonExamples && typeof jsonExamples === 'object') {
    const firstExample = Object.values(jsonExamples).find((entry: any) => entry?.value !== undefined) as any;
    if (firstExample?.value !== undefined) {
      return firstExample.value;
    }
  }

  if (jsonEntry?.schema?.example !== undefined) {
    return jsonEntry.schema.example;
  }

  const firstContentKey = Object.keys(content)[0];
  const firstEntry = content[firstContentKey];
  if (firstEntry?.example !== undefined) {
    return firstEntry.example;
  }

  const firstExamples = firstEntry?.examples;
  if (firstExamples && typeof firstExamples === 'object') {
    const first = Object.values(firstExamples).find((entry: any) => entry?.value !== undefined) as any;
    if (first?.value !== undefined) {
      return first.value;
    }
  }

  return undefined;
}

function resolveOpenApiAuthHeaders(operation: any, doc: any): Record<string, string> | undefined {
  const security = Array.isArray(operation?.security)
    ? operation.security
    : Array.isArray(doc?.security)
      ? doc.security
      : [];

  const schemes = doc?.components?.securitySchemes || {};
  const headers: Record<string, string> = {};

  for (const requirement of security) {
    if (!requirement || typeof requirement !== 'object') {
      continue;
    }

    for (const schemeName of Object.keys(requirement)) {
      const scheme = schemes[schemeName];
      if (!scheme || typeof scheme !== 'object') {
        continue;
      }

      if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        headers.Authorization = 'Bearer {{TOKEN}}';
      } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
        headers.Authorization = 'Basic {{BASIC_AUTH}}';
      } else if (scheme.type === 'apiKey' && scheme.in === 'header' && typeof scheme.name === 'string') {
        headers[scheme.name] = '{{API_KEY}}';
      }
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function resolveOpenApiParameters(
  pathParameters: any[],
  operationParameters: any[]
): {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
} {
  const combined = [...(pathParameters || []), ...(operationParameters || [])];
  const headers: Record<string, string> = {};
  const query: Record<string, string | number | boolean> = {};

  for (const param of combined) {
    if (!param || typeof param.name !== 'string') {
      continue;
    }

    const fallback = param?.example ?? param?.schema?.example ?? param?.schema?.default;
    const value = fallback !== undefined ? fallback : `{{${param.name}}}`;

    if (param.in === 'header') {
      headers[param.name] = String(value);
    }

    if (param.in === 'query') {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        query[param.name] = value;
      } else {
        query[param.name] = String(value);
      }
    }
  }

  return {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    query: Object.keys(query).length > 0 ? query : undefined
  };
}

function normalizeMethod(method: string | undefined): EndpointConfig['method'] {
  const normalized = (method || 'GET').toUpperCase();
  return HTTP_METHODS.has(normalized) ? normalized as EndpointConfig['method'] : 'GET';
}

function createEndpointName(method: string, url: string, index: number): string {
  const clean = slugify(url.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, ''));
  return `${method.toLowerCase()}-${clean}-${index + 1}`;
}

function importOpenApiDocument(doc: any): BenchmarkConfig {
  const servers = Array.isArray(doc?.servers) ? doc.servers : [];
  const baseUrl = typeof servers[0]?.url === 'string' ? servers[0].url : undefined;
  const paths = doc?.paths && typeof doc.paths === 'object' ? doc.paths : {};
  const endpoints: EndpointConfig[] = [];

  Object.entries(paths).forEach(([rawPath, operations]) => {
    if (!operations || typeof operations !== 'object') {
      return;
    }

    Object.entries(operations as Record<string, any>).forEach(([rawMethod, operation]) => {
      const method = rawMethod.toUpperCase();
      if (!HTTP_METHODS.has(method)) {
        return;
      }

      const pathParameters = Array.isArray((operations as any)?.parameters)
        ? (operations as any).parameters
        : [];
      const operationParameters = Array.isArray(operation?.parameters)
        ? operation.parameters
        : [];
      const resolvedParams = resolveOpenApiParameters(pathParameters, operationParameters);
      const authHeaders = resolveOpenApiAuthHeaders(operation, doc);

      const endpoint: EndpointConfig = {
        name: operation?.operationId || createEndpointName(method, rawPath, endpoints.length),
        url: rawPath,
        method: normalizeMethod(method),
        headers: mergeHeaders(resolvedParams.headers, authHeaders),
        query: resolvedParams.query
      };

      const bodyExample = extractOpenApiBodyExample(operation);
      if (bodyExample !== undefined) {
        endpoint.body = bodyExample;
      }

      endpoints.push(endpoint);
    });
  });

  return {
    name: typeof doc?.info?.title === 'string' ? `${doc.info.title} (imported)` : 'Imported OpenAPI Benchmark',
    global: {
      baseUrl,
      maxRequests: 1,
      concurrent: 1
    },
    endpoints
  };
}

function collectPostmanItems(items: any[], output: any[] = []): any[] {
  for (const item of items || []) {
    if (item?.request) {
      output.push(item);
    }
    if (Array.isArray(item?.item)) {
      collectPostmanItems(item.item, output);
    }
  }
  return output;
}

function parsePostmanUrl(requestUrl: any): string {
  if (typeof requestUrl === 'string') {
    return requestUrl;
  }

  if (typeof requestUrl?.raw === 'string') {
    return requestUrl.raw;
  }

  const protocol = Array.isArray(requestUrl?.protocol) ? requestUrl.protocol[0] : requestUrl?.protocol;
  const host = Array.isArray(requestUrl?.host) ? requestUrl.host.join('.') : requestUrl?.host;
  const pathParts = Array.isArray(requestUrl?.path) ? requestUrl.path.join('/') : requestUrl?.path;
  if (host && pathParts) {
    return `${protocol || 'https'}://${host}/${pathParts}`;
  }

  return '/';
}

function parsePostmanQuery(requestUrl: any): Record<string, string | number | boolean> | undefined {
  if (!requestUrl) {
    return undefined;
  }

  if (Array.isArray(requestUrl.query)) {
    const query = requestUrl.query.reduce((acc: Record<string, string | number | boolean>, item: any) => {
      if (item && typeof item.key === 'string' && item.value !== undefined) {
        acc[item.key] = String(item.value);
      }
      return acc;
    }, {} as Record<string, string | number | boolean>);
    return Object.keys(query).length > 0 ? query : undefined;
  }

  if (typeof requestUrl.raw === 'string') {
    try {
      const parsedUrl = new URL(requestUrl.raw);
      const query: Record<string, string | number | boolean> = {};
      parsedUrl.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      return Object.keys(query).length > 0 ? query : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function parsePostmanAuth(requestAuth: any): {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
} {
  if (!requestAuth || typeof requestAuth !== 'object') {
    return {};
  }

  const type = typeof requestAuth.type === 'string' ? requestAuth.type : '';
  const headers: Record<string, string> = {};
  const query: Record<string, string | number | boolean> = {};

  if (type === 'bearer') {
    headers.Authorization = 'Bearer {{TOKEN}}';
  }

  if (type === 'basic') {
    headers.Authorization = 'Basic {{BASIC_AUTH}}';
  }

  if (type === 'apikey' && Array.isArray(requestAuth.apikey)) {
    const key = requestAuth.apikey.find((entry: any) => entry?.key === 'key')?.value;
    const value = requestAuth.apikey.find((entry: any) => entry?.key === 'value')?.value;
    const inValue = requestAuth.apikey.find((entry: any) => entry?.key === 'in')?.value;

    if (typeof key === 'string' && typeof value === 'string') {
      if (inValue === 'query') {
        query[key] = value;
      } else {
        headers[key] = value;
      }
    }
  }

  return {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    query: Object.keys(query).length > 0 ? query : undefined
  };
}

function importPostmanCollection(doc: any): BenchmarkConfig {
  const items = collectPostmanItems(doc?.item || []);
  const endpoints: EndpointConfig[] = items.map((item, index) => {
    const request = item.request || {};
    const method = normalizeMethod(request.method);
    const url = parsePostmanUrl(request.url);
    const urlQuery = parsePostmanQuery(request.url);
    const auth = parsePostmanAuth(request.auth);
    const endpoint: EndpointConfig = {
      name: item.name || createEndpointName(method, url, index),
      url,
      method,
      headers: mergeHeaders(toObjectHeaders(request.header), auth.headers),
      query: mergeQuery(urlQuery, auth.query)
    };

    if (request?.body?.mode === 'raw' && typeof request.body.raw === 'string') {
      try {
        endpoint.body = JSON.parse(request.body.raw);
      } catch {
        endpoint.body = request.body.raw;
      }
    }

    return endpoint;
  });

  return {
    name: typeof doc?.info?.name === 'string' ? `${doc.info.name} (imported)` : 'Imported Postman Benchmark',
    global: {
      maxRequests: 1,
      concurrent: 1
    },
    endpoints
  };
}

function importHarDocument(doc: any): BenchmarkConfig {
  const entries = Array.isArray(doc?.log?.entries) ? doc.log.entries : [];
  const endpoints: EndpointConfig[] = entries.map((entry: any, index: number) => {
    const request = entry?.request || {};
    const method = normalizeMethod(request.method);
    const url = typeof request.url === 'string' ? request.url : '/';

    const endpoint: EndpointConfig = {
      name: createEndpointName(method, url, index),
      url,
      method,
      headers: toObjectHeaders(request.headers),
      query: toQueryParams(request.queryString)
    };

    if (typeof request?.postData?.text === 'string') {
      try {
        endpoint.body = JSON.parse(request.postData.text);
      } catch {
        endpoint.body = request.postData.text;
      }
    }

    return endpoint;
  });

  return {
    name: 'Imported HAR Benchmark',
    global: {
      maxRequests: 1,
      concurrent: 1
    },
    endpoints
  };
}

function detectImportSourceType(filePath: string, parsed: any): ImportSourceType {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.har') {
    return 'har';
  }

  if (parsed?.openapi || parsed?.swagger) {
    return 'openapi';
  }

  if (Array.isArray(parsed?.item) && parsed?.info) {
    return 'postman';
  }

  if (parsed?.log?.entries) {
    return 'har';
  }

  return 'openapi';
}

export function importBenchmarkConfig(params: {
  filePath: string;
  sourceType?: ImportSourceType;
}): BenchmarkConfig {
  const raw = fs.readFileSync(params.filePath, 'utf8');
  const extension = path.extname(params.filePath).toLowerCase();
  const parsed = extension === '.yaml' || extension === '.yml' ? yaml.load(raw) : JSON.parse(raw);

  const sourceType = params.sourceType || detectImportSourceType(params.filePath, parsed);
  switch (sourceType) {
    case 'openapi':
      return importOpenApiDocument(parsed);
    case 'postman':
      return importPostmanCollection(parsed);
    case 'har':
      return importHarDocument(parsed);
    default:
      return importOpenApiDocument(parsed);
  }
}
