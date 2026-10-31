import http from 'node:http'

/** Annotated CSV as returned by InfluxDB 2.x for a Flux query: three temperature rows */
export const SAMPLE_CSV = [
	'#datatype,string,long,dateTime:RFC3339,dateTime:RFC3339,dateTime:RFC3339,double,string,string,string',
	'#group,false,false,true,true,false,false,true,true,true',
	'#default,_result,,,,,,,,',
	',result,table,_start,_stop,_time,_value,_field,_measurement,room',
	',,0,2026-10-31T00:00:00Z,2026-10-31T01:00:00Z,2026-10-31T00:10:00Z,21.5,temp,m,a',
	',,0,2026-10-31T00:00:00Z,2026-10-31T01:00:00Z,2026-10-31T00:20:00Z,22.5,temp,m,a',
	',,0,2026-10-31T00:00:00Z,2026-10-31T01:00:00Z,2026-10-31T00:30:00Z,23.5,temp,m,a',
	'',
	'',
].join('\r\n')

/** A tiny stand-in for the InfluxDB HTTP API */
export function fakeInflux() {
	const state = {
		writes: [],
		queries: [],
		queryStatus: 200,
		queryCsv: SAMPLE_CSV,
		queryDelay: 0,
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
			} else if (req.url.startsWith('/api/v2/query')) {
				state.queries.push({ url: req.url, body: JSON.parse(body || '{}') })
				if (state.queryDelay) {
					// Hold the response open to simulate a slow query
					setTimeout(() => {
						if (!res.writableEnded && !res.destroyed) {
							res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' })
							res.end(state.queryCsv)
						}
					}, state.queryDelay)
				} else if (state.queryStatus !== 200) {
					res.writeHead(state.queryStatus, { 'content-type': 'application/json' })
					res.end(JSON.stringify({ code: 'invalid', message: `query status ${state.queryStatus}` }))
				} else {
					res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' })
					res.end(state.queryCsv)
				}
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
