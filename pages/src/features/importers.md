# Importers

Glockit can import benchmark configs from:

- OpenAPI
- Postman
- HAR

## Command

```bash
glockit import -i <input-file> -t <auto|openapi|postman|har> -o <output-file>
```

## OpenAPI mapping

- paths and operations become endpoints
- operationId is preferred for endpoint names
- request examples from requestBody are mapped to endpoint body
- parameter mappings:
  - query parameters map to endpoint query
  - header parameters map to endpoint headers
- security mappings:
  - bearer auth maps Authorization header placeholder
  - basic auth maps Authorization header placeholder
  - api key in header maps to header placeholder

## Postman mapping

- request items become endpoints
- URL and method are mapped directly
- header arrays map to endpoint headers
- URL query arrays map to endpoint query
- auth mapping includes bearer, basic, and api key
- raw request body is parsed as JSON when possible

## HAR mapping

- request entries become endpoints
- method and URL are mapped directly
- request headers map to endpoint headers
- queryString entries map to endpoint query
- postData text maps to endpoint body

## Best practices after import

1. Validate and run a dry benchmark first.
2. Add dependencies and variable extraction where needed.
3. Add assertions and response checks for correctness.
4. Tune concurrency and timeout settings for target environment.

## Example

```bash
glockit import --openapi ./openapi.yaml --out ./generated-benchmark.json
glockit run --config ./generated-benchmark.json
```

