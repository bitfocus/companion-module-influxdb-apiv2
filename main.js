const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const { InfluxDB } = require('@influxdata/influxdb-client')
const { PingAPI, HealthAPI } = require('@influxdata/influxdb-client-apis')

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config
		this.influx = new InfluxDB({
			url: this.config.url,
			token: this.config.token
		})
		this.ping = new PingAPI(this.influx)
		
		this.ping
			.getPing() // check ping
			.then(() => {
				this.log('info', 'InfluxDB is pingable')
				this.updateStatus(InstanceStatus.Ok)
			})
			.catch((error) => {
				this.log('error', 'InfluxDB is not pingable')
				this.updateStatus(InstanceStatus.ConnectionFailure, 'InfluxDB is not pingable')
			})

		this.health = new HealthAPI(this.influx)

		this.health
			.getHealth() // check health
			.then(() => {
				this.log('info', 'InfluxDB is healthy')
				this.updateStatus(InstanceStatus.Ok)
			})
			.catch((error) => {
				this.log('error', 'InfluxDB is not healthy')
				this.updateStatus(InstanceStatus.ConnectionFailure, 'InfluxDB is not healthy')
			})

		this.writeApi = this.influx.getWriteApi(this.config.org, this.config.bucket)


		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
	}
	// When module gets deleted
	async destroy() {
		this.log('debug', 'destroy')
	}

	async configUpdated(config) {
		this.init(config)
	}

	// Return config fields for web config
	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'url',
				label: 'InfluxDB URL',
				width: 8,
				default: 'http://localhost:8086',
				regex: Regex.SOMETHING,
			},
			{
				type: 'textinput',
				id: 'token',
				label: 'InfluxDB Token',
				width: 8,
				regex: Regex.SOMETHING,
			},
			{
				type: 'textinput',
				id: 'org',
				label: 'InfluxDB Organization',
				width: 4,
				regex: Regex.SOMETHING,
			},
			{
				type: 'textinput',
				id: 'bucket',
				label: 'InfluxDB Bucket',
				width: 4,
				regex: Regex.SOMETHING,
			},
		]
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

runEntrypoint(ModuleInstance, UpgradeScripts)
