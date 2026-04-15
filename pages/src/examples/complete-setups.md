# Complete Setups

## Full all-features JSON setup

```json
{
  "name": "full-all-features",
  "global": {
    "baseUrl": "https://api.example.com",
    "maxRequests": 200,
    "duration": 120000,
    "concurrent": 8,
    "timeout": 15000,
    "requestDelay": 10,
    "executor": "arrival-rate",
    "arrivalRate": 30,
    "loadShape": {
      "mode": "step",
      "steps": [
        { "afterMs": 0, "rate": 10 },
        { "afterMs": 30000, "rate": 30 },
        { "afterMs": 60000, "rate": 50 }
      ]
    },
    "phases": [
      { "name": "warmup", "duration": 10000, "concurrent": 2 },
      { "name": "steady", "duration": 60000, "concurrent": 8 }
    ],
    "dataFeeder": { "path": "./data.csv", "format": "csv", "strategy": "random" },
    "summaryOnly": false,
    "slo": {
      "maxErrorRate": 0.01,
      "maxAvgResponseTimeMs": 300,
      "p95Ms": 700,
      "p99Ms": 1200,
      "minRequestsPerSecond": 8
    },
    "coordinatedOmission": { "enabled": true, "expectedIntervalMs": 50 },
    "scenarioMix": {
      "enabled": true,
      "strategy": "weighted-random",
      "scenarios": [
        { "name": "browse", "weight": 3, "flow": ["health", "users"] },
        { "name": "write", "weight": 1, "flow": ["create-user"] }
      ]
    },
    "virtualUsers": { "sessionScope": true, "persistCookies": true },
    "transactionGroups": [
      { "name": "core", "endpoints": ["health", "users", "create-user"] }
    ],
    "diagnostics": {
      "enabled": true,
      "sampleSize": 20,
      "maskKeys": ["authorization", "password"],
      "maxBodyLength": 4096,
      "includeHeaders": true
    },
    "observability": {
      "prometheus": { "enabled": true, "host": "127.0.0.1", "port": 9464, "path": "/metrics", "keepAlive": true },
      "otel": {
        "enabled": true,
        "endpoint": "http://localhost:4318/v1/metrics",
        "intervalMs": 5000,
        "serviceName": "glockit-bench",
        "attributes": { "env": "local" },
        "traces": {
          "enabled": true,
          "endpoint": "http://localhost:4318/v1/traces",
          "samplingRatio": 0.2
        }
      }
    },
    "reporters": [
      { "type": "json", "path": "./out/result.json" },
      { "type": "csv", "path": "./out/result.csv" },
      { "type": "html", "path": "./out/result.html" },
      { "type": "junit", "path": "./out/result.xml" }
    ]
  },
  "endpoints": [
    {
      "name": "health",
      "transport": "http",
      "url": "/health",
      "method": "GET",
      "query": { "verbose": true },
      "assertions": [
        { "path": "status", "operator": "exists" }
      ],
      "responseCheck": [
        { "path": "content-type", "operator": "contains", "value": "json" }
      ]
    },
    {
      "name": "users",
      "transport": "http",
      "url": "/users",
      "method": "GET",
      "dependencies": ["health"]
    },
    {
      "name": "create-user",
      "transport": "http",
      "url": "/users",
      "method": "POST",
      "body": { "name": "{{$randomWord}}", "email": "{{$uuid}}@example.com" },
      "dependencies": ["health"]
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
        "package": "glockit.test",
        "service": "EchoService",
        "method": "Echo",
        "payload": { "message": "hello" },
        "metadata": { "x-tenant": "demo" },
        "useTls": false
      }
    }
  ]
}
```

## Distributed coordinator setup

```json
{
  "global": {
    "distributed": {
      "enabled": true,
      "role": "coordinator",
      "expectedWorkers": 2,
      "host": "127.0.0.1",
      "port": 9876,
      "joinTimeoutMs": 60000,
      "resultTimeoutMs": 300000,
      "staleWorkerTimeoutMs": 10000,
      "authToken": "shared-token",
      "authHeaderName": "x-glockit-token",
      "leaseBatchSize": 2,
      "maxInFlightLeasedEndpointsPerWorker": 1,
      "assignmentStrategy": "least-loaded"
    }
  },
  "endpoints": [
    { "name": "a", "url": "https://api.example.com/a", "method": "GET" },
    { "name": "b", "url": "https://api.example.com/b", "method": "GET" }
  ]
}
```

## Distributed worker setup

```json
{
  "global": {
    "distributed": {
      "enabled": true,
      "role": "worker",
      "coordinatorUrl": "http://127.0.0.1:9876",
      "workerId": "worker-1",
      "pollIntervalMs": 500,
      "heartbeatIntervalMs": 5000,
      "resultSubmitRetries": 3,
      "resultSubmitBackoffMs": 1000,
      "authToken": "shared-token",
      "authHeaderName": "x-glockit-token"
    }
  },
  "endpoints": [
    { "name": "placeholder", "url": "https://api.example.com/placeholder", "method": "GET" }
  ]
}
```

## Example

```bash
# Run full setup with multiple reporters and baseline compare
glockit run --config benchmark.yaml --save --reporters json,csv,html,junit --compare-with ./prev.json
```

