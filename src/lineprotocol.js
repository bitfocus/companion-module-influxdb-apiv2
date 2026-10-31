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

module.exports = { parseTags, buildLine, splitUnescaped }
