# Observability

Glockit supports runtime observability for both metrics and traces.

## Prometheus

Prometheus export can expose metrics over HTTP.

Config section:

- global.observability.prometheus

Important fields:

- enabled
- host
- port
- path
- keepAlive

## OpenTelemetry metrics

Config section:

- global.observability.otel

Important fields:

- enabled
- endpoint
- headers
- intervalMs
- serviceName
- attributes

## OpenTelemetry traces

Config section:

- global.observability.otel.traces

Important fields:

- enabled
- endpoint
- headers
- serviceName
- attributes
- samplingRatio

## Practical advice

- Use serviceName and attributes consistently for filtering.
- Keep intervalMs aligned with benchmark duration.
- Start with lower samplingRatio for high-throughput runs.

## Example

```json
{
  "global": {
    "observability": {
      "prometheus": { "enabled": true, "port": 9464 },
      "otel": {
        "enabled": true,
        "endpoint": "http://localhost:4318/v1/metrics",
        "traces": { "enabled": true, "endpoint": "http://localhost:4318/v1/traces" }
      }
    }
  }
}
```

