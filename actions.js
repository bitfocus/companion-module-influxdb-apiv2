const { InstanceBase, InstanceStatus } = require('@companion-module/base')
const { Point } = require('@influxdata/influxdb-client')

module.exports = function (self) {
	self.setActionDefinitions({
		writeFloatPoint: {
			name: 'Write Float Point',
			description: 'Write a float point to InfluxDB',
			options: [
				{
					id: 'measurement',
					type: 'textinput',
					label: 'Measurement',
					default: 'example',
					useVariables: true,
				},
				{
					id: 'tags',
					type: 'textinput',
					label: 'Tags',
					default: 'tag1=value1,tag2=value2',
					useVariables: true,
				},
				{
					id: 'field',
					type: 'textinput',
					label: 'Field',
					default: 'value',
					useVariables: true,
				},
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '0',
					useVariables: true,
				},
			],
			callback: async (event, context) => {
				try {
					// Parse variables in options
					const measurementString = await context.parseVariablesInString(event.options.measurement)
					const tagsString = await context.parseVariablesInString(event.options.tags)
					const fieldString = await context.parseVariablesInString(event.options.field)
					const valueString = await context.parseVariablesInString(event.options.value)

					// Create point
					const point = new Point(event.options.measurement).floatField(event.options.field, parseFloat(valueString))

					// Add tags
					const tags = tagsString.split(',')
					tags.forEach((tag) => {
						const [key, value] = tag.split('=')
						point.tag(key, value)
					})

					// Send to Influx
					self.writeApi.writePoint(point)
					self.log(
						'debug',
						`Sent to Influx: ${measurementString},${tagsString} ${fieldString}=${valueString} ${Date.now() * 1000000}`
					)
				} catch (error) {
					self.log('error', `Error sending to Influx: ${error.message}`)
					self.updateStatus(InstanceStatus.UnknownError, error.message)
				}
			},
		},
		writeStringPoint: {
			name: 'Write String Point',
			description: 'Write a string point to InfluxDB',
			options: [
				{
					id: 'measurement',
					type: 'textinput',
					label: 'Measurement',
					default: 'example',
					useVariables: true,
				},
				{
					id: 'tags',
					type: 'textinput',
					label: 'Tags',
					default: 'tag1=value1,tag2=value2',
					useVariables: true,
				},
				{
					id: 'field',
					type: 'textinput',
					label: 'Field',
					default: 'value',
					useVariables: true,
				},
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '0',
					useVariables: true,
				},
			],
			callback: async (event, context) => {
				try {
					// Parse variables in options
					const measurementString = await context.parseVariablesInString(event.options.measurement)
					const tagsString = await context.parseVariablesInString(event.options.tags)
					const fieldString = await context.parseVariablesInString(event.options.field)
					const valueString = await context.parseVariablesInString(event.options.value)

					// Create point
					const point = new Point(measurementString).stringField(fieldString, valueString)

					// Add tags
					const tags = tagsString.split(',')
					tags.forEach((tag) => {
						const [key, value] = tag.split('=')
						point.tag(key, value)
					})

					// Send to Influx
					self.writeApi.writePoint(point)
					self.log(
						'debug',
						`Sent to Influx: ${measurementString},${tagsString} ${fieldString}=${valueString} ${Date.now() * 1000000}`
					)
				} catch (error) {
					self.log('error', `Error sending to Influx: ${error.message}`)
					self.updateStatus(InstanceStatus.UnknownError, error.message)
				}
			},
		},
		writeBooleanPoint: {
			name: 'Write Boolean Point',
			description: 'Write a boolean point to InfluxDB',
			options: [
				{
					id: 'measurement',
					type: 'textinput',
					label: 'Measurement',
					default: 'example',
					useVariables: true,
				},
				{
					id: 'tags',
					type: 'textinput',
					label: 'Tags',
					default: 'tag1=value1,tag2=value2',
					useVariables: true,
				},
				{
					id: 'field',
					type: 'textinput',
					label: 'Field',
					default: 'field',
					useVariables: true,
				},
				{
					id: 'value',
					type: 'dropdown',
					label: 'Value',
					default: 'true',
					choices: [
						{ id: 'true', label: 'True' },
						{ id: 'false', label: 'False' },
					],
				},
			],
			callback: async (event, context) => {
				try {
					// Parse variables in options
					const measurementString = await context.parseVariablesInString(event.options.measurement)
					const tagsString = await context.parseVariablesInString(event.options.tags)
					const fieldString = await context.parseVariablesInString(event.options.field)

					// Create point
					const point = new Point(measurementString).booleanField(fieldString, event.options.value === 'true')

					// Add tags
					const tags = tagsString.split(',')
					tags.forEach((tag) => {
						const [key, value] = tag.split('=')
						point.tag(key, value)
					})

					// Send to Influx
					self.writeApi.writePoint(point)
					self.log(
						'debug',
						`Sent to Influx: ${measurementString},${tagsString} ${fieldString}=${event.options.value} ${Date.now() * 1000000}`
					)
				} catch (error) {
					self.log('error', `Error sending to Influx: ${error.message}`)
					self.updateStatus(InstanceStatus.UnknownError, error.message)
				}
			},
		},
		writeInflux: {
			name: 'Write',
			description:
				'Writes a single line to InfluxDB. Fields and tags should be comma separated with key=value pairs, and fields with string values should be enclosed in double quotes.',
			options: [
				{
					id: 'measurement',
					type: 'textinput',
					label: 'Measurement',
					default: 'exampleMeasurement',
					useVariables: true,
				},
				{
					id: 'tags',
					type: 'textinput',
					label: 'Tags',
					default: 'tag1=value1,tag2=value2',
					useVariables: true,
				},
				{
					id: 'fields',
					type: 'textinput',
					label: 'Fields',
					default: 'field1=1234.5,field2="value2"',
					useVariables: true,
				},
			],
			callback: async (event) => {
				try {
					// Parse variables in options
					const measurementString = await self.parseVariablesInString(event.options.measurement)
					const tagsString = await self.parseVariablesInString(event.options.tags)
					const fieldsString = await self.parseVariablesInString(event.options.fields)

					// Create payload
					const payload = `${measurementString},${tagsString} ${fieldsString} ${Date.now() * 1000000}`

					// Send to Influx
					self.writeApi.writeRecord(payload)
					self.log('debug', `Sent to Influx: ${payload}`)
				} catch (error) {
					self.log('error', `Error sending to Influx: ${error.message}`)
					self.updateStatus(InstanceStatus.UnknownError, error.message)
				}
			},
		},
		flushBuffer: {
			name: 'Flush Buffer',
			description:
				'By default this module will buffer writes to InfluxDB for efficiency. This action will immediately flush the buffer and send all pending writes to InfluxDB',
			callback: async () => {
				try {
					self.writeApi.flush()
					self.log('debug', 'InfluxDB buffer flushed')
				} catch (error) {
					self.log('error', `Error flushing InfluxDB buffer: ${error.message}`)
					self.updateStatus(InstanceStatus.UnknownError, error.message)
				}
			},
		},
	})
}
