# HTTP Smoke and Load Examples

Use these examples to validate an API quickly, then scale to sustained load.

## Smoke test (fast signal)

```json
{
  "name": "http-smoke",
  "global": {
    "baseUrl": "https://api.example.com",
    "maxRequests": 20,
    "concurrent": 1,
    "timeout": 5000,
    "summaryOnly": true
  },
  "endpoints": [
    {
      "name": "health",
      "transport": "http",
      "url": "/health",
      "method": "GET",
      "expectStatus": [200]
    },
    {
      "name": "users-list",
      "transport": "http",
      "url": "/users",
      "method": "GET",
      "query": { "limit": 10 },
      "expectStatus": [200]
    }
  ]
}
```

Run:

```bash
glockit run -c smoke.json
```

## Sustained load test (steady-state)

```json
{
  "name": "http-load",
  "global": {
    "baseUrl": "https://api.example.com",
    "duration": 120000,
    "concurrent": 12,
    "timeout": 10000,
    "requestDelay": 5,
    "slo": {
      "maxErrorRate": 0.01,
      "p95Ms": 600
    },
    "reporters": [
      { "type": "json", "path": "./out/http-load.json" },
      { "type": "html", "path": "./out/http-load.html" }
    ]
  },
  "endpoints": [
    {
      "name": "get-products",
      "transport": "http",
      "url": "/products",
      "method": "GET"
    },
    {
      "name": "get-product",
      "transport": "http",
      "url": "/products/{{id}}",
      "method": "GET",
      "data": { "id": 42 }
    }
  ]
}
```

Run and save reports:

```bash
glockit run -c load.json --save --reporters json,html
```

## Example

```bash
# smoke
glockit run --config smoke.json --no-progress

# load
glockit run --config load.json --save --reporters html,json
```

