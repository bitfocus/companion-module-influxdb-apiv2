/** Human friendly names for the Companion status values, for the connection_status variable */
const STATUS_LABELS = {
	ok: 'OK',
	connecting: 'Connecting',
	disconnected: 'Disconnected',
	connection_failure: 'Connection failure',
	bad_config: 'Bad config',
	unknown_error: 'Error',
	unknown_warning: 'Warning',
	authentication_failure: 'Authentication failure',
	insufficient_permissions: 'Insufficient permissions',
}

module.exports = function (self) {
	self.setVariableDefinitions({
		connection_status: { name: 'Connection status (OK, Connecting, Bad config, ...)' },
		connection_message: { name: 'Connection status message (empty when OK)' },
		server_version: { name: 'InfluxDB server version' },
		points_queued: { name: 'Points queued since the connection started' },
		points_written: { name: 'Points written since the connection started' },
		write_errors: { name: 'Failed write attempts since the connection started' },
		last_error: { name: 'Last write error' },
		last_write_time: { name: 'Time of the last successful write (HH:MM:SS)' },
	})

	self.setVariableValues({
		connection_status: STATUS_LABELS[self.currentStatus.status] ?? self.currentStatus.status,
		connection_message: self.currentStatus.message,
		server_version: self.serverVersion ?? '',
	})
	self.publishStats()
}

module.exports.STATUS_LABELS = STATUS_LABELS
