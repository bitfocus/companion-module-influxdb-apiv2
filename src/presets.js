const { combineRgb } = require('@companion-module/base')

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

module.exports = function (self) {
	const v = (name) => `$(${self.label}:${name})`

	const style = (text) => ({
		text,
		size: 'auto',
		color: WHITE,
		bgcolor: BLACK,
	})

	/** @type {import('@companion-module/base').CompanionPresetDefinitions} */
	const presets = {
		status: {
			type: 'simple',
			name: 'Connection status (press to flush)',
			style: style(`InfluxDB\\n${v('connection_status')}`),
			steps: [{ down: [{ actionId: 'flushBuffer', options: {} }], up: [] }],
			feedbacks: [
				{ feedbackId: 'connectionOk', options: {}, style: { bgcolor: combineRgb(0, 153, 51), color: WHITE } },
				{ feedbackId: 'writesFailing', options: {}, style: { bgcolor: combineRgb(204, 0, 0), color: WHITE } },
			],
		},
		written: {
			type: 'simple',
			name: 'Points written',
			style: style(`Written\\n${v('points_written')}`),
			steps: [{ down: [], up: [] }],
			feedbacks: [
				{ feedbackId: 'writesFailing', options: {}, style: { bgcolor: combineRgb(204, 0, 0), color: WHITE } },
			],
		},
		lastWrite: {
			type: 'simple',
			name: 'Last write time',
			style: style(`Last write\\n${v('last_write_time')}`),
			steps: [{ down: [], up: [] }],
			feedbacks: [],
		},
		flush: {
			type: 'simple',
			name: 'Flush buffer',
			style: style('Flush\\nInfluxDB'),
			steps: [{ down: [{ actionId: 'flushBuffer', options: {} }], up: [] }],
			feedbacks: [],
		},
		logPress: {
			type: 'simple',
			name: 'Log this button press',
			style: style('Log\\npress'),
			steps: [
				{
					down: [
						{
							actionId: 'writePoint',
							options: {
								measurement: 'companion_button',
								tags: 'page=$(this:page),button=$(this:row)/$(this:column)',
								fields: 'pressed=true',
								timestamp: '',
								precision: 'ms',
								bucket: '',
								org: '',
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		},
	}

	self.setPresetDefinitions(
		[
			{
				id: 'status',
				name: 'Status',
				description: 'Show whether logging to InfluxDB is working',
				definitions: [
					{
						id: 'status-buttons',
						type: 'simple',
						name: 'Status',
						presets: ['status', 'written', 'lastWrite'],
					},
				],
			},
			{
				id: 'writing',
				name: 'Writing',
				definitions: [
					{
						id: 'writing-buttons',
						type: 'simple',
						name: 'Writing',
						description: 'Starting points to copy and adapt',
						presets: ['logPress', 'flush'],
					},
				],
			},
		],
		presets,
	)
}
