# Features

Glockit combines request execution, workload shaping, diagnostics, telemetry, and reporting.

## Major capabilities

- Multi-transport execution: HTTP, WebSocket, gRPC unary
- API definition import: OpenAPI, Postman, HAR
- Distributed coordinator-worker orchestration
- Interactive reporting and standard artifact outputs
- Validation, assertions, and response checks
- Scenario mix, phases, and arrival-rate control

Use the chapters in this section for deep usage and operational notes.

## Example

```json
{
  "global": {
    "scenarioMix": {
      "enabled": true,
      "scenarios": [
        { "name": "browse", "weight": 3, "flow": ["health", "catalog"] },
        { "name": "checkout", "weight": 1, "flow": ["login", "cart", "pay"] }
      ]
    }
  }
}
```

