import http from 'node:http'

/** A tiny stand-in for the InfluxDB HTTP API */
export function fakeInflux() {
	const state = {
		writes: [],
		probes: 0,
		requiredToken: null,
		writeStatus: 204,
		healthStatus: 200,
		health: { status: 'pass', version: 'v2.7.12' },
	}
	const server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c))
		req.on('end', () => {
			if (req.url.startsWith('/health')) {
				res.writeHead(state.healthStatus, { 'content-type': 'application/json' })
				res.end(JSON.stringify(state.health))
			} else if (req.url.startsWith('/api/v2/write')) {
				// Empty bodies are the module's access probe, not data
				if (body === '') state.probes++
				else state.writes.push({ url: req.url, auth: req.headers.authorization, body })

				const status =
					state.requiredToken && req.headers.authorization !== `Token ${state.requiredToken}` ? 401 : state.writeStatus
				res.writeHead(status, { 'content-type': 'application/json' })
				res.end(status === 204 ? '' : JSON.stringify({ code: 'err', message: `status ${status}` }))
			} else {
				res.writeHead(404)
				res.end()
			}
		})
	})
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ state, server, url: `http://127.0.0.1:${server.address().port}` })),
	)
}
