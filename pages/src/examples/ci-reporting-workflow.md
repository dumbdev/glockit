# CI Reporting Workflow Example

Use this pattern to run a benchmark in CI and persist machine-readable and visual artifacts.

## Benchmark config fragment

```json
{
  "global": {
    "reporters": [
      { "type": "json", "path": "./out/result.json" },
      { "type": "junit", "path": "./out/result.xml" },
      { "type": "html", "path": "./out/result.html" }
    ],
    "slo": {
      "maxErrorRate": 0.02,
      "p95Ms": 800
    }
  }
}
```

## CI command

```bash
glockit run -c benchmark.json --save --reporters json,junit,html
```

## Pipeline behavior

- Parse `result.xml` with your test-report publisher.
- Publish `result.html` as a build artifact.
- Archive `result.json` for trend comparisons.

## Compare with baseline

```bash
glockit run -c benchmark.json --compare-with ./baseline/result.json --save --reporters json,html
```

## Example

```bash
# CI-friendly run with JUnit output
glockit run --config benchmark.json --save --reporters junit,json --no-progress
```

