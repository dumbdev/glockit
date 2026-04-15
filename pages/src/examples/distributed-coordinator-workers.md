# Distributed Coordinator and Workers

Use this setup to run one coordinator with multiple workers and bounded in-flight leases.

## Coordinator config

```json
{
  "global": {
    "distributed": {
      "enabled": true,
      "role": "coordinator",
      "host": "127.0.0.1",
      "port": 9876,
      "expectedWorkers": 2,
      "joinTimeoutMs": 60000,
      "resultTimeoutMs": 300000,
      "staleWorkerTimeoutMs": 15000,
      "leaseBatchSize": 2,
      "maxInFlightLeasedEndpointsPerWorker": 1,
      "assignmentStrategy": "least-loaded",
      "authToken": "shared-token",
      "authHeaderName": "x-glockit-token"
    }
  },
  "endpoints": [
    { "name": "a", "url": "https://api.example.com/a", "method": "GET" },
    { "name": "b", "url": "https://api.example.com/b", "method": "GET" },
    { "name": "c", "url": "https://api.example.com/c", "method": "GET" }
  ]
}
```

## Worker config

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
    { "name": "placeholder", "url": "https://api.example.com/ping", "method": "GET" }
  ]
}
```

## Run sequence

```bash
glockit run -c coordinator.json
glockit run -c worker-1.json
glockit run -c worker-2.json
```

## Verify coordinator output

Look for worker lease completion counts in the distributed summary.

## Example

Coordinator:

```bash
glockit run --config coordinator.json
```

Worker:

```bash
glockit run --config worker.json
```

