# Reporting and UI

Glockit supports multiple output report types.

## Built-in reporters

- json
- csv
- html
- junit

## HTML report capabilities

The HTML report includes:

- benchmark summary cards
- endpoint table
- interactive controls:
  - search
  - sort
  - failed-only filter
- mini charts:
  - latency bars
  - throughput bars
- endpoint drilldown panel:
  - endpoint metadata
  - phase results
  - recent errors

## JUnit report

The JUnit report is CI-friendly and includes endpoint-level suite and testcase details with failures.

## Custom reporters

Custom reporters can be registered through the API and invoked through reporter output entries.

## Example

```json
{
  "global": {
    "reporters": [
      { "type": "json", "path": "./out/result.json" },
      { "type": "html", "path": "./out/result.html" },
      { "type": "junit", "path": "./out/result.xml" }
    ]
  }
}
```

