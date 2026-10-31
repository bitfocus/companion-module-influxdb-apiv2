const { InstanceBase, InstanceStatus } = require('@companion-module/base')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const UpdatePresets = require('./presets')
const { STATUS_LABELS } = require('./variables')
const { GetConfigFields, resolveConfig } = require('./config')
const { InfluxConnection, describeError } = require('./influx')

class InfluxInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		/** @type {InfluxConnection | null} */
		this.connection = null
		/** @type {import('./config').ResolvedConfig | null} */
		this.settings = null
		this.healthTimer = null
		/** Bumped on every (re)start so results from an old connection are ignored */
		this.generation = 0

		this.configErrors = []
		/** @type {{ status: string, message: string } | null} */
		this.healthError = null
		/** @type {{ status: string, message: string } | null} */
		this.writeError = null
		this.healthy = false
		this.serverVersion = undefined

		/** The status last reported to Companion, read by the feedbacks */
		this.currentStatus = { status: InstanceStatus.Connecting, message: '' }
		this.stats = newStats()
	}

	async init(config, _isFirstInit, secrets) {
		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updatePresets()

		this.start(config, secrets)
	}

	async destroy() {
		await this.stop()
	}

	async configUpdated(config, secrets) {
		await this.stop()
		this.start(config, secrets)
	}

	getConfigFields() {
		return GetConfigFields()
	}

	start(config, secrets) {
		const generation = ++this.generation
		const { config: settings, errors } = resolveConfig(config, secrets)

		this.settings = settings
		this.configErrors = errors
		this.healthError = null
		this.writeError = null
		this.healthy = false
		this.serverVersion = undefined
		this.stats = newStats()
		this.publishStats()

		if (errors.length) {
			for (const error of errors) this.log('error', `Config: ${error}`)
			this.refreshStatus()
			return
		}

		try {
			this.connection = new InfluxConnection(settings, {
				onQueued: (count) => {
					if (generation !== this.generation) return
					this.stats.queued += count
					this.publishStats()
				},
				onWriteSuccess: (lines) => {
					if (generation !== this.generation) return
					this.log('debug', `Wrote ${lines.length} line(s) to InfluxDB`)
					this.stats.written += lines.length
					this.stats.lastWriteTime = new Date().toLocaleTimeString('en-GB')
					this.publishStats()
					if (this.writeError) {
						this.log('info', 'Writes to InfluxDB are succeeding again')
						this.writeError = null
						this.refreshStatus()
					}
				},
				onWriteFailed: (error, lines, attempt) => {
					if (generation !== this.generation) return
					const described = describeError(error)
					this.log('error', `Write of ${lines.length} line(s) failed (attempt ${attempt}): ${described.message}`)
					this.stats.failed += 1
					this.stats.lastError = described.message
					this.publishStats()
					this.writeError = described
					this.refreshStatus()
				},
				onClientLog: (message) => this.log('debug', `InfluxDB client: ${message}`),
			})
		} catch (e) {
			this.configErrors = [e.message]
			this.log('error', `Could not create InfluxDB client: ${e.message}`)
			this.refreshStatus()
			return
		}

		this.refreshStatus()
		this.runHealthCheck(generation)
		if (settings.healthInterval > 0) {
			this.healthTimer = setInterval(() => this.runHealthCheck(generation), settings.healthInterval * 1000)
		}
	}

	async stop() {
		this.generation++
		if (this.healthTimer) {
			clearInterval(this.healthTimer)
			this.healthTimer = null
		}

		const connection = this.connection
		this.connection = null
		if (connection) {
			try {
				await connection.close()
			} catch (e) {
				this.log('warn', `Some buffered points could not be written before closing: ${e.message}`)
			}
		}
	}

	async runHealthCheck(generation) {
		const connection = this.connection
		if (!connection) return

		try {
			const { version } = await connection.checkHealth()
			await connection.checkWriteAccess()
			if (generation !== this.generation) return

			if (!this.healthy || this.healthError) {
				this.log('info', `Connected to InfluxDB${version ? ` ${version}` : ''} at ${this.settings.url}`)
			}
			this.healthy = true
			this.healthError = null
			this.serverVersion = version
			this.setVariableValues({ server_version: version ?? '' })
		} catch (e) {
			if (generation !== this.generation) return

			const described = describeError(e)
			if (this.healthError?.message !== described.message) {
				this.log('error', `InfluxDB health check failed: ${described.message}`)
			}
			this.healthy = false
			this.healthError = described
		}
		this.refreshStatus()
	}

	/** Derive the connection status from config, health and write state */
	refreshStatus() {
		if (this.configErrors.length) {
			this.setStatus(InstanceStatus.BadConfig, this.configErrors.join('; '))
		} else if (this.writeError) {
			this.setStatus(this.writeError.status, this.writeError.message)
		} else if (this.healthError) {
			this.setStatus(this.healthError.status, this.healthError.message)
		} else if (this.healthy) {
			this.setStatus(InstanceStatus.Ok, '')
		} else {
			this.setStatus(InstanceStatus.Connecting, '')
		}
	}

	/** Report a status to Companion and mirror it in the variables and feedbacks */
	setStatus(status, message) {
		const changed = status !== this.currentStatus.status || message !== this.currentStatus.message
		this.currentStatus = { status, message }
		this.updateStatus(status, message || null)
		if (!changed) return

		this.setVariableValues({
			connection_status: STATUS_LABELS[status] ?? status,
			connection_message: message,
		})
		this.checkFeedbacks('connectionOk', 'writesFailing')
	}

	publishStats() {
		this.setVariableValues({
			points_queued: this.stats.queued,
			points_written: this.stats.written,
			write_errors: this.stats.failed,
			last_error: this.stats.lastError,
			last_write_time: this.stats.lastWriteTime,
		})
	}

	/**
	 * The active connection, or an error explaining why there is none.
	 * @returns {InfluxConnection}
	 */
	requireConnection() {
		if (!this.connection) {
			throw new Error(
				this.configErrors.length ? `Not connected: ${this.configErrors.join('; ')}` : 'Not connected to InfluxDB',
			)
		}
		return this.connection
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	updatePresets() {
		UpdatePresets(this)
	}
}

function newStats() {
	return { queued: 0, written: 0, failed: 0, lastError: '', lastWriteTime: '' }
}

module.exports = InfluxInstance
