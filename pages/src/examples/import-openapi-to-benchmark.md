# Import OpenAPI to Benchmark

Use this flow to bootstrap a benchmark from an OpenAPI definition and refine it.

## Import command

```bash
glockit import -i openapi.yaml --type openapi -o benchmark.imported.json
```

## Review generated output

Check these fields after import:

- `global.baseUrl`
- endpoint `url` and `method`
- inferred query params
- auth headers and request examples

## Execute imported benchmark

```bash
glockit run -c benchmark.imported.json --save --reporters json,html
```

## Typical post-import edits

- Add endpoint-specific assertions.
- Remove low-value endpoints such as static docs routes.
- Add `slo` thresholds and diagnostics sampling.

## Example

```bash
# Import OpenAPI and run the produced benchmark
glockit import --openapi ./openapi.yaml --out ./benchmark.json
glockit run --config ./benchmark.json --save
```

