import { beforeEach, describe, expect, test } from 'vitest'
import UpdateActions from '../src/actions.js'

const { toBoolean } = UpdateActions

function setup() {
	const written = []
	const targets = []
	const logs = []
	let definitions
	const self = {
		setActionDefinitions: (defs) => (definitions = defs),
		log: (level, message) => logs.push({ level, message }),
		requireConnection: () => ({
			writePoint: (point, target) => {
				written.push(point.toLineProtocol())
				targets.push(target)
			},
			writeRecords: (lines) => written.push(...lines),
			flush: async () => written.push('<flush>'),
		}),
	}
	UpdateActions(self)
	const run = (id, options) => definitions[id].callback({ options }, {})
	return { written, targets, logs, definitions, run, self }
}

/** Strip the trailing timestamp from a line */
const noTs = (line) => line.replace(/ \d+$/, '')

describe('actions', () => {
	let t
	beforeEach(() => (t = setup()))

	test('keeps the v1 action ids', () => {
		expect(Object.keys(t.definitions).sort()).toEqual(
			['flushBuffer', 'writeBooleanPoint', 'writeFloatPoint', 'writeInflux', 'writePoint', 'writeStringPoint'].sort(),
		)
	})

	test('float point uses the given measurement and field', async () => {
		await t.run('writeFloatPoint', { measurement: 'room temp', tags: 'site=a', field: 'celsius', value: '21.5' })
		expect(t.written.map(noTs)).toEqual(['room\\ temp,site=a celsius=21.5'])
	})

	test('float point rejects non-numbers without writing', async () => {
		await t.run('writeFloatPoint', { measurement: 'm', tags: '', field: 'v', value: '12abc' })
		expect(t.written).toEqual([])
		expect(t.logs.at(-1)).toMatchObject({ level: 'warn' })
	})

	test('empty tags write a point without tags', async () => {
		await t.run('writeStringPoint', { measurement: 'm', tags: '', field: 'f', value: 'hello "x"' })
		expect(t.written.map(noTs)).toEqual(['m f="hello \\"x\\""'])
	})

	test('boolean point accepts expression style values', async () => {
		await t.run('writeBooleanPoint', { measurement: 'm', tags: '', field: 'on', value: 'false' })
		await t.run('writeBooleanPoint', { measurement: 'm', tags: '', field: 'on', value: true })
		await t.run('writeBooleanPoint', { measurement: 'm', tags: '', field: 'on', value: 'maybe' })
		expect(t.written.map(noTs)).toEqual(['m on=F', 'm on=T'])
	})

	test('raw write builds valid line protocol with a nanosecond timestamp', async () => {
		await t.run('writeInflux', { measurement: 'm', tags: '', fields: 'a=1,b="x"' })
		const [line] = t.written
		expect(line).toMatch(/^m a=1,b="x" \d{19}$/)
		const ts = BigInt(line.split(' ').at(-1))
		const now = BigInt(Date.now()) * 1000000n
		expect(now - ts < 5_000_000_000n).toBe(true)
	})

	test('reports a missing connection instead of throwing', async () => {
		t.self.requireConnection = () => {
			throw new Error('Not connected to InfluxDB')
		}
		await expect(
			t.run('writeFloatPoint', { measurement: 'm', tags: '', field: 'v', value: '1' }),
		).resolves.toBeUndefined()
		await expect(t.run('flushBuffer', {})).resolves.toBeUndefined()
		expect(t.logs.filter((l) => l.level === 'warn')).toHaveLength(2)
	})

	test('write point with typed fields, timestamp and bucket override', async () => {
		await t.run('writePoint', {
			measurement: 'm',
			tags: 'a=1',
			fields: 'f=1.5, i=2i, b=false, s="x, y"',
			timestamp: '1761900000',
			precision: 's',
			bucket: ' other ',
			org: '',
		})
		expect(t.written).toEqual(['m,a=1 b=F,f=1.5,i=2i,s="x, y" 1761900000000000000'])
		expect(t.targets).toEqual([{ bucket: 'other', org: '' }])
	})

	test('write point skips bad fields but writes the rest', async () => {
		await t.run('writePoint', { measurement: 'm', tags: '', fields: 'good=1, bad=nope', precision: 'ms' })
		expect(t.written.map(noTs)).toEqual(['m good=1'])
		expect(t.logs.some((l) => l.level === 'warn' && l.message.includes('bad'))).toBe(true)
	})

	test('write point with no valid fields writes nothing', async () => {
		await t.run('writePoint', { measurement: 'm', tags: '', fields: 'bad=nope', precision: 'ms' })
		await t.run('writePoint', { measurement: 'm', tags: '', fields: '', precision: 'ms' })
		await t.run('writePoint', { measurement: 'm', tags: '', fields: 'a=1', timestamp: 'later', precision: 'ms' })
		expect(t.written).toEqual([])
	})

	test('flush', async () => {
		await t.run('flushBuffer', {})
		expect(t.written).toEqual(['<flush>'])
	})
})

describe('toBoolean', () => {
	test.each([
		[true, true],
		['TRUE', true],
		['on', true],
		[1, true],
		['0', false],
		['no', false],
		[false, false],
		['x', undefined],
		[undefined, undefined],
	])('%s -> %s', (input, expected) => {
		expect(toBoolean(input)).toBe(expected)
	})
})

describe('action defaults', () => {
	test('default point actions do not write the same field with different types', () => {
		const { definitions } = setup()
		const key = (id) => {
			const opts = Object.fromEntries(definitions[id].options.map((o) => [o.id, o.default]))
			return `${opts.measurement}.${opts.field}`
		}
		const keys = ['writeFloatPoint', 'writeStringPoint', 'writeBooleanPoint'].map(key)
		expect(new Set(keys).size).toBe(keys.length)
	})
})
