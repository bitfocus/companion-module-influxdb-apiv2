const { Point, currentTime } = require('@influxdata/influxdb-client')
const { parseTags, parseFields, parseTimestamp, buildLine, nameProblem } = require('./lineprotocol')
const { describeError } = require('./influx')

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
		'Comma separated key=value pairs. Leave empty for no tags. Escapes: \\, comma, \\= equals sign, backslash-space for a leading or trailing space, \\\\ backslash. A backslash cannot end a tag or come right before a comma, equals sign or space.',
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

const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

/**
 * Like Point.intField, but keeps full 64-bit precision: the client parses the value as a JS number,
 * which rounds anything beyond 2^53.
 * @param {Point} point
 * @param {string} key
 * @param {string} digits
 */
function setIntField(point, key, digits) {
	const value = BigInt(digits)
	if (value < INT64_MIN || value > INT64_MAX) throw new Error(`Field "${key}" is outside the 64-bit integer range`)
	if (Number.isSafeInteger(Number(value))) {
		point.intField(key, Number(value))
	} else {
		point.fields[key] = `${value}i`
	}
}

/** Throw if the client would write this measurement or field name as invalid line protocol */
function checkName(label, name) {
	const problem = nameProblem(name)
	if (problem) throw new Error(`${label} "${name}": ${problem}`)
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
		checkName('Measurement', measurement)
		checkName('Field', field)

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
				// Defaults differ from Write Float Point: InfluxDB rejects a field that changes type
				fieldOption('text'),
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: 'hello',
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
		writePoint: {
			name: 'Write Point',
			description:
				'Write one point with any number of fields. The field type comes from how the value is written, like line protocol: 21.5 is a float, 3i an integer, 3u an unsigned integer, true/false a boolean and "text" a string.',
			options: [
				measurementOption(),
				tagsOption,
				{
					id: 'fields',
					type: 'textinput',
					label: 'Fields',
					default: 'value=1',
					tooltip:
						'Comma separated key=value pairs, eg temp=21.5, count=3i, ok=true, note="hello, world". Use \\" for a quote inside text.',
					useVariables: true,
				},
				{
					id: 'timestamp',
					type: 'textinput',
					label: 'Timestamp (optional)',
					default: '',
					tooltip:
						'Leave empty for the time of the button press. Accepts a number in the precision below, or a date like 2026-10-31T09:00:00Z.',
					useVariables: true,
				},
				{
					id: 'precision',
					type: 'dropdown',
					label: 'Timestamp precision',
					default: 'ms',
					choices: [
						{ id: 's', label: 'Seconds' },
						{ id: 'ms', label: 'Milliseconds' },
						{ id: 'us', label: 'Microseconds' },
						{ id: 'ns', label: 'Nanoseconds' },
					],
				},
				{
					id: 'bucket',
					type: 'textinput',
					label: 'Bucket (optional)',
					default: '',
					tooltip: "Write to this bucket instead of the connection's bucket",
					useVariables: true,
				},
				{
					id: 'org',
					type: 'textinput',
					label: 'Organization (optional)',
					default: '',
					tooltip: "Use this organization instead of the connection's organization",
					useVariables: true,
				},
			],
			callback: writeAction('Write Point', (options, connection) => {
				const measurement = String(options.measurement ?? '').trim()
				if (!measurement) throw new Error('Measurement is required')
				checkName('Measurement', measurement)

				const { fields, errors } = parseFields(options.fields)
				if (errors.length && !fields.length) throw new Error(errors.join('; '))
				if (!fields.length) throw new Error('At least one field is required')
				for (const error of errors) self.log('warn', `Write Point: ${error}`)

				const point = new Point(measurement)
				const tagResult = parseTags(options.tags)
				for (const error of tagResult.errors) self.log('warn', error)
				for (const [key, value] of Object.entries(tagResult.tags)) point.tag(key, value)

				for (const field of fields) {
					switch (field.type) {
						case 'float':
							point.floatField(field.key, field.value)
							break
						case 'int':
							setIntField(point, field.key, field.value)
							break
						case 'uint':
							point.uintField(field.key, field.value)
							break
						case 'bool':
							point.booleanField(field.key, field.value)
							break
						case 'string':
							point.stringField(field.key, field.value)
							break
					}
				}

				const timestamp = parseTimestamp(options.timestamp, options.precision)
				if (timestamp) point.timestamp(timestamp)

				connection.writePoint(point, {
					bucket: String(options.bucket ?? '').trim(),
					org: String(options.org ?? '').trim(),
				})
				return point.toString()
			}),
		},
		runQuery: {
			name: 'Run Flux Query',
			description:
				'Run a Flux query (InfluxDB 2.x) and return the result, which Companion can store in a variable for later actions. Needs a token with read access.',
			options: [
				{
					id: 'query',
					type: 'textinput',
					label: 'Flux query',
					default:
						'from(bucket: "my-bucket")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "example")\n  |> last()',
					multiline: true,
					useVariables: true,
				},
				{
					id: 'result',
					type: 'dropdown',
					label: 'Return',
					default: 'value',
					choices: [
						{ id: 'value', label: 'The _value of the first row' },
						{ id: 'row', label: 'The first row (object)' },
						{ id: 'rows', label: 'All rows (list of objects)' },
						{ id: 'count', label: 'The number of rows' },
					],
					disableAutoExpression: true,
				},
				{
					id: 'maxRows',
					type: 'number',
					label: 'Maximum rows',
					default: 100,
					min: 1,
					max: 10000,
					asInteger: true,
					clampValues: true,
					isVisibleExpression: `$(options:result) == 'rows'`,
				},
				{
					id: 'org',
					type: 'textinput',
					label: 'Organization (optional)',
					default: '',
					tooltip: "Use this organization instead of the connection's organization",
					useVariables: true,
				},
			],
			hasResult: true,
			callback: async (event, context) => {
				const { options } = event
				const flux = String(options.query ?? '').trim()
				if (!flux) throw new Error('Run Flux Query: the query is empty')

				const mode = options.result || 'value'
				const maxRows = Math.max(1, Math.round(Number(options.maxRows) || 100))
				try {
					const { rows, count, truncated } = await self.requireConnection().query(flux, {
						org: String(options.org ?? '').trim(),
						limit: mode === 'rows' ? maxRows : 1,
						countOnly: mode === 'count',
						signal: context?.signal,
					})
					if (truncated && mode === 'rows') self.log('warn', `Run Flux Query: result cut to the first ${maxRows} rows`)

					switch (mode) {
						case 'count':
							return count
						case 'rows':
							return rows
						case 'row':
							return rows[0] ?? null
						default:
							return rows[0]?._value ?? null
					}
				} catch (error) {
					const message = describeError(error).message
					self.log('warn', `Run Flux Query: ${message}`)
					throw new Error(message, { cause: error })
				}
			},
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
