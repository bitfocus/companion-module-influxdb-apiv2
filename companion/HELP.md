## InfluxDB

Writes data points to InfluxDB 2.x. InfluxDB 3 (Core, Enterprise and Cloud) also works through its v2-compatible write API.

### Configuration

- **InfluxDB URL** (required): for example `http://localhost:8086` (InfluxDB 2.x) or `http://localhost:8181` (InfluxDB 3).
- **API Token**: a token with write access to the bucket. It is stored as a secret.
- **Organization**: name or ID of the organization. Required for InfluxDB 2.x; InfluxDB 3 ignores it.
- **Bucket** (required): name or ID of the bucket (on InfluxDB 3 this is the database name).
- **Default tags**: tags added to every point written by the point actions, for example `site=main,source=companion`.

Advanced settings:

- **Flush interval / Batch size**: writes are buffered and sent in batches. The buffer is sent every flush interval (default 1 second), or as soon as it holds a batch's worth of points.
- **Max retries**: how many times a write is retried after a temporary error, such as the server being unavailable.
- **Request timeout**, **Compress writes (gzip)**, **Ignore TLS certificate errors** (only for self-signed certificates on a trusted network).
- **Health check interval**: how often the connection checks that InfluxDB is reachable. Set it to 0 to disable.

The connection status shows the reason for problems: an unreachable server, a rejected token, a missing organization or bucket, or data rejected by InfluxDB. It goes back to OK as soon as writes succeed again.

### Actions

Every text option accepts variables, and any option can be switched to an expression.

- **Write Point**: write one point with any number of fields. Fields are comma separated `key=value` pairs, and the type comes from how the value is written, as in line protocol:
  - `21.5` or `1e3`: float
  - `3i`: integer, `3u`: unsigned integer
  - `true` / `false` (also `t`, `f`, `True`, `FALSE`, ...): boolean
  - `"some text"`: string. Commas and `=` are fine inside the quotes; write `\"` for a quote.

  For example `temp=21.5, count=3i, ok=true, note="studio A"`. Leave **Timestamp** empty to use the time of the press, or give a number in the chosen precision or a date such as `2026-10-31T09:00:00Z`. **Bucket** and **Organization** can override the connection's settings for this action.

- **Write Float Point**, **Write String Point**, **Write Boolean Point**: write one point with a single field. The measurement, tags and field name are escaped for you.
- **Write**: write one raw line of line protocol from a measurement, tags and fields. String field values must be in double quotes, and you are responsible for escaping. The timestamp is added automatically.
- **Flush Buffer**: send everything that is buffered now.

**Tags** are comma separated `key=value` pairs, for example `room=studio,source=companion`. Leave the field empty for no tags. Values may contain `=`. Write `\,` for a literal comma.

For **Write Boolean Point** in expression mode, the expression can return `true`/`false`, `1`/`0`, `yes`/`no` or `on`/`off`.

### Feedbacks

- **Connection OK**: true while InfluxDB is reachable, the token is accepted and writes are succeeding.
- **Writes failing**: true when writes are being rejected, the server is unreachable or the config is wrong.

### Variables

| Variable             | Description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| `connection_status`  | OK, Connecting, Bad config, Connection failure, Authentication failure, ... |
| `connection_message` | Why the connection is not OK (empty when it is)                             |
| `server_version`     | InfluxDB server version                                                     |
| `points_queued`      | Points queued since the connection started                                  |
| `points_written`     | Points InfluxDB accepted since the connection started                       |
| `write_errors`       | Failed write attempts since the connection started                          |
| `last_error`         | The last write error                                                        |
| `last_write_time`    | Time of the last successful write (HH:MM:SS)                                |

The counters reset when the connection restarts or its settings change.

### Presets

- **Status**: a connection status button (green when OK, red when writes fail, press to flush), points written, and last write time.
- **Writing**: a button that logs its own presses, and a flush button.
