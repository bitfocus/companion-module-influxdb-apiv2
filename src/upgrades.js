/*
 * Upgrade scripts run in order and Companion remembers how far each connection has got.
 * Once a script has been released it must never be removed or reordered, only appended to.
 */

/**
 * v2.0.0: the API token moved from the config into the secrets store.
 * @type {import('@companion-module/base').CompanionStaticUpgradeScript<any, any>}
 */
function moveTokenToSecrets(_context, props) {
	const result = {
		updatedConfig: null,
		updatedSecrets: null,
		updatedActions: [],
		updatedFeedbacks: [],
	}

	const config = props.config
	if (config && 'token' in config) {
		const { token, ...rest } = config
		result.updatedConfig = rest
		if (token && !props.secrets?.token) {
			result.updatedSecrets = { ...(props.secrets ?? {}), token }
		}
	}

	return result
}

module.exports = [moveTokenToSecrets]
