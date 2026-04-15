# Endpoint Settings

Each endpoint represents one benchmarked target.

## Required fields

- name
- url
- method

## Optional common fields

- transport
- headers
- body
- query
- maxRequests
- throttle
- requestDelay
- weight
- retries
- http2
- beforeRequest
- afterRequest
- assertions
- responseCheck
- variables
- dependencies
- auth

## Transport-specific fields

### WebSocket

- websocket.message
- websocket.subprotocol
- websocket.responseTimeoutMs

### gRPC

- grpc.protoPath
- grpc.package
- grpc.service
- grpc.method
- grpc.payload
- grpc.metadata
- grpc.useTls

## Example with mixed transports

```json
{
  "endpoints": [
    {
      "name": "health",
      "transport": "http",
      "url": "https://api.example.com/health",
      "method": "GET"
    },
    {
      "name": "ws-echo",
      "transport": "websocket",
      "url": "wss://echo.websocket.events",
      "method": "GET",
      "websocket": {
        "message": { "op": "ping" },
        "responseTimeoutMs": 5000
      }
    },
    {
      "name": "grpc-echo",
      "transport": "grpc",
      "url": "127.0.0.1:50051",
      "method": "POST",
      "grpc": {
        "protoPath": "./protos/echo.proto",
        "service": "glockit.test.EchoService",
        "method": "Echo",
        "payload": { "message": "hello" }
      }
    }
  ]
}
```
