# Security and Safety

## Sensitive data handling

- Avoid hard-coding secrets in config files.
- Use placeholders and environment-driven substitution where possible.
- Mask sensitive diagnostics keys.

## Hooks usage

- Keep hook logic minimal and deterministic.
- Avoid side effects that leak tokens or private data.

## Tokenized distributed mode

- Set authToken and authHeaderName for coordinator-worker APIs.
- Keep tokens out of source control.

## Observability data hygiene

- Do not export sensitive headers or payloads to telemetry backends.
- Reduce diagnostic sample size in shared environments.

## Example

```json
{
  "global": {
    "headers": { "authorization": "Bearer {{token}}" },
    "diagnostics": {
      "enabled": true,
      "maskKeys": ["authorization", "password", "token"]
    }
  }
}
```

