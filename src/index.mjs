// Companion imports the entrypoint as ESM and reads `default` and the named `UpgradeScripts`.
// The bundled build only exposes a CommonJS module as `default`, so re-export both names here.
import InfluxInstance from './main.js'
import UpgradeScripts from './upgrades.js'

export { UpgradeScripts }
export default InfluxInstance
