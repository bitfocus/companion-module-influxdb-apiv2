const { InfluxDB, HttpError } = require('@influxdata/influxdb-client')
const { HealthAPI } = require('@influxdata/influxdb-client-apis')

/** How long close() waits for the final flush before discarding the buffer */
const CLOSE_TIMEOUT_MS = 5000

/**
 * Owns the InfluxDB client and its buffered WriteApi for one module instance.
 *
 * Writes are buffered by the client and sent in batches, so failures are reported
 * asynchronously through `onWriteFailed`, not thrown from the write calls.
 */
class InfluxConnection {
	/**
	 * @param {import('./config').ResolvedConfig} config
	 * @param {object} callbacks
	 * @param {(lines: string[]) => void} callbacks.onWriteSuccess
	 * @param {(error: Error, lines: string[], attempt: number) => void} callbacks.onWriteFailed
	 */
	constructor(config, { onWriteSuccess, onWriteFailed }) {
		this.influx = new InfluxDB({
			url: config.url,
			token: config.token || undefined,
			timeout: config.timeout,
			transportOptions: { rejectUnauthorized: !config.ignoreTlsErrors },
		})

		this.writeApi = this.influx.getWriteApi(config.org, config.bucket, 'ns', {
			batchSize: config.batchSize,
			flushInterval: config.flushInterval,
			maxRetries: config.maxRetries,
			gzipThreshold: config.gzip ? 1000 : undefined,
			defaultTags: Object.keys(config.defaultTags).length ? config.defaultTags : undefined,
			writeSuccess: (lines) => onWriteSuccess(lines),
			// Returning undefined keeps the client's default retry behaviour
			writeFailed: (error, lines, attempt) => {
				onWriteFailed(error, lines, attempt)
				return undefined
			},
		})

		this.health = new HealthAPI(this.influx)
		this.closed = false
	}

	/**
	 * Check that the server is reachable and reports itself healthy.
	 * @returns {Promise<{ version: string | undefined }>}
	 */
	async checkHealth() {
		const result = await this.health.getHealth()
		// InfluxDB 2.x returns a JSON health check, InfluxDB 3 returns plain text
		if (result && typeof result === 'object' && result.status === 'fail') {
			throw new Error(result.message || 'InfluxDB reports it is unhealthy')
		}
		return { version: typeof result === 'object' ? result?.version : undefined }
	}

	/** @param {import('@influxdata/influxdb-client').Point} point */
	writePoint(point) {
		this.writeApi.writePoint(point)
	}

	/** @param {string[]} lines */
	writeRecords(lines) {
		this.writeApi.writeRecords(lines)
	}

	/** Send everything that is buffered now */
	async flush() {
		await this.writeApi.flush()
	}

	/** Flush what is buffered and stop the writer. Safe to call more than once. */
	async close() {
		if (this.closed) return
		this.closed = true

		let timer
		const timeout = new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error('Timed out flushing to InfluxDB')), CLOSE_TIMEOUT_MS)
		})
		try {
			await Promise.race([this.writeApi.close(), timeout])
		} catch (e) {
			// Could not flush in time (server down?), drop the rest rather than hang shutdown
			this.writeApi.dispose()
			throw e
		} finally {
			clearTimeout(timer)
		}
	}
}

/**
 * Turn a client error into a short message and the Companion status it should cause.
 * @param {Error} error
 * @returns {{ status: 'authentication_failure' | 'insufficient_permissions' | 'bad_config' | 'connection_failure' | 'unknown_warning', message: string }}
 */
function describeError(error) {
	if (error instanceof HttpError) {
		const detail = parseErrorBody(error.body) || error.statusMessage || error.message
		switch (error.statusCode) {
			case 401:
				return { status: 'authentication_failure', message: `Unauthorized, check the token (${detail})` }
			case 403:
				return { status: 'insufficient_permissions', message: `Token cannot write to this bucket (${detail})` }
			case 404:
				return { status: 'bad_config', message: `Organization or bucket not found (${detail})` }
			case 400:
			case 422:
				return { status: 'unknown_warning', message: `InfluxDB rejected the data: ${detail}` }
			default:
				return { status: 'connection_failure', message: `HTTP ${error.statusCode}: ${detail}` }
		}
	}
	return { status: 'connection_failure', message: error.message || String(error) }
}

/** InfluxDB returns JSON errors like {"code":"not found","message":"bucket \"x\" not found"} */
function parseErrorBody(body) {
	if (!body) return undefined
	try {
		const parsed = JSON.parse(body)
		return parsed.message || parsed.error || body
	} catch {
		return body
	}
}

module.exports = { InfluxConnection, describeError }
