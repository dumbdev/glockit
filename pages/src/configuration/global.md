# Global Settings

Global settings apply across endpoints unless overridden.

## Core execution

- baseUrl
- maxRequests
- duration
- throttle
- concurrent
- timeout
- requestDelay

## Scheduling

- executor: concurrency or arrival-rate
- arrivalRate
- loadShape
- phases

## Data and flow

- dataFeeder
- headers
- summaryOnly
- scenarioMix
- virtualUsers
- transactionGroups

## Reliability and quality

- slo
- coordinatedOmission
- diagnostics

## Telemetry and outputs

- observability
- reporters

## Distributed mode

- distributed

## Example

```json
{
  "global": {
    "baseUrl": "https://api.example.com",
    "maxRequests": 200,
    "concurrent": 10,
    "timeout": 15000,
    "executor": "arrival-rate",
    "arrivalRate": 30,
    "reporters": [
      { "type": "json", "path": "./out/result.json" },
      { "type": "html", "path": "./out/result.html" }
    ]
  }
}
```
