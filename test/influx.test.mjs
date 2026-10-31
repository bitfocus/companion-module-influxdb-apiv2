import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Point } from '@influxdata/influxdb-client'
import influx from '../src/influx.js'
import cfg from '../src/config.js'
import { fakeInflux } from './fake-influx.mjs'

const { InfluxConnection, describeError } = influx

describe('InfluxConnection', () => {
	let fake, connection, events

	beforeEach(async () => {
		fake = await fakeInflux()
		events = { success: [], failed: [], dropped: [] }
	})

	afterEach(async () => {
		await connection?.close().catch(() => {})
		await new Promise((r) => fake.server.close(r))
	})

	const connect = (overrides = {}) => {
		const { config } = cfg.resolveConfig(
			{ url: fake.url, org: 'myorg', bucket: 'mybucket', flushInterval: 60000, maxRetries: 0, ...overrides },
			{ token: 'secret' },
		)
		connection = new InfluxConnection(config, {
			onWriteSuccess: (lines) => events.success.push(lines),
			onWriteFailed: (error, lines) => events.failed.push({ error, lines }),
			onDropped: (count, target) => events.dropped.push({ count, bucket: target.bucket }),
		})
		return connection
	}

	test('health check reports the version', async () => {
		await expect(connect().checkHealth()).resolves.toEqual({ version: 'v2.7.12' })
	})

	test('health check fails when the server reports fail', async () => {
		fake.state.health = { status: 'fail', message: 'db down' }
		fake.state.healthStatus = 503
		await expect(connect().checkHealth()).rejects.toThrow()
	})

	test('flush sends buffered points with token, org, bucket and default tags', async () => {
		const c = connect({ defaultTags: 'source=companion' })
		c.writePoint(new Point('m').floatField('v', 1))
		c.writeRecords(['raw x=1 1'])
		expect(fake.state.writes).toHaveLength(0)

		await c.flush()
		expect(fake.state.writes).toHaveLength(1)
		const [write] = fake.state.writes
		expect(write.auth).toBe('Token secret')
		expect(write.url).toContain('org=myorg')
		expect(write.url).toContain('bucket=mybucket')
		expect(write.body).toMatch(/^m,source=companion v=1 \d+\nraw x=1 1$/)
		expect(events.success).toHaveLength(1)
	})

	test('a bucket override gets its own writer and is flushed and closed too', async () => {
		const c = connect()
		c.writePoint(new Point('m').floatField('v', 1))
		c.writePoint(new Point('m').floatField('v', 2), { bucket: 'other' })
		await c.close()
		expect(fake.state.writes.map((w) => new URL(w.url, 'http://x').searchParams.get('bucket')).sort()).toEqual([
			'mybucket',
			'other',
		])
	})

	test('beyond 20 overrides the least recently used writer is flushed and closed, not refused', async () => {
		const c = connect()
		for (let i = 0; i < 25; i++) c.writePoint(new Point('m').floatField('v', i), { bucket: `b${i}` })
		expect(c.writeApis.size).toBe(21)
		await c.close()
		const buckets = fake.state.writes.map((w) => new URL(w.url, 'http://x').searchParams.get('bucket'))
		expect(buckets.sort()).toEqual(Array.from({ length: 25 }, (_, i) => `b${i}`).sort())
	})

	test('a close that times out also disposes writers still closing after eviction', async () => {
		const c = connect()
		for (let i = 0; i < 21; i++) c.writePoint(new Point('m').floatField('v', i), { bucket: `b${i}` })
		const [evicted] = c.closingWriters.keys()
		expect(evicted).toBeDefined()
		let disposed = false
		evicted.dispose = () => {
			disposed = true
			return 0
		}
		// Make every close hang so the 5 s timeout fires
		for (const w of c.writeApis.values()) w.close = () => new Promise(() => {})
		c.closingWriters.set(evicted, new Promise(() => {}))
		vi.useFakeTimers()
		const closing = c.close().catch((e) => e)
		await vi.advanceTimersByTimeAsync(6000)
		vi.useRealTimers()
		expect(await closing).toBeInstanceOf(Error)
		expect(disposed).toBe(true)
		connection = null
	})

	test('evicting a writer whose points cannot be sent reports how many were dropped', async () => {
		fake.state.writeStatus = 503
		// With retries on, a failed batch waits in the retry queue, which is what eviction can lose
		const c = connect({ maxRetries: 3 })
		for (let i = 0; i < 20; i++) c.writePoint(new Point('m').floatField('v', i), { bucket: `b${i}` })
		c.writePoint(new Point('m').floatField('v', 1), { bucket: 'b0' })
		c.writePoint(new Point('m').floatField('v', 99), { bucket: 'new' })
		await Promise.all(c.closingWriters.values())
		expect(events.dropped).toEqual([{ count: 1, bucket: 'b1' }])
		fake.state.writeStatus = 204
		await c.close()
	})

	test('using an override again keeps it from being evicted', async () => {
		const c = connect()
		for (let i = 0; i < 20; i++) c.writePoint(new Point('m').floatField('v', i), { bucket: `b${i}` })
		c.writePoint(new Point('m').floatField('v', 99), { bucket: 'b0' })
		c.writePoint(new Point('m').floatField('v', 100), { bucket: 'new' })
		const keys = [...c.writeApis.keys()].map((k) => k.split('\n')[1])
		expect(keys).toContain('b0')
		expect(keys).not.toContain('b1')
		expect(keys[0]).toBe('mybucket')
		await c.close()
	})

	test('close flushes what is still buffered', async () => {
		const c = connect()
		c.writePoint(new Point('m').floatField('v', 2))
		await c.close()
		expect(fake.state.writes).toHaveLength(1)
		await expect(c.close()).resolves.toBeUndefined()
	})

	test('write failures are reported with a useful status', async () => {
		fake.state.writeStatus = 401
		const c = connect()
		c.writePoint(new Point('m').floatField('v', 3))
		await c.flush().catch(() => {})

		expect(events.failed).toHaveLength(1)
		expect(describeError(events.failed[0].error)).toEqual({
			status: 'authentication_failure',
			message: 'Unauthorized, check the token (status 401)',
		})
	})

	test('describeError maps not found to bad config', async () => {
		fake.state.writeStatus = 404
		const c = connect()
		c.writePoint(new Point('m').floatField('v', 4))
		await c.flush().catch(() => {})
		expect(describeError(events.failed[0].error).status).toBe('bad_config')
	})
})

describe('describeError', () => {
	test('a missing org is a config problem', async () => {
		const { HttpError } = await import('@influxdata/influxdb-client')
		const error = new HttpError(400, 'Bad Request', '{"code":"invalid","message":"Please provide either orgID or org"}')
		expect(describeError(error).status).toBe('bad_config')
	})
})
