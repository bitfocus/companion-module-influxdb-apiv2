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

## Unreleased (2.0.0)

- Requires Companion 5.0 or later (module API 2.1)
- The API token is now stored as a secret
- Writes are flushed every second by default (previously every 60 seconds), configurable along with batch size, retries, timeout, gzip and TLS options
- New default tags setting, applied to every point
- Connection status now reports failed writes (bad token, missing bucket or org, rejected data) and runs periodic health checks
- Buffered points are flushed when the connection is disabled or its config changes, instead of being lost
- Fixed Write Float Point ignoring variables in the measurement and field name
- Fixed tag parsing: empty tags, values containing `=`, whitespace and escaped commas
- Fixed the Write action producing invalid line protocol with empty tags, and imprecise timestamps
- Write Boolean Point accepts expressions (true/false, 1/0, yes/no, on/off)

## 1.0.0

- Initial release
