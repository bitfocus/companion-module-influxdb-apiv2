import { describe, expect, test } from 'vitest'
import cfg from '../src/config.js'

const { resolveConfig, GetConfigFields } = cfg

describe('resolveConfig', () => {
	test('fills defaults for configs saved by older versions', () => {
		const { config, errors } = resolveConfig({ url: 'http://influx:8086/', org: 'o', bucket: 'b' }, { token: ' t ' })
		expect(errors).toEqual([])
		expect(config).toMatchObject({
			url: 'http://influx:8086',
			token: 't',
			org: 'o',
			bucket: 'b',
			flushInterval: 1000,
			batchSize: 1000,
			healthInterval: 30,
			defaultTags: {},
		})
	})

	test('reports missing bucket and bad url instead of throwing', () => {
		const { errors } = resolveConfig({ url: 'not a url' }, undefined)
		expect(errors).toContain('URL is not valid')
		expect(errors).toContain('Bucket is required')
		expect(resolveConfig(undefined, undefined).errors).toContain('Bucket is required')
	})

	test('parses default tags', () => {
		const { config } = resolveConfig({ bucket: 'b', defaultTags: 'site=main, source=companion' }, {})
		expect(config.defaultTags).toEqual({ site: 'main', source: 'companion' })
	})

	test('token is a secret field', () => {
		expect(GetConfigFields().find((f) => f.id === 'token')?.type).toBe('secret-text')
	})
})
