# Performance and SLO

## Key tuning levers

- concurrent
- maxRequests
- duration
- requestDelay
- executor and arrivalRate
- phase-specific concurrency and rate

## Practical tuning flow

1. Start with low concurrency.
2. Verify endpoint correctness and assertions.
3. Increase load gradually.
4. Watch p95, p99, and error rate.
5. Tune retries and timeout carefully.

## SLO gating

Use global.slo to enforce quality thresholds.

- maxErrorRate
- maxAvgResponseTimeMs
- p95Ms
- p99Ms
- minRequestsPerSecond

By default, SLO failure can produce non-zero process exit. Use no-fail-on-slo when needed.

## Example

```json
{
  "global": {
    "executor": "arrival-rate",
    "arrivalRate": 120,
    "loadShape": { "mode": "jitter", "jitterRatio": 0.1 },
    "coordinatedOmission": { "enabled": true }
  }
}
```

