module.exports = function (self) {
	self.setActionDefinitions({
		sample_action: {
			name: 'My First Action',
			options: [
				{
					id: 'num',
					type: 'number',
					label: 'Test',
					default: 5,
					min: 0,
					max: 100,
				},
			],
			callback: async (event) => {
				console.log('Hello world!', event.options.num)
			},
		},
		writeFloatPoint: {
			name: 'Write Float Point',
			description: 'Write a float point to InfluxDB',
			options: [
				{
					id: 'measurement',
					type: 'textinput',
					label: 'Measurement',
					default: 'example',
				},
				{
					id: 'field',
					type: 'textinput',
					label: 'Field',
					default: 'value',
				},
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '0',
					useVariables: true,
				},
			],
			callback: async (event) => {
				if (self.writeApi) {
					const point = new self.influx.Point(event.options.measurement).floatField(
						event.options.field,
						parseFloat(event.options.value)
					)
					self.writeApi.writePoint(point)
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
				},
				{
					id: 'field',
					type: 'textinput',
					label: 'Field',
					default: 'value',
				},
				{
					id: 'value',
					type: 'textinput',
					label: 'Value',
					default: '0',
					useVariables: true,
				},
			],
			callback: async (event) => {
				if (self.writeApi) {
					const point = new self.influx.Point(event.options.measurement).stringField(
						event.options.field,
						event.options.value
					)
					self.writeApi.writePoint(point)
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
				},
				{
					id: 'field',
					type: 'textinput',
					label: 'Field',
					default: 'value',
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
			callback: async (event) => {
				if (self.writeApi) {
					const point = new self.influx.Point(event.options.measurement).booleanField(
						event.options.field,
						event.options.value === 'true'
					)
					self.writeApi.writePoint(point)
				}
			},
		},
		writeInfluxLine: {
			name: 'Write Influx Line',
			description: 'Writes a single line to InfluxDB. The line must be in the InfluxDB line protocol format.',
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
					default: 'field1=value1,field2=value2',
					useVariables: true,
				},
			],
			callback: async (event) => {
				if (self.writeApi) {
					self.writeApi.writeRecord(
						`${event.options.measurement},${event.options.tags} ${event.options.fields} ${Date.now() * 1000000}`
					)
					self.writeApi.flush()
					// log the line to the console
					self.log('debug', `Sent to Influx: ${event.options.measurement},${event.options.tags} ${event.options.fields} ${Date.now() * 1000000}`)
				}
			},
		},
	})
}
