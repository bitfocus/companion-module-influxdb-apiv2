const { InfluxDB, setLogger } = require('@influxdata/influxdb-client')
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
	 * @param {(message: string) => void} [callbacks.onClientLog] the client's own diagnostics (retries etc)
	 * @param {(count: number) => void} [callbacks.onQueued] lines added to the buffer
	 */
	constructor(config, { onWriteSuccess, onWriteFailed, onClientLog, onQueued }) {
		// By default the client prints every failure with a full stack trace to the console.
		// Failures already reach onWriteFailed, so route its own messages somewhere quieter.
		setLogger({
			error: (message) => onClientLog?.(message),
			warn: (message) => onClientLog?.(message),
		})

		this.influx = new InfluxDB({
			url: config.url,
			token: config.token || undefined,
			timeout: config.timeout,
			transportOptions: { rejectUnauthorized: !config.ignoreTlsErrors },
		})

		this.config = config
		this.onQueued = onQueued
		this.writeOptions = {
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
		}

		/** One buffered writer per org/bucket; actions can target a bucket other than the default */
		this.writeApis = new Map()
		this.writeApi = this.getWriteApi()

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

	/**
	 * Check the token, org and bucket without writing any data, by posting an empty body
	 * to the write endpoint (the health endpoint does not need a token).
	 * InfluxDB 2.x answers 204 when it would accept the write, or 401/404/400 with the reason.
	 */
	async checkWriteAccess() {
		try {
			await this.influx.transport.request(this.writeApi.path, '', {
				method: 'POST',
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			})
		} catch (e) {
			// A server that rejects the empty body itself has already accepted the token, org and bucket
			if (e?.statusCode === 400 && describeError(e).status !== 'bad_config') return
			throw e
		}
	}

	/**
	 * The writer for an org/bucket, created on first use. Empty values mean the configured default.
	 * @param {{ org?: string, bucket?: string }} [target]
	 */
	getWriteApi(target = {}) {
		const org = target.org || this.config.org
		const bucket = target.bucket || this.config.bucket
		const key = `${org}\n${bucket}`
		let writeApi = this.writeApis.get(key)
		if (!writeApi) {
			if (this.closed) throw new Error('Connection is closed')
			writeApi = this.influx.getWriteApi(org, bucket, 'ns', this.writeOptions)
			this.writeApis.set(key, writeApi)
		}
		return writeApi
	}

	/**
	 * @param {import('@influxdata/influxdb-client').Point} point
	 * @param {{ org?: string, bucket?: string }} [target]
	 */
	writePoint(point, target) {
		this.getWriteApi(target).writePoint(point)
		this.onQueued?.(1)
	}

	/**
	 * @param {string[]} lines
	 * @param {{ org?: string, bucket?: string }} [target]
	 */
	writeRecords(lines, target) {
		this.getWriteApi(target).writeRecords(lines)
		this.onQueued?.(lines.length)
	}

	/** Send everything that is buffered now */
	async flush() {
		await Promise.all([...this.writeApis.values()].map((w) => w.flush()))
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
			await Promise.race([Promise.all([...this.writeApis.values()].map((w) => w.close())), timeout])
		} catch (e) {
			// Could not flush in time (server down?), drop the rest rather than hang shutdown
			for (const w of this.writeApis.values()) w.dispose()
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
	// Checked by shape: the client ships separate CJS and ESM builds, so instanceof HttpError is unreliable
	if (typeof error?.statusCode === 'number') {
		const detail = parseErrorBody(error.body) || error.statusMessage || error.message
		switch (error.statusCode) {
			case 401:
				return { status: 'authentication_failure', message: `Unauthorized, check the token (${detail})` }
			case 403:
				return { status: 'insufficient_permissions', message: `Token cannot write to this bucket (${detail})` }
			case 404:
				return { status: 'bad_config', message: `Organization or bucket not found (${detail})` }
			case 400:
				if (/\borg/i.test(detail)) {
					return { status: 'bad_config', message: `Organization is missing or invalid (${detail})` }
				}
				return { status: 'unknown_warning', message: `InfluxDB rejected the data: ${detail}` }
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
