import { describe, expect, test } from 'vitest'
import UpgradeScripts from '../src/upgrades.js'

const [moveTokenToSecrets] = UpgradeScripts

const run = (config, secrets = null) =>
	moveTokenToSecrets({ currentConfig: config ?? {} }, { config, secrets, actions: [], feedbacks: [] })

describe('moveTokenToSecrets', () => {
	test('moves the token out of the config', () => {
		const result = run({ url: 'http://x', token: 'abc', org: 'o', bucket: 'b' })
		expect(result.updatedConfig).toEqual({ url: 'http://x', org: 'o', bucket: 'b' })
		expect(result.updatedSecrets).toEqual({ token: 'abc' })
	})

	test('does not overwrite an existing secret', () => {
		const result = run({ token: 'old' }, { token: 'new' })
		expect(result.updatedConfig).toEqual({})
		expect(result.updatedSecrets).toBeNull()
	})

	test('no-op when there is nothing to move', () => {
		expect(run({ url: 'http://x' }).updatedConfig).toBeNull()
		expect(run(null).updatedConfig).toBeNull()
	})
})
