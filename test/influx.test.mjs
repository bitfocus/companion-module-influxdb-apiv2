import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Point } from '@influxdata/influxdb-client'
import influx from '../src/influx.js'
import cfg from '../src/config.js'
import { fakeInflux } from './fake-influx.mjs'

const { InfluxConnection, describeError } = influx

describe('InfluxConnection', () => {
	let fake, connection, events

	beforeEach(async () => {
		fake = await fakeInflux()
		events = { success: [], failed: [] }
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
