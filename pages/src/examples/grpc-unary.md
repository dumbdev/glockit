# gRPC Unary Example

Use this example to benchmark unary gRPC methods with metadata and payload assertions.

## Benchmark config

```json
{
  "name": "grpc-unary",
  "global": {
    "maxRequests": 300,
    "concurrent": 10,
    "timeout": 8000,
    "reporters": [
      { "type": "json", "path": "./out/grpc.json" },
      { "type": "html", "path": "./out/grpc.html" }
    ]
  },
  "endpoints": [
    {
      "name": "echo",
      "transport": "grpc",
      "url": "127.0.0.1:50051",
      "method": "POST",
      "grpc": {
        "protoPath": "./protos/echo.proto",
        "package": "glockit.test",
        "service": "EchoService",
        "method": "Echo",
        "payload": { "message": "hello" },
        "metadata": { "x-tenant": "perf" },
        "useTls": false,
        "deadlineMs": 3000
      }
    }
  ]
}
```

Run:

```bash
glockit run -c grpc.json --save --reporters json,html
```

## Common adjustments

- Switch `useTls` to `true` for production-like runs.
- Increase `deadlineMs` for large payload methods.
- Split methods into separate endpoints to compare latency profiles.

## Example

```json
{
  "name": "grpc-unary-check",
  "global": { "maxRequests": 50, "concurrent": 5 },
  "endpoints": [
    { "name": "grpc-ping", "transport": "grpc", "url": "grpc://localhost:50051/health.PingService/Ping", "method": "POST" }
  ]
}
```

