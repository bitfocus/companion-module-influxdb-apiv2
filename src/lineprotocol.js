/**
 * Split a string on a separator character, ignoring separators escaped with a backslash.
 * Escape sequences are kept so a later split can still see them.
 * @param {string} str
 * @param {string} sep single character
 * @param {number} [limit] maximum number of parts (the last part holds the remainder)
 * @returns {string[]}
 */
function splitUnescaped(str, sep, limit = Infinity) {
	const parts = []
	let current = ''
	for (let i = 0; i < str.length; i++) {
		const ch = str[i]
		if (ch === '\\' && i + 1 < str.length) {
			current += ch + str[i + 1]
			i++
		} else if (ch === sep && parts.length < limit - 1) {
			parts.push(current)
			current = ''
		} else {
			current += ch
		}
	}
	parts.push(current)
	return parts
}

/** Remove backslash escapes, eg `a\,b` -> `a,b` */
function unescape(str) {
	return str.replace(/\\(.)/g, '$1')
}

/**
 * Parse a `key=value,key2=value2` tag string.
 * Whitespace around keys and values is trimmed, empty entries are skipped, and
 * values may contain `=`. A literal `,` or `=` can be written as `\,` or `\=`.
 * @param {string | undefined} input
 * @returns {{ tags: Record<string, string>, errors: string[] }}
 */
function parseTags(input) {
	/** @type {Record<string, string>} */
	const tags = {}
	const errors = []

	for (const entry of splitUnescaped(String(input ?? ''), ',')) {
		if (entry.trim() === '') continue

		const [rawKey, rawValue] = splitUnescaped(entry, '=', 2)
		const key = unescape(rawKey.trim())
		const value = rawValue === undefined ? '' : unescape(rawValue.trim())

		if (key === '' || value === '') {
			errors.push(`Ignoring malformed tag "${entry.trim()}" (expected key=value)`)
			continue
		}
		tags[key] = value
	}

	return { tags, errors }
}

/**
 * Build one line of line protocol from pre-formatted parts, as typed by the user.
 * Tags and fields are passed through as-is, so the user is responsible for escaping.
 * @param {string} measurement
 * @param {string} tags comma separated key=value pairs, may be empty
 * @param {string} fields comma separated key=value pairs
 * @param {string} [timestamp]
 * @returns {string}
 */
function buildLine(measurement, tags, fields, timestamp) {
	measurement = String(measurement ?? '').trim()
	tags = splitUnescaped(String(tags ?? '').trim(), ',')
		.map((t) => t.trim())
		.filter((t) => t !== '')
		.join(',')
	fields = String(fields ?? '').trim()

	if (measurement === '') throw new Error('Measurement is required')
	if (fields === '') throw new Error('At least one field is required')

	let line = tags ? `${measurement},${tags} ${fields}` : `${measurement} ${fields}`
	if (timestamp) line += ` ${timestamp}`
	return line
}

/**
 * Split on a separator that is neither escaped nor inside double quotes.
 * @param {string} str
 * @param {string} sep single character
 * @param {number} [limit]
 * @returns {string[]}
 */
function splitOutsideQuotes(str, sep, limit = Infinity) {
	const parts = []
	let current = ''
	let inQuotes = false
	for (let i = 0; i < str.length; i++) {
		const ch = str[i]
		if (ch === '\\' && i + 1 < str.length) {
			current += ch + str[i + 1]
			i++
		} else if (ch === '"') {
			inQuotes = !inQuotes
			current += ch
		} else if (ch === sep && !inQuotes && parts.length < limit - 1) {
			parts.push(current)
			current = ''
		} else {
			current += ch
		}
	}
	parts.push(current)
	return parts
}

const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const BOOL_TRUE = ['t', 'T', 'true', 'True', 'TRUE']
const BOOL_FALSE = ['f', 'F', 'false', 'False', 'FALSE']

/**
 * @typedef {{ key: string, type: 'float' | 'int' | 'uint' | 'bool' | 'string', value: number | string | boolean }} ParsedField
 */

/**
 * Parse a field set written like line protocol, eg `temp=21.5, count=3i, total=7u, ok=true, note="hi, there"`.
 * The type comes from the value's syntax: a plain number is a float, `i`/`u` suffixes are integers,
 * true/false are booleans and double quoted values are strings (with `\"` and `\\` escapes).
 * @param {string | undefined} input
 * @returns {{ fields: ParsedField[], errors: string[] }}
 */
function parseFields(input) {
	/** @type {ParsedField[]} */
	const fields = []
	const errors = []

	for (const entry of splitOutsideQuotes(String(input ?? ''), ',')) {
		if (entry.trim() === '') continue

		const [rawKey, rawValue] = splitOutsideQuotes(entry, '=', 2)
		const key = unescape(rawKey.trim())
		const value = (rawValue ?? '').trim()
		if (!key || value === '') {
			errors.push(`Malformed field "${entry.trim()}" (expected key=value)`)
			continue
		}

		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
			fields.push({ key, type: 'string', value: value.slice(1, -1).replace(/\\(["\\])/g, '$1') })
		} else if (/^[+-]?\d+i$/.test(value)) {
			fields.push({ key, type: 'int', value: value.slice(0, -1) })
		} else if (/^\d+u$/.test(value)) {
			fields.push({ key, type: 'uint', value: value.slice(0, -1) })
		} else if (BOOL_TRUE.includes(value) || BOOL_FALSE.includes(value)) {
			fields.push({ key, type: 'bool', value: BOOL_TRUE.includes(value) })
		} else if (FLOAT_RE.test(value)) {
			fields.push({ key, type: 'float', value: Number(value) })
		} else {
			errors.push(
				`Field "${key}" has value ${value}: use a number, an integer like 3i or 3u, true/false, or "quoted text"`,
			)
		}
	}

	return { fields, errors }
}

const PRECISION_TO_NS = { ns: 1n, us: 1000n, ms: 1000000n, s: 1000000000n }

/**
 * Convert a user supplied timestamp to a nanosecond timestamp string.
 * Accepts an integer in the given precision (eg a Unix time in ms) or a date string like 2026-10-31T09:00:00Z.
 * @param {string | number | undefined} input
 * @param {'ns' | 'us' | 'ms' | 's'} precision
 * @returns {string | undefined} undefined when no timestamp was given
 */
function parseTimestamp(input, precision = 'ms') {
	const str = String(input ?? '').trim()
	if (str === '') return undefined

	if (/^-?\d+$/.test(str)) {
		const factor = PRECISION_TO_NS[precision]
		if (!factor) throw new Error(`Unknown precision "${precision}"`)
		return (BigInt(str) * factor).toString()
	}

	const ms = Date.parse(str)
	if (Number.isNaN(ms)) throw new Error(`"${str}" is not a timestamp or date`)
	return (BigInt(ms) * PRECISION_TO_NS.ms).toString()
}

module.exports = { parseTags, parseFields, parseTimestamp, buildLine, splitUnescaped }
