import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import InfluxInstance from '../src/main.js'
import { fakeInflux } from './fake-influx.mjs'

/** Construct the instance the way Companion's host would, with a recording context */
function createInstance() {
	const statuses = []
	let actions
	const context = {
		_isInstanceContext: true,
		id: 'test',
		label: 'influx',
		updateStatus: (status, message) => statuses.push({ status, message }),
		setActionDefinitions: (defs) => (actions = defs),
		setFeedbackDefinitions: () => {},
		setVariableDefinitions: () => {},
	}
	const instance = new InfluxInstance(context)
	const logs = []
	instance.log = (level, message) => logs.push({ level, message })
	const runAction = (id, options = {}) => actions[id].callback({ options }, {})
	const lastStatus = () => statuses.at(-1)
	return { instance, statuses, logs, runAction, lastStatus }
}

describe('InfluxInstance lifecycle', () => {
	let fake, t

	beforeEach(async () => {
		fake = await fakeInflux()
		t = createInstance()
	})

	afterEach(async () => {
		await t.instance.destroy()
		await new Promise((r) => fake.server.close(r))
	})

	const config = (overrides = {}) => ({
		url: fake.url,
		org: 'o',
		bucket: 'b',
		flushInterval: 60000,
		maxRetries: 0,
		...overrides,
	})
	const point = { measurement: 'm', tags: 'a=1', field: 'v', value: '1' }

	test('goes from connecting to ok once healthy', async () => {
		await t.instance.init(config(), true, { token: 'tok' })
		expect(t.statuses[0].status).toBe('connecting')
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('ok'))
	})

	test('bad config sets bad_config instead of throwing', async () => {
		await t.instance.init({ url: '', bucket: '' }, true, {})
		expect(t.lastStatus().status).toBe('bad_config')
		await t.runAction('writeFloatPoint', point)
		expect(t.logs.at(-1).message).toMatch(/Not connected/)
	})

	test('an unreachable server reports connection_failure', async () => {
		fake.state.healthStatus = 503
		fake.state.health = { status: 'fail', message: 'down' }
		await t.instance.init(config(), true, {})
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('connection_failure'))
	})

	test('a bad token is reported at startup, before anything is written', async () => {
		fake.state.requiredToken = 'right'
		await t.instance.init(config(), true, { token: 'wrong' })
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('authentication_failure'))
		expect(fake.state.probes).toBeGreaterThan(0)
		expect(fake.state.writes).toHaveLength(0)
	})

	test('a missing bucket is reported at startup', async () => {
		fake.state.writeStatus = 404
		await t.instance.init(config(), true, {})
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('bad_config'))
	})

	test('write failures show in the status and clear on the next success', async () => {
		await t.instance.init(config(), true, { token: 'bad' })
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('ok'))

		fake.state.writeStatus = 401
		await t.runAction('writeFloatPoint', point)
		await t.runAction('flushBuffer')
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('authentication_failure'))

		fake.state.writeStatus = 204
		await t.runAction('writeFloatPoint', point)
		await t.runAction('flushBuffer')
		await vi.waitFor(() => expect(t.lastStatus().status).toBe('ok'))
	})

	test('changing the config flushes the old buffer to the old server', async () => {
		await t.instance.init(config(), true, {})
		await t.runAction('writeFloatPoint', point)
		expect(fake.state.writes).toHaveLength(0)

		await t.instance.configUpdated(config({ bucket: 'other' }), {})
		expect(fake.state.writes).toHaveLength(1)
		expect(fake.state.writes[0].url).toContain('bucket=b')
	})

	test('destroy flushes buffered points', async () => {
		await t.instance.init(config(), true, {})
		await t.runAction('writeStringPoint', { ...point, value: 'x' })
		await t.instance.destroy()
		expect(fake.state.writes).toHaveLength(1)
		expect(fake.state.writes[0].body).toMatch(/^m,a=1 v="x" \d+$/)
	})
})
