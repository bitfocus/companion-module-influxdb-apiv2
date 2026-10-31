## InfluxDB

Writes data points to InfluxDB 2.x and runs Flux queries. Writing to InfluxDB 3 (Core, Enterprise and Cloud) should also work through its v2-compatible write API, but the module has only been tested with InfluxDB 2.x, and Run Flux Query needs InfluxDB 2.x.

### Configuration

- **InfluxDB URL** (required): for example `http://localhost:8086` (InfluxDB 2.x) or `http://localhost:8181` (InfluxDB 3).
- **API Token**: a token with write access to the bucket (and read access if you use Run Flux Query). It is stored as a secret.
- **Organization**: name or ID of the organization. Required for InfluxDB 2.x; InfluxDB 3 ignores it.
- **Bucket** (required): name or ID of the bucket (on InfluxDB 3 this is the database name).
- **Default tags**: tags added to every point written by Write Point and the Float/String/Boolean point actions (not the raw **Write** action), for example `site=main,source=companion`.

Advanced settings:

- **Flush interval / Batch size**: writes are buffered and sent in batches. The buffer is sent every flush interval (default 1 second), or as soon as it holds a batch's worth of points.
- **Max retries**: how many times a write is retried after a temporary error, such as the server being unavailable.
- **Request timeout**, **Compress writes (gzip)**, **Ignore TLS certificate errors** (only for self-signed certificates on a trusted network).
- **Health check interval**: how often the connection checks that InfluxDB is reachable and that the token can write to the organization and bucket (without writing any data). The check also runs when the connection starts. Set it to 0 to disable the periodic check.

The connection status shows the reason for problems with the configured bucket: an unreachable server, a rejected token, a missing organization or bucket, or data rejected by InfluxDB. It goes back to OK as soon as writes succeed again. Failures when an action writes to its own **Bucket** or **Organization** don't change the status; they appear in the log and in the `last_error` and `write_errors` variables.

### Actions

Every text option accepts variables, and most options can be switched to an expression. If an action can't build its point (a missing measurement, a value that is not a number, or no usable field), a warning is logged and that action writes nothing. Individual tags or Write Point fields that can't be used are skipped with a warning, and the rest of the point is still written.

- **Write Point**: write one point with any number of fields. Fields are comma separated `key=value` pairs, and the type comes from how the value is written, as in line protocol:
  - `21.5` or `1e3`: float
  - `3i`: integer, `3u`: unsigned integer
  - `true` / `false` (also `t`, `f`, `True`, `FALSE`, ...): boolean
  - `"some text"`: string. Commas and `=` are fine inside the quotes; write `\"` for a quote.

  Integers must fit in 64 bits, and floats must be finite. Field names follow the same escaping rules as tags (see below). A field that can't be read or is out of range is skipped with a warning; the point is not written if no field is valid.

  For example `temp=21.5, count=3i, ok=true, note="studio A"`. Leave **Timestamp** empty to use the time of the press, or give a number in the chosen precision or a date such as `2026-10-31T09:00:00Z`. A date and time without `Z` or an offset is read in the Companion computer's time zone; a date on its own is UTC. **Bucket** and **Organization** can override the connection's settings for this action. Up to 20 overrides are kept open at once; when more are used, the least recently used one is flushed and closed. Failures on an override are reported in the log and the `last_error` variable rather than the connection status.

- **Write Float Point**, **Write String Point**, **Write Boolean Point**: write one point with a single field. The measurement, tags and field name are escaped for you (apart from the backslash rule below).
- **Write**: write one raw line of line protocol from a measurement, tags and fields. String field values must be in double quotes, and you are responsible for escaping. The timestamp is added automatically. Default tags are not added to this action.
- **Flush Buffer**: send everything that is buffered now.
- **Run Flux Query**: run a Flux query (InfluxDB 2.x) and return the result. In the action's **Store Action Result** setting, choose a local, page or custom variable to keep it in, then use that variable on the button or in later actions. **Return** picks what comes back:
  - the `_value` of the first row (the default; pair it with `|> last()` to show the latest reading)
  - the first row, as an object
  - all rows, as a list (up to **Maximum rows**)
  - the number of rows

  **Organization** can override the connection's organization for this query. An empty result returns nothing (null), or 0 rows. The token needs read access to the bucket. Errors such as a Flux syntax error or a missing bucket appear in the connection log. Variables in the query are replaced before it runs, so a query can depend on other buttons.

**Tags** are comma separated `key=value` pairs, for example `room=studio,source=companion`. Leave the field empty for no tags. Values may contain `=` and spaces. These backslash escapes are understood:

- `\,` a comma (otherwise a comma starts the next tag)
- `\=` an equals sign in a tag key
- a backslash before a space keeps a space at the start or end of a value, which is otherwise trimmed
- `\\` a single backslash, for example `\\\\nas\media` for the path `\\nas\media`

The escapes also apply to text that comes from variables, so a variable holding `\\nas\media` is stored as `\nas\media`. Any other backslash is kept as is (for example `C:\temp`). Measurements need no escapes: type commas and spaces as they are. A backslash that is left over after these escapes can't be the last character of a tag, measurement or field name, or come right before a comma, equals sign or space; InfluxDB would misread the line, so the module refuses it with a warning.

For **Write Boolean Point** in expression mode, the expression can return `true`/`false`, `1`/`0`, `yes`/`no` or `on`/`off`.

### Feedbacks

- **Connection OK**: true while InfluxDB is reachable, the token is accepted and writes to the configured bucket are succeeding.
- **Writes failing**: true when writes to the configured bucket are being rejected, the server is unreachable or the config is wrong. Failures on an action's own bucket don't affect either feedback.

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
