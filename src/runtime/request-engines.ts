import WebSocket from 'ws';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EndpointConfig } from '../types';

export interface TransportResponse {
  status: number;
  data: any;
  headers: Record<string, string>;
}

export async function executeWebSocketRequest(params: {
  endpoint: EndpointConfig;
  url: string;
  headers: Record<string, string>;
  body: any;
  timeout: number;
}): Promise<TransportResponse> {
  const { endpoint, url, headers, body, timeout } = params;
  const responseTimeoutMs = endpoint.websocket?.responseTimeoutMs ?? timeout;

  return new Promise<TransportResponse>((resolve, reject) => {
    const subprotocol = endpoint.websocket?.subprotocol;
    const ws = subprotocol
      ? new WebSocket(url, subprotocol, { headers, handshakeTimeout: responseTimeoutMs })
      : new WebSocket(url, { headers, handshakeTimeout: responseTimeoutMs });

    const payload = endpoint.websocket?.message !== undefined ? endpoint.websocket.message : body;
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => {
        ws.close();
        reject(new Error(`WebSocket response timeout after ${responseTimeoutMs}ms`));
      });
    }, responseTimeoutMs);

    ws.on('open', () => {
      try {
        if (payload !== undefined) {
          const dataToSend = typeof payload === 'string' || Buffer.isBuffer(payload)
            ? payload
            : JSON.stringify(payload);
          ws.send(dataToSend);
        }
      } catch (error) {
        settle(() => {
          ws.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    });

    ws.on('message', (message, isBinary) => {
      settle(() => {
        ws.close();
        const data = isBinary ? message : message.toString('utf8');
        resolve({
          status: 200,
          data,
          headers: {
            'x-glockit-transport': 'websocket'
          }
        });
      });
    });

    ws.on('error', (error) => {
      settle(() => {
        ws.close();
        reject(error);
      });
    });

    ws.on('close', () => {
      settle(() => {
        reject(new Error('WebSocket closed before receiving a response message'));
      });
    });
  });
}

function resolveNested(target: Record<string, any>, dottedPath: string): any {
  return dottedPath.split('.').reduce<any>((acc, segment) => (acc ? acc[segment] : undefined), target);
}

function normalizeGrpcTarget(raw: string): string {
  return raw
    .replace(/^grpc:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^dns:\/\//i, '');
}

export async function executeGrpcRequest(params: {
  endpoint: EndpointConfig;
  url: string;
  headers: Record<string, string>;
  body: any;
  timeout: number;
}): Promise<TransportResponse> {
  const { endpoint, url, body, timeout } = params;
  const grpcConfig = endpoint.grpc;

  if (!grpcConfig) {
    throw new Error('gRPC transport requires endpoint.grpc configuration');
  }

  const packageDefinition = await protoLoader.load(grpcConfig.protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });

  const loaded = grpc.loadPackageDefinition(packageDefinition) as Record<string, any>;
  const servicePath = grpcConfig.package
    ? `${grpcConfig.package}.${grpcConfig.service}`
    : grpcConfig.service;
  const ServiceClient = resolveNested(loaded, servicePath);

  if (!ServiceClient) {
    throw new Error(`Unable to resolve gRPC service client: ${servicePath}`);
  }

  const target = normalizeGrpcTarget(url);
  const credentials = grpcConfig.useTls
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();
  const client = new ServiceClient(target, credentials);

  try {
    const rpcMethod = grpcConfig.method;
    if (typeof client[rpcMethod] !== 'function') {
      throw new Error(`gRPC method not found on service ${servicePath}: ${rpcMethod}`);
    }

    const metadata = new grpc.Metadata();
    for (const [key, value] of Object.entries(grpcConfig.metadata || {})) {
      metadata.set(key, value);
    }

    const requestPayload = grpcConfig.payload !== undefined
      ? grpcConfig.payload
      : body !== undefined
        ? body
        : {};

    const data = await new Promise<any>((resolve, reject) => {
      (client[rpcMethod] as Function)(
        requestPayload,
        metadata,
        { deadline: new Date(Date.now() + timeout) },
        (error: grpc.ServiceError | null, response: any) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(response);
        }
      );
    });

    return {
      status: 200,
      data,
      headers: {
        'x-glockit-transport': 'grpc'
      }
    };
  } finally {
    client.close();
  }
}