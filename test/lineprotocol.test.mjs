import { describe, expect, test } from 'vitest'
import lp from '../src/lineprotocol.js'

const { parseTags, buildLine } = lp

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
