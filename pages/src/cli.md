# CLI

## Command overview

- glockit run
- glockit import
- glockit example

## glockit run

Run benchmarks from a config file.

### Options

- -c, --config <file>: config path
- -o, --output <dir>: output directory when saving reports
- --no-progress: disable progress UI
- -d, --delay <ms>: request delay override
- --save: save reports to disk
- --reporters <list>: comma-separated reporters, example json,csv,html,junit
- --compare-with <file>: compare against previous JSON result
- --preview-feeder [count]: preview feeder rows and continue
- --preview-feeder-only [count]: preview feeder rows and exit
- --no-fail-on-slo: do not fail process on SLO miss

### Examples

```bash
glockit run -c benchmark.yaml
glockit run -c benchmark.json --save --reporters json,csv,html
glockit run -c benchmark.json --compare-with previous.json
glockit run -c benchmark.json --preview-feeder-only 5
```

## glockit import

Import benchmark configs from OpenAPI, Postman, or HAR.

### Options

- -i, --input <file>: input file path, required
- -t, --type <type>: auto, openapi, postman, har
- -o, --output <file>: output path for generated benchmark config

### Examples

```bash
glockit import -i openapi.yaml --type openapi -o benchmark.imported.yaml
glockit import -i postman.json --type postman -o benchmark.imported.json
glockit import -i traffic.har --type har -o benchmark.imported.json
```

## glockit example

Generate an example benchmark config file.

### Example

```bash
glockit example -o benchmark.json
```
