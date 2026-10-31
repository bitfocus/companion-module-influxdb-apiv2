import { describe, expect, test } from 'vitest'
import lp from '../src/lineprotocol.js'

const { parseTags, parseFields, parseTimestamp, buildLine } = lp

describe('parseTags', () => {
	test('parses key=value pairs and trims whitespace', () => {
		expect(parseTags(' a = 1 , b=2 ')).toEqual({ tags: { a: '1', b: '2' }, errors: [] })
	})

	test('empty input gives no tags', () => {
		expect(parseTags('')).toEqual({ tags: {}, errors: [] })
		expect(parseTags(undefined)).toEqual({ tags: {}, errors: [] })
		expect(parseTags(' , ,')).toEqual({ tags: {}, errors: [] })
	})

	test('values may contain = and escaped commas', () => {
		expect(parseTags('q=a=b,list=x\\,y').tags).toEqual({ q: 'a=b', list: 'x,y' })
	})

	test('escaped = in keys', () => {
		expect(parseTags('a\\=b=c').tags).toEqual({ 'a=b': 'c' })
	})

	test('malformed entries are reported and skipped', () => {
		const result = parseTags('good=1,nokey,=novalue,empty=')
		expect(result.tags).toEqual({ good: '1' })
		expect(result.errors).toHaveLength(3)
	})
})

describe('buildLine', () => {
	test('omits the tag separator when there are no tags', () => {
		expect(buildLine('m', '', 'v=1')).toBe('m v=1')
		expect(buildLine('m', ' , ', 'v=1')).toBe('m v=1')
	})

	test('joins tags and appends the timestamp', () => {
		expect(buildLine('m', 'a=1, b=2', 'v=1,s="x"', '123')).toBe('m,a=1,b=2 v=1,s="x" 123')
	})

	test('requires a measurement and fields', () => {
		expect(() => buildLine('', '', 'v=1')).toThrow('Measurement')
		expect(() => buildLine('m', '', ' ')).toThrow('field')
	})
})

describe('parseFields', () => {
	test('infers types from line protocol syntax', () => {
		const { fields, errors } = parseFields('f=21.5, i=-3i, u=7u, b=true, s="text"')
		expect(errors).toEqual([])
		expect(fields).toEqual([
			{ key: 'f', type: 'float', value: 21.5 },
			{ key: 'i', type: 'int', value: '-3' },
			{ key: 'u', type: 'uint', value: '7' },
			{ key: 'b', type: 'bool', value: true },
			{ key: 's', type: 'string', value: 'text' },
		])
	})

	test('quoted strings may contain commas, equals signs and escaped quotes', () => {
		expect(parseFields('note="a, b = \\"c\\"", x=1').fields).toEqual([
			{ key: 'note', type: 'string', value: 'a, b = "c"' },
			{ key: 'x', type: 'float', value: 1 },
		])
	})

	test('accepts the line protocol boolean spellings and exponent floats', () => {
		expect(parseFields('a=F,b=True,c=1e3').fields.map((f) => f.value)).toEqual([false, true, 1000])
	})

	test('reports values that are not valid', () => {
		const { fields, errors } = parseFields('ok=1, bad=abc, nokey, =1, empty=, u=-1u')
		expect(fields).toEqual([{ key: 'ok', type: 'float', value: 1 }])
		expect(errors).toHaveLength(5)
	})
})

describe('parseTimestamp', () => {
	test('empty means now', () => {
		expect(parseTimestamp('', 'ms')).toBeUndefined()
		expect(parseTimestamp(undefined, 'ms')).toBeUndefined()
	})

	test('scales integers to nanoseconds', () => {
		expect(parseTimestamp('1761900000', 's')).toBe('1761900000000000000')
		expect(parseTimestamp('1761900000000', 'ms')).toBe('1761900000000000000')
		expect(parseTimestamp(' 1761900000000000000 ', 'ns')).toBe('1761900000000000000')
	})

	test('parses dates', () => {
		expect(parseTimestamp('2025-10-31T09:00:00Z', 'ms')).toBe('1761901200000000000')
	})

	test('rejects garbage', () => {
		expect(() => parseTimestamp('soon', 'ms')).toThrow('not a timestamp')
	})
})
