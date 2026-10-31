const { combineRgb } = require('@companion-module/base')

module.exports = function (self) {
	self.setFeedbackDefinitions({
		connectionOk: {
			type: 'boolean',
			name: 'Connection OK',
			description:
				'True while InfluxDB is reachable, the token is accepted and writes to the configured bucket are succeeding',
			defaultStyle: {
				bgcolor: combineRgb(0, 153, 51),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.currentStatus.status === 'ok',
		},
		writesFailing: {
			type: 'boolean',
			name: 'Writes failing',
			description:
				'True when the connection is not OK: writes to the configured bucket are being rejected, the server is unreachable, or the config is wrong',
			defaultStyle: {
				bgcolor: combineRgb(204, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => !['ok', 'connecting'].includes(self.currentStatus.status),
		},
	})
}
