# companion-module-influxdb-apiv2

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Development

```bash
corepack enable
yarn install
yarn test
yarn lint
yarn package
```

# Changelog

## 2.0.0

Requires **Companion 5.0 or later** (module API 2.1). Existing connections and buttons from 1.x carry over: the API token moves into Companion's secret store automatically, and every existing action keeps its options.

### New

- **Write Point** action: any number of fields, typed like line protocol (`21.5`, `3i`, `3u`, `true`, `"text"`), an optional timestamp, and a per-action bucket or organization
- **Run Flux Query** action (InfluxDB 2.x): returns the first value, the first row, all rows or a row count, which Companion can store in a variable
- Variables: connection status and message, server version, points queued and written, write errors, last error, last write time
- Feedbacks: **Connection OK** and **Writes failing**
- Presets: connection status, counters, flush, and a button that logs its own presses
- Settings: default tags, flush interval, batch size, retries, request timeout, gzip, ignore TLS errors, health check interval

### Changed

- The API token is stored as a secret
- Points are sent every second by default (previously every 60 seconds); see **Flush interval**
- Every option accepts variables, and any option can be switched to an expression
- Default tags are added by Write Point and the single-field point actions, not by the raw Write action
- The connection status shows why writes fail (unreachable server, rejected token, missing organization or bucket, rejected data) and checks the token, organization and bucket at startup and periodically without writing any data

### Fixed

- Write Float Point wrote `$(...)` literally in the measurement and field name
- Buffered points were lost when the connection was disabled or its settings changed
- Write failures were never reported; a wrong token still showed OK
- Tags: empty tags, values containing `=`, extra spaces, escaped commas and backslashes
- The Write action produced invalid line protocol with empty tags, and imprecise timestamps
- Write Boolean Point accepts true/false, 1/0, yes/no and on/off from expressions

## 1.0.0

- Initial release
