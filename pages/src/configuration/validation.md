# Validation

This chapter summarizes validator behavior from src/types/validator.ts.

## Root requirements

- Config must be an object.
- Endpoints must exist and be a non-empty array.
- Endpoint names must be unique.

## Numeric constraints

- Positive integers where documented for request and timeout fields
- Non-negative integers for throttle-like fields
- Ratios bounded in [0, 1] where applicable

## Role requirements in distributed mode

- Worker mode requires coordinatorUrl when distributed is enabled.
- Coordinator mode requires expectedWorkers when distributed is enabled.

## Transport requirements

### HTTP

- URL must be absolute http or https, or relative with leading slash.

### WebSocket

- URL must be absolute ws or wss.
- websocket.responseTimeoutMs must be a positive integer when provided.

### gRPC

When transport is grpc:

- grpc object is required.
- grpc.protoPath is required and non-empty.
- grpc.service and grpc.method are required and non-empty.
- grpc.metadata must be an object when provided.
- grpc.useTls must be a boolean when provided.

## Assertion and responseCheck operators

- equals
- contains
- exists
- matches

## Dependency integrity

- Every dependency must reference an endpoint name that exists in the same config.

## Example

Invalid:

```json
{ "global": { "concurrent": -1 }, "endpoints": [] }
```

Valid:

```json
{
  "global": { "concurrent": 2, "maxRequests": 20 },
  "endpoints": [{ "name": "health", "url": "/health", "method": "GET" }]
}
```

