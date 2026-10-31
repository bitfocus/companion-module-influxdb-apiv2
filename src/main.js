const { InstanceBase, InstanceStatus } = require('@companion-module/base')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
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
	}

	async init(config, _isFirstInit, secrets) {
		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()

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

		if (errors.length) {
			for (const error of errors) this.log('error', `Config: ${error}`)
			this.refreshStatus()
			return
		}

		try {
			this.connection = new InfluxConnection(settings, {
				onWriteSuccess: (lines) => {
					if (generation !== this.generation) return
					this.log('debug', `Wrote ${lines.length} line(s) to InfluxDB`)
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
					this.writeError = described
					this.refreshStatus()
				},
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
			if (generation !== this.generation) return

			if (!this.healthy || this.healthError) {
				this.log('info', `Connected to InfluxDB${version ? ` ${version}` : ''} at ${this.settings.url}`)
			}
			this.healthy = true
			this.healthError = null
			this.serverVersion = version
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
			this.updateStatus(InstanceStatus.BadConfig, this.configErrors.join('; '))
		} else if (this.writeError) {
			this.updateStatus(this.writeError.status, this.writeError.message)
		} else if (this.healthError) {
			this.updateStatus(this.healthError.status, this.healthError.message)
		} else if (this.healthy) {
			this.updateStatus(InstanceStatus.Ok)
		} else {
			this.updateStatus(InstanceStatus.Connecting)
		}
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
}

module.exports = InfluxInstance
