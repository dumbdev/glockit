# WebSocket Check Example

Use this scenario to verify WebSocket request/response behavior and timeout handling.

## Echo endpoint validation

```json
{
  "name": "ws-echo-check",
  "global": {
    "maxRequests": 50,
    "concurrent": 4,
    "timeout": 10000,
    "summaryOnly": true
  },
  "endpoints": [
    {
      "name": "echo-ping",
      "transport": "websocket",
      "url": "wss://echo.websocket.events",
      "method": "GET",
      "websocket": {
        "message": { "op": "ping", "requestId": "{{$uuid}}" },
        "responseTimeoutMs": 5000
      }
    }
  ]
}
```

Run:

```bash
glockit run -c ws.json
```

## Notes

- Use `responseTimeoutMs` to fail fast on slow or silent endpoints.
- Keep payloads deterministic while validating protocol correctness.
- Prefer a dedicated test channel for non-echo real systems.

## Example

```json
{
  "name": "ws-check",
  "global": { "maxRequests": 20, "concurrent": 2 },
  "endpoints": [
    { "name": "ws-echo", "transport": "websocket", "url": "ws://localhost:8080/echo", "method": "GET" }
  ]
}
```

