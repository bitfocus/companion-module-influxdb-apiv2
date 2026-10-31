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

/** Remove the escapes users may type (`\,` `\=` `\ ` `\\`); other backslashes are kept, eg `C:\temp` */
function unescape(str) {
	return str.replace(/\\([,= \\])/g, '$1')
}

/** Trim whitespace, but keep a trailing space that is escaped with a backslash */
function trimUnescaped(str) {
	const s = str.replace(/^\s+/, '')
	let end = s.length
	while (end > 0 && /\s/.test(s[end - 1])) {
		let backslashes = 0
		for (let i = end - 2; i >= 0 && s[i] === '\\'; i--) backslashes++
		if (backslashes % 2 === 1) break
		end--
	}
	return s.slice(0, end)
}

/** Read a tag key, tag value or field name as typed: trim, then remove escapes */
function readName(raw) {
	return unescape(trimUnescaped(raw))
}

/**
 * The InfluxDB client escapes commas, equals signs and spaces but not backslashes, so a literal
 * backslash right before one of those (or at the very end) would swallow the separator.
 * @param {string} name a measurement, tag key or value, or field name, after unescaping
 * @returns {string | undefined} why the name can't be written, if it can't
 */
function nameProblem(name) {
	if (/\\([,= ]|$)/.test(name)) {
		return 'a backslash cannot be the last character or come right before a comma, equals sign or space'
	}
	return undefined
}

/**
 * Parse a `key=value,key2=value2` tag string.
 * Whitespace around keys and values is trimmed, empty entries are skipped, and
 * values may contain `=`. `\,` `\=` `\ ` and `\\` are escapes for a comma, equals sign, space and backslash.
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
		const key = readName(rawKey)
		const value = rawValue === undefined ? '' : readName(rawValue)

		if (key === '' || value === '') {
			errors.push(`Ignoring malformed tag "${entry.trim()}" (expected key=value)`)
			continue
		}
		const problem = nameProblem(key) ?? nameProblem(value)
		if (problem) {
			errors.push(`Ignoring tag "${entry.trim()}": ${problem}`)
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

const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n
const UINT64_MAX = 2n ** 64n - 1n

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
		const key = readName(rawKey)
		const value = (rawValue ?? '').trim()
		if (!key || value === '') {
			errors.push(`Malformed field "${entry.trim()}" (expected key=value)`)
			continue
		}
		const problem = nameProblem(key)
		if (problem) {
			errors.push(`Ignoring field "${entry.trim()}": ${problem}`)
			continue
		}

		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
			fields.push({ key, type: 'string', value: value.slice(1, -1).replace(/\\(["\\])/g, '$1') })
		} else if (/^[+-]?\d+i$/.test(value)) {
			const n = BigInt(value.slice(0, -1))
			if (n < INT64_MIN || n > INT64_MAX) errors.push(`Field "${key}" is outside the 64-bit integer range`)
			else fields.push({ key, type: 'int', value: value.slice(0, -1) })
		} else if (/^\d+u$/.test(value)) {
			if (BigInt(value.slice(0, -1)) > UINT64_MAX) errors.push(`Field "${key}" is outside the 64-bit unsigned range`)
			else fields.push({ key, type: 'uint', value: value.slice(0, -1) })
		} else if (BOOL_TRUE.includes(value) || BOOL_FALSE.includes(value)) {
			fields.push({ key, type: 'bool', value: BOOL_TRUE.includes(value) })
		} else if (FLOAT_RE.test(value)) {
			const n = Number(value)
			if (Number.isFinite(n)) fields.push({ key, type: 'float', value: n })
			else errors.push(`Field "${key}" is too large for a float`)
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

	// Only ISO style dates: Date.parse also accepts things like "12.5" or "Monday 5",
	// and rolls impossible days over (2026-02-31 becomes 3 March)
	const invalid = new Error(`"${str}" is not a timestamp or a date like 2026-10-31T09:00:00Z`)
	const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(str)
	if (!date) throw invalid
	const [year, month, day] = date.slice(1).map(Number)
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth) throw invalid
	const ms = Date.parse(str)
	if (Number.isNaN(ms)) throw invalid
	return (BigInt(ms) * PRECISION_TO_NS.ms).toString()
}

module.exports = { parseTags, parseFields, parseTimestamp, buildLine, splitUnescaped, nameProblem }
