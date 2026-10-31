const { Point, currentTime } = require('@influxdata/influxdb-client')
const { parseTags, buildLine } = require('./lineprotocol')

const measurementOption = (defaultValue = 'example') => ({
	id: 'measurement',
	type: 'textinput',
	label: 'Measurement',
	default: defaultValue,
	useVariables: true,
})

const tagsOption = {
	id: 'tags',
	type: 'textinput',
	label: 'Tags',
	default: 'tag1=value1,tag2=value2',
	tooltip:
		'Comma separated key=value pairs. Leave empty for no tags. Write \\, or \\= for a literal comma or equals sign.',
	useVariables: true,
}

const fieldOption = (defaultValue) => ({
	id: 'field',
	type: 'textinput',
	label: 'Field',
	default: defaultValue,
	useVariables: true,
})

/**
 * Accept the usual spellings of a boolean, so expressions can return true/false, 1/0, on/off, ...
 * @returns {boolean | undefined}
 */
function toBoolean(value) {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	const str = String(value ?? '')
		.trim()
		.toLowerCase()
	if (['true', '1', 'yes', 'on'].includes(str)) return true
	if (['false', '0', 'no', 'off'].includes(str)) return false
	return undefined
}

module.exports = function (self) {
	/**
	 * Build a point from the shared measurement/tags/field options.
	 * @param {Record<string, any>} options
	 * @param {(point: Point, field: string) => void} setField
	 */
	const buildPoint = (options, setField) => {
		const measurement = String(options.measurement ?? '').trim()
		const field = String(options.field ?? '').trim()
		if (!measurement) throw new Error('Measurement is required')
		if (!field) throw new Error('Field is required')

		const point = new Point(measurement)
		const { tags, errors } = parseTags(options.tags)
		for (const error of errors) self.log('warn', error)
		for (const [key, value] of Object.entries(tags)) point.tag(key, value)

		setField(point, field)
		return point
	}

	/**
	 * Wrap an action callback so input problems are logged instead of thrown.
	 * These are mistakes in the button, not connection problems, so they don't change the status.
	 */
	const writeAction = (name, fn) => async (event) => {
		try {
			const connection = self.requireConnection()
			const written = fn(event.options, connection)
			self.log('debug', `Queued for InfluxDB: ${written}`)
		} catch (error) {
			self.log('warn', `${name}: ${error.message}`)
		}
	}

	self.setActionDefinitions({
		writeFloatPoint: {
			name: 'Write Float Point',
			description: 'Write a point with one float field',
			options: [
				measurementOption(),
				tagsOption,
				fieldOption('value'),
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '0',
					useVariables: true,
				},
			],
			callback: writeAction('Write Float Point', (options, connection) => {
				const raw = String(options.value ?? '').trim()
				const value = Number(raw)
				if (raw === '' || !Number.isFinite(value)) throw new Error(`"${raw}" is not a number`)

				const point = buildPoint(options, (p, field) => p.floatField(field, value))
				connection.writePoint(point)
				return point.toString()
			}),
		},
		writeStringPoint: {
			name: 'Write String Point',
			description: 'Write a point with one string field',
			options: [
				measurementOption(),
				tagsOption,
				fieldOption('value'),
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '0',
					useVariables: true,
				},
			],
			callback: writeAction('Write String Point', (options, connection) => {
				const value = String(options.value ?? '')
				const point = buildPoint(options, (p, field) => p.stringField(field, value))
				connection.writePoint(point)
				return point.toString()
			}),
		},
		writeBooleanPoint: {
			name: 'Write Boolean Point',
			description: 'Write a point with one boolean field',
			options: [
				measurementOption(),
				tagsOption,
				fieldOption('field'),
				{
					id: 'value',
					type: 'dropdown',
					label: 'Value',
					default: 'true',
					choices: [
						{ id: 'true', label: 'True' },
						{ id: 'false', label: 'False' },
					],
					allowInvalidValues: true,
					expressionDescription: 'Should return true/false, 1/0, yes/no or on/off',
				},
			],
			callback: writeAction('Write Boolean Point', (options, connection) => {
				const value = toBoolean(options.value)
				if (value === undefined) throw new Error(`"${options.value}" is not a boolean`)

				const point = buildPoint(options, (p, field) => p.booleanField(field, value))
				connection.writePoint(point)
				return point.toString()
			}),
		},
		writeInflux: {
			name: 'Write',
			description:
				'Write a single line of line protocol. Tags and fields are comma separated key=value pairs, string field values must be in double quotes, and you are responsible for escaping. The timestamp is added automatically.',
			options: [
				measurementOption('exampleMeasurement'),
				tagsOption,
				{
					id: 'fields',
					type: 'textinput',
					label: 'Fields',
					default: 'field1=1234.5,field2="value2"',
					useVariables: true,
				},
			],
			callback: writeAction('Write', (options, connection) => {
				const line = buildLine(options.measurement, options.tags, options.fields, currentTime.ns())
				connection.writeRecords([line])
				return line
			}),
		},
		flushBuffer: {
			name: 'Flush Buffer',
			description:
				'Writes are buffered and sent in batches (see Flush interval in the connection settings). This sends everything that is buffered now.',
			options: [],
			callback: async () => {
				try {
					await self.requireConnection().flush()
					self.log('debug', 'InfluxDB buffer flushed')
				} catch (error) {
					self.log('warn', `Flush Buffer: ${error.message}`)
				}
			},
		},
	})
}

module.exports.toBoolean = toBoolean
