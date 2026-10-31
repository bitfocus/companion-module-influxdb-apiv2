import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	ignores: ['pkg/**'],
})

export default [
	...baseConfig,
	{
		files: ['test/**/*.mjs', 'src/**/*.mjs'],
		languageOptions: { sourceType: 'module' },
		rules: { 'n/no-unpublished-import': 'off' },
	},
]
