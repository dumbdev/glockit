# HTTP, WebSocket, and gRPC

## HTTP

HTTP is the default transport.

- Supports baseUrl composition
- Supports query parameters, headers, body, hooks, assertions
- Supports retries and timeout

## WebSocket

WebSocket transport opens a connection, sends message payload, and waits for response.

Relevant fields:

- transport: websocket
- url: ws or wss endpoint
- websocket.message
- websocket.subprotocol
- websocket.responseTimeoutMs

Behavior notes:

- Request is considered successful when a message is received within timeout.

## gRPC

gRPC transport supports unary calls with proto-driven client resolution.

Relevant fields:

- transport: grpc
- url: host:port target for grpc client
- grpc.protoPath
- grpc.package (optional)
- grpc.service
- grpc.method
- grpc.payload (optional)
- grpc.metadata (optional)
- grpc.useTls (optional)

Behavior notes:

- Runtime loads proto via proto-loader.
- Service and method are resolved dynamically.
- Call deadline is driven by endpoint timeout.

## Example

```json
{
  "endpoints": [
    { "name": "http-health", "transport": "http", "url": "/health", "method": "GET" },
    { "name": "grpc-ping", "transport": "grpc", "url": "grpc://localhost:50051/health.PingService/Ping", "method": "POST" },
    { "name": "ws-echo", "transport": "websocket", "url": "ws://localhost:8080/echo", "method": "GET" }
  ]
}
```

