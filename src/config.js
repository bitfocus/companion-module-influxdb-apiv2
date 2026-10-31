const { Regex } = require('@companion-module/base')
const { parseTags } = require('./lineprotocol')

const DEFAULTS = {
	url: 'http://localhost:8086',
	org: '',
	bucket: '',
	batchSize: 1000,
	flushInterval: 1000,
	maxRetries: 5,
	timeout: 10000,
	gzip: false,
	ignoreTlsErrors: false,
	healthInterval: 30,
	defaultTags: '',
}

/**
 * @returns {import('@companion-module/base').SomeCompanionConfigField[]}
 */
function GetConfigFields() {
	return [
		{
			type: 'textinput',
			id: 'url',
			label: 'InfluxDB URL',
			width: 8,
			default: DEFAULTS.url,
			regex: Regex.SOMETHING,
			description: 'For example http://localhost:8086 (InfluxDB 2.x) or http://localhost:8181 (InfluxDB 3)',
		},
		{
			type: 'secret-text',
			id: 'token',
			label: 'API Token',
			width: 8,
			description: 'Needs write access to the bucket',
		},
		{
			type: 'textinput',
			id: 'org',
			label: 'Organization',
			width: 4,
			default: DEFAULTS.org,
			tooltip: 'Name or ID of the organization. Required for InfluxDB 2.x, ignored by InfluxDB 3.',
		},
		{
			type: 'textinput',
			id: 'bucket',
			label: 'Bucket',
			width: 4,
			default: DEFAULTS.bucket,
			regex: Regex.SOMETHING,
			tooltip: 'Name or ID of the bucket (the database name on InfluxDB 3)',
		},
		{
			type: 'textinput',
			id: 'defaultTags',
			label: 'Default tags',
			width: 8,
			default: DEFAULTS.defaultTags,
			tooltip: 'Tags added to every point written by the point actions, eg site=main,source=companion',
		},
		{
			type: 'static-text',
			id: 'advancedHeading',
			label: 'Advanced',
			value: '',
			width: 12,
		},
		{
			type: 'number',
			id: 'flushInterval',
			label: 'Flush interval (ms)',
			tooltip: 'Buffered points are sent at least this often',
			width: 4,
			default: DEFAULTS.flushInterval,
			min: 100,
			max: 600000,
		},
		{
			type: 'number',
			id: 'batchSize',
			label: 'Batch size (points)',
			tooltip: 'The buffer is also sent as soon as it holds this many points',
			width: 4,
			default: DEFAULTS.batchSize,
			min: 1,
			max: 100000,
		},
		{
			type: 'number',
			id: 'maxRetries',
			label: 'Max retries',
			tooltip: 'Retries for writes that fail with a temporary error (eg server unavailable)',
			width: 4,
			default: DEFAULTS.maxRetries,
			min: 0,
			max: 20,
		},
		{
			type: 'number',
			id: 'timeout',
			label: 'Request timeout (ms)',
			width: 4,
			default: DEFAULTS.timeout,
			min: 1000,
			max: 120000,
		},
		{
			type: 'number',
			id: 'healthInterval',
			label: 'Health check interval (s)',
			tooltip: '0 disables periodic health checks',
			width: 4,
			default: DEFAULTS.healthInterval,
			min: 0,
			max: 3600,
		},
		{
			type: 'checkbox',
			id: 'gzip',
			label: 'Compress writes (gzip)',
			width: 4,
			default: DEFAULTS.gzip,
		},
		{
			type: 'checkbox',
			id: 'ignoreTlsErrors',
			label: 'Ignore TLS certificate errors',
			tooltip: 'Only for self-signed certificates on a trusted network',
			width: 4,
			default: DEFAULTS.ignoreTlsErrors,
		},
	]
}

/**
 * @typedef {object} ResolvedConfig
 * @property {string} url
 * @property {string} token
 * @property {string} org
 * @property {string} bucket
 * @property {number} batchSize
 * @property {number} flushInterval
 * @property {number} maxRetries
 * @property {number} timeout
 * @property {boolean} gzip
 * @property {boolean} ignoreTlsErrors
 * @property {number} healthInterval seconds, 0 = disabled
 * @property {Record<string, string>} defaultTags
 */

/**
 * Apply defaults to a saved config (older configs lack the newer fields) and validate it.
 * @param {Record<string, any> | undefined} config
 * @param {Record<string, any> | undefined} secrets
 * @returns {{ config: ResolvedConfig, errors: string[] }}
 */
function resolveConfig(config, secrets) {
	const c = { ...DEFAULTS, ...(config ?? {}) }
	const errors = []

	const url = String(c.url ?? '').trim()
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
			errors.push('URL must start with http:// or https://')
	} catch {
		errors.push('URL is not valid')
	}

	const bucket = String(c.bucket ?? '').trim()
	if (!bucket) errors.push('Bucket is required')

	const tagResult = parseTags(c.defaultTags)
	errors.push(...tagResult.errors.map((e) => `Default tags: ${e}`))

	const num = (value, fallback) => {
		const n = Number(value)
		return Number.isFinite(n) ? n : fallback
	}

	return {
		config: {
			url: url.replace(/\/+$/, ''),
			token: String(secrets?.token ?? '').trim(),
			org: String(c.org ?? '').trim(),
			bucket,
			batchSize: Math.max(1, Math.round(num(c.batchSize, DEFAULTS.batchSize))),
			flushInterval: Math.max(100, num(c.flushInterval, DEFAULTS.flushInterval)),
			maxRetries: Math.max(0, Math.round(num(c.maxRetries, DEFAULTS.maxRetries))),
			timeout: Math.max(1000, num(c.timeout, DEFAULTS.timeout)),
			gzip: !!c.gzip,
			ignoreTlsErrors: !!c.ignoreTlsErrors,
			healthInterval: Math.max(0, num(c.healthInterval, DEFAULTS.healthInterval)),
			defaultTags: tagResult.tags,
		},
		errors,
	}
}

module.exports = { GetConfigFields, resolveConfig, DEFAULTS }
