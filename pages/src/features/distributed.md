# Distributed Execution

Distributed mode runs workloads through a coordinator and one or more workers.

## Roles

- coordinator: leases endpoint work and merges worker results
- worker: joins coordinator, polls plans, executes assigned endpoints, submits results

## Coordinator highlights

- worker join tracking
- endpoint leasing
- assignment strategy support
- stale worker handling and requeue
- status endpoint includes completed lease counts per worker

## Worker highlights

- heartbeat loop
- polling and plan execution
- result submission with retry and exponential backoff

## Key distributed fields

- role
- coordinatorUrl
- expectedWorkers
- joinTimeoutMs
- resultTimeoutMs
- pollIntervalMs
- heartbeatIntervalMs
- staleWorkerTimeoutMs
- leaseBatchSize
- maxInFlightLeasedEndpointsPerWorker
- assignmentStrategy
- authToken and authHeaderName

## Operational recommendation

Start with leaseBatchSize 1 and increase gradually while monitoring worker balance and endpoint completion behavior.

## Example

```json
{
  "global": {
    "distributed": {
      "enabled": true,
      "role": "coordinator",
      "expectedWorkers": 2,
      "staleWorkerTimeoutMs": 20000,
      "assignmentStrategy": "least-loaded"
    }
  }
}
```

