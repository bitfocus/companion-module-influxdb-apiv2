# influxdb-apiv2 — Audit & Modernization Plan

_Audited 2026-10-30 at `e5a07d9` (tag v1.0.2)._

## Progress

- **Phases A and B are done** on branch `feat/v2-modernize`.
- **Target:** base `~2.1.3` (Companion 5.0+), `node22` runtime, plain CommonJS JS.
- **ESM entry file:** `src/index.mjs` re-exports `default` and `UpgradeScripts`. The CommonJS-only entry from the docs loses the named `UpgradeScripts` export once the build tool bundles it (Companion reads `moduleImport.UpgradeScripts` from the ESM namespace).
- **Kept as before:** action option shapes. The Boolean value stays a dropdown, now with `allowInvalidValues`, so no option upgrade script is needed. The only upgrade script moves the token into secrets.
- **Tests:** written against the fixed behaviour rather than as characterization tests, since those would have locked the bugs in. A fake InfluxDB HTTP server covers writes, auth errors, close/flush and the instance lifecycle.
- **Not done yet:** a live test against a real InfluxDB, and Phases C–E.

## 1. What exists today

| Area                            | State                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language / layout               | Plain CommonJS JS in repo root (`main.js`, `actions.js`, `feedbacks.js`, `variables.js`, `upgrades.js`). No TypeScript, ESLint, tests, or build step.          |
| `@companion-module/base`        | `~1.7.0` (current: **2.2.2**; v1 line is on 1.15.1)                                                                                                            |
| `@companion-module/tools`       | `^1.4.2` (current: **3.2.0**)                                                                                                                                  |
| InfluxDB client                 | `@influxdata/influxdb-client(-apis)` `^1.33.2` (current 1.35.0; this client is in maintenance mode — InfluxData's v3 client is `@influxdata/influxdb3-client`) |
| Package manager                 | Yarn classic v1 lockfile (template now uses Yarn 4)                                                                                                            |
| Manifest                        | `runtime.type: node18` (no longer accepted by v2), no `"type": "connection"`, no `$schema`, `name` is the id rather than a display name                        |
| Config                          | URL, token (plain textinput), org, bucket                                                                                                                      |
| Actions                         | Write Float / String / Boolean Point, raw "Write" line, Flush Buffer                                                                                           |
| Feedbacks / variables / presets | None (empty stubs; HELP.md says TODO)                                                                                                                          |
| Upgrade scripts                 | None                                                                                                                                                           |
| CI                              | `companion-module-checks` workflow only                                                                                                                        |

## 2. Bugs and defects found

**Correctness**

1. **Write Float Point ignores variables for measurement and field** ([actions.js:48](actions.js:48)): it uses `event.options.measurement` / `event.options.field` rather than the parsed strings, so `$(...)` ends up written literally.
2. **Tag parsing is fragile** (every action): an empty Tags box gives `point.tag('', undefined)`; values that contain `=` are cut off; whitespace is not trimmed; nothing is escaped.
3. **Raw "Write" action builds bad line protocol**: empty tags gives `measurement, fields` (invalid). `Date.now() * 1000000` goes past `Number.MAX_SAFE_INTEGER`, so the nanosecond timestamps lose precision. It should leave the timestamp off and let the client set it, or use a ms/s precision.
4. **Write failures are never seen.** `writePoint`/`writeRecord` only buffer, and HTTP errors come back later through the WriteApi `writeFailed` callback, which is never wired up. The `try/catch` only catches parse errors, so a bad token or bucket fails silently.
5. **Connection status is misleading.** `/ping` and `/health` run at the same time, race to set the status, and neither checks the token, org or bucket. A wrong token still shows **OK**. Nothing re-checks after init, and an `UnknownError` set by an action never clears.

**Lifecycle**

6. **`destroy()` never closes the WriteApi**, so buffered points are lost when the connection is disabled or Companion shuts down.
7. **`configUpdated()` calls `init()` again without closing the old WriteApi**, which leaks a writer and its flush timer on every config save, and the old buffer is dropped.
8. **Empty or invalid config crashes `init()`**: `new InfluxDB({ url: undefined })` throws before any status is set.

**Hygiene**

9. The token is stored as plain config. It should be a secret (v2 `secrets` schema).
10. The `package.json` `repository` points at `companion-module-influxdb` (the wrong repo).
11. The manifest `name` is `influxdb-apiv2` and should be a display name such as "InfluxDB v2". The maintainer email differs from your current one.
12. `InstanceBase` is imported in `actions.js` but never used, and there is a stray `async` on the stub definition functions.
13. `.DS_Store` is untracked and not in `.gitignore`.
14. The Boolean action's value is a fixed dropdown, so it can't come from a variable or expression.
15. There is no integer or unsigned field support (`intField`/`uintField`); everything numeric becomes a float.

## 3. Decisions needed before starting

| Decision             | Recommendation                                                                    | Why                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companion API target | **base 2.x latest (2.2.x)**, which means Companion 5.0+                           | v1 is legacy. v2 gives expressions, secrets, `context.signal` and action results. Verify the 2.2 changelog on top of the 2.1 notes. If users must stay on Companion 4.3/4.4, use `~2.0.x` instead.                                                                   |
| Language             | **Stay plain JavaScript (CommonJS), aligned with `companion-module-template-js`** | Base v2 still ships a `require` entry, so `module.exports = class …` plus `module.exports.UpgradeScripts = […]` works. To make up for the missing types: JSDoc `@type` annotations with `// @ts-check` (optional), ESLint, and vitest tests on the action callbacks. |
| InfluxDB 3 support   | **Write: support it now. Query: decide per version.**                             | InfluxDB 3 Core/Enterprise/Cloud accepts the v2-compatible `/api/v2/write` with a token, where bucket = database, so writes mostly work today. Queries differ: Flux on 2.x, SQL or InfluxQL on 3.x.                                                                  |
| Query scope          | **Phase 2 feature, behind a "Server version" config switch**                      | This is the biggest new feature and needs a choice of query language.                                                                                                                                                                                                |
| Version number       | **2.0.0**                                                                         | The minimum Companion version changes.                                                                                                                                                                                                                               |

## 4. Plan

### Phase A — Foundation (no user-visible change)

1. Branch `feat/v2-modernize`. Add `.DS_Store` to `.gitignore`.
2. Bring the tooling in line with `companion-module-template-js`: Yarn 4, ESLint 10 / `generateEslintConfig({})` (no TypeScript), Prettier, husky + lint-staged, and vitest. Keep CommonJS (no `"type": "module"`), with no build step.
3. Bump to `@companion-module/base` 2.x and `@companion-module/tools` ^3.2. Bump the influx client to `^1.35.0`, and check its CJS/ESM import under Node.
4. Manifest: `$schema`, `"type": "connection"`, `runtime.type: node22` (or `node26` on 2.1+), `entrypoint: ../src/main.js` (or keep `../main.js`), display name, maintainer email. **Keep `id: influxdb-apiv2`.**
5. Fix the `package.json` `repository` URL.
6. Write a few characterization tests against the current action behaviour first, so the port is checked.

### Phase B — Port to the v2 layout and fix the bugs

Layout (JS): `src/main.js` (`module.exports = InfluxInstance; module.exports.UpgradeScripts = …`), `config.js`, `actions.js`, `feedbacks.js`, `variables.js`, `presets.js`, `upgrades.js`, `influx.js` (client wrapper), `tags.js` (shared parser). Moving into `src/` is optional; files can stay at the root.

1. **Client wrapper (`influx.js`)**: owns the `InfluxDB` + `WriteApi` lifecycle, with `writeFailed`/`writeSuccess` callbacks feeding counters and status, plus `close()` (flush and dispose) used by `destroy()` and `configUpdated()`. Fixes #4, #6, #7.
2. **Config** (`config.js`): URL, org, bucket, plus a **token as a secret** (#9), with validation before connecting (#8). New advanced options: batch size, flush interval, max retries, request timeout, gzip, "ignore TLS errors", health-check interval, and default tags applied to every point.
3. **Status**: one sequential check (ping → health → authorized check such as `GET /api/v2/buckets?name=<bucket>`, which proves both token and bucket) on init and on an interval. Write failures set a warning that clears on the next success. Fixes #5.
4. **Actions**: drop `parseVariablesInString` and rely on `useVariables`/expressions.
   - Keep the existing action ids, so saved buttons keep working, and fix #1, #2 and #3.
   - Shared tag parser: trim, skip empty entries, split on the first `=`, and reject malformed pairs with a logged warning.
   - Raw "Write": accept multi-line line protocol, leave the timestamp off (#3), and validate the result.
   - Boolean value takes an expression or variable (#14). This needs an upgrade script mapping `'true'`/`'false'`.
5. **Upgrade scripts**: one for every option whose stored shape changes (Boolean dropdown → expression; the token moving from config to secrets).

### Phase C — New features (the "finish it" part)

1. **Unified "Write Point" action**: measurement, tags, any number of typed fields (float / integer / uint / string / bool), optional timestamp with precision, and optional bucket and org overrides. The four existing actions stay as simpler presets of it.
2. **Variables**: `connection_status`, `last_write_time`, `points_written`, `write_errors`, `last_error`, `pending_points`, `server_version`.
3. **Feedbacks**: "Connection OK", "Write error since last success", and later "Query value compare" (Phase D).
4. **Presets**: Flush Buffer, a status button (connection feedback + counters), and an example write.
5. **Action results (2.1+)**: write actions return success or failure, so triggers and sequences can branch on them.
6. **HELP.md**: fully rewritten, with config, every action, line-protocol escaping notes, InfluxDB 3 notes, and troubleshooting.

### Phase D — Queries (optional; needs the decision in §3)

1. "Server version" config: 2.x (Flux) or 3.x (SQL/InfluxQL via `@influxdata/influxdb3-client` or the v1-compat endpoint).
2. "Run query → variable" action: one scalar result into a custom or module variable.
3. Polled queries: a config list of named queries on an interval, exposed as variables and as a comparison feedback.

### Phase E — Release

1. `yarn build`, `yarn lint`, `yarn test`, `yarn companion-module-check` all clean.
2. A live test against InfluxDB 2.x in Docker (plus a 3 Core container for the write path). Check a bad token, a bad bucket, a server down/up, and that disable/re-enable doesn't lose buffered points.
3. Run the `review-local-module` skill for a pre-submission review.
4. Bump to 2.0.0, add a CHANGELOG entry, tag, and submit to the Bitfocus developer portal.

## 5. Suggested commit sequence

1. `chore: yarn 4, tooling v3 (JS), base 2.x`
2. `refactor: v2 manifest, default-export entrypoint, config + secrets`
3. `fix: write lifecycle (close on destroy/config), write-failure handling, status checks`
4. `fix(actions): parsed measurement/field, robust tag parsing, line-protocol timestamp`
5. `feat(upgrades): boolean value + token migration`
6. `feat: variables, feedbacks, presets`
7. `feat(actions): unified Write Point with typed fields and overrides`
8. `docs: HELP.md and changelog` → release 2.0.0
9. _(later)_ `feat: queries`
