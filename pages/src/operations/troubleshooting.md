# Troubleshooting

## Common issues

## Configuration validation errors

- Ensure all required fields are present.
- Confirm transport-specific requirements are met.
- Check distributed role-specific required fields.

## Import mismatch

- Validate source file format and type.
- Use type auto first, then force explicit type if needed.
- Review imported endpoint names and methods.

## WebSocket and gRPC runtime issues

- Confirm endpoint target is reachable.
- For WebSocket, ensure ws or wss URL.
- For gRPC, verify protoPath, service, method, and package alignment.

## Distributed run stalls

- Verify coordinator and worker auth token/header settings.
- Check heartbeat and stale timeout settings.
- Inspect coordinator status for pending endpoints and active assignments.

## Report generation confusion

- Confirm save and reporters settings.
- Check output directory permissions.

## Example

```bash
# 1) Validate benchmark config shape
glockit run --config benchmark.json --no-progress

# 2) Collect detailed artifacts for debugging
glockit run --config benchmark.json --save --reporters json,html,junit
```

```text
Symptom: SLO failed (p95 high)
Action: lower concurrency or switch to phased ramp-up and re-run baseline comparison.
```

