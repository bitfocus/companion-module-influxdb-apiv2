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

	test('backslashes that are not escapes are kept', () => {
		expect(parseTags('dir=C:\\temp\\x').tags).toEqual({ dir: 'C:\\temp\\x' })
		expect(parseTags('a=b\\\\c').tags).toEqual({ a: 'b\\c' })
	})

	test('an escaped space is unescaped so the client escapes it once', () => {
		expect(parseTags('room=Studio\\ A').tags).toEqual({ room: 'Studio A' })
	})

	test('a trailing escaped space is kept', () => {
		expect(parseTags('room=Studio\\ ').tags).toEqual({ room: 'Studio ' })
	})

	test('an escaped backslash is a literal backslash, so UNC paths work', () => {
		expect(parseTags('share=\\\\\\\\nas\\media').tags).toEqual({ share: '\\\\nas\\media' })
	})

	test('a literal backslash right before a separator is rejected', () => {
		const result = parseTags('b=x\\\\\\ y,ok=1')
		expect(result.tags).toEqual({ ok: '1' })
		expect(result.errors[0]).toMatch(/backslash/)
	})

	test('a tag ending in a backslash is rejected instead of breaking the line', () => {
		const result = parseTags('ok=1,p=C:\\')
		expect(result.tags).toEqual({ ok: '1' })
		expect(result.errors[0]).toMatch(/backslash/)
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

	test('field names: escaped spaces are unescaped and a trailing backslash is rejected', () => {
		expect(parseFields('a\\ b=1').fields).toEqual([{ key: 'a b', type: 'float', value: 1 }])
		expect(parseFields('dir\\ =2').fields.map((f) => f.key)).toEqual(['dir '])
		const result = parseFields('ok=1, dir\\\\=2')
		expect(result.fields.map((f) => f.key)).toEqual(['ok'])
		expect(result.errors[0]).toMatch(/backslash/)
	})

	test('out-of-range numbers are skipped one field at a time', () => {
		const { fields, errors } = parseFields(
			'ok=1, big=1e400, u=18446744073709551616u, umax=18446744073709551615u, i=9223372036854775808i, imin=-9223372036854775808i',
		)
		expect(fields.map((f) => f.key)).toEqual(['ok', 'umax', 'imin'])
		expect(errors).toHaveLength(3)
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

	test('rejects impossible dates instead of rolling them over', () => {
		expect(() => parseTimestamp('2026-02-31', 'ms')).toThrow('not a timestamp')
		expect(() => parseTimestamp('2026-13-01T00:00:00Z', 'ms')).toThrow('not a timestamp')
		expect(parseTimestamp('2028-02-29T00:00:00Z', 'ms')).toBe('1835395200000000000')
	})

	test('keeps time zone offsets', () => {
		expect(parseTimestamp('2026-10-31T23:00:00-05:00', 'ms')).toBe('1793505600000000000')
	})

	test('rejects short decimals and phrases that Date.parse would accept', () => {
		expect(() => parseTimestamp('12.5', 's')).toThrow('not a timestamp')
		expect(() => parseTimestamp('Monday 5', 'ms')).toThrow('not a timestamp')
	})
})
