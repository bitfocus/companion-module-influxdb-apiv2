import { describe, expect, test } from 'vitest'
import UpgradeScripts from '../src/upgrades.js'

describe('entrypoint', () => {
	test('exports the module class as default and UpgradeScripts by name', async () => {
		const entry = await import('../src/index.mjs')
		expect(typeof entry.default).toBe('function')
		expect(entry.UpgradeScripts).toBe(UpgradeScripts)
		expect(Array.isArray(entry.UpgradeScripts)).toBe(true)
	})
})
