# Operations

This section focuses on running Glockit effectively in local, CI, and distributed environments.

Topics include performance tuning, troubleshooting, and security practices.

## Example

```bash
# Validate config quickly
glockit run --config benchmark.json --preview-feeder-only 3

# Full run with saved artifacts
glockit run --config benchmark.json --save --reporters json,html
```

