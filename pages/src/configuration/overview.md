# Configuration

A benchmark config has this top-level structure:

```json
{
  "name": "optional benchmark name",
  "global": { "...": "global settings" },
  "endpoints": [
    { "...": "endpoint settings" }
  ]
}
```

## Primary sections

- Global: shared runtime behavior and feature toggles
- Endpoints: individual request targets and transport-specific execution
- Derived features: scenario mix, diagnostics, observability, distributed mode, and reporting

Use the pages in this section for complete field-level references and constraints.

## Example

```json
{
  "name": "config-overview",
  "global": {
    "baseUrl": "https://api.example.com",
    "maxRequests": 100,
    "concurrent": 10,
    "timeout": 5000
  },
  "endpoints": [
    { "name": "health", "url": "/health", "method": "GET" },
    { "name": "users", "url": "/users", "method": "GET" }
  ]
}
```

