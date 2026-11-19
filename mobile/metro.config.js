const {getDefaultConfig} = require("expo/metro-config")
const {withUniwindConfig} = require("uniwind/metro")

const config = getDefaultConfig(__dirname)
config.transformer.getTransformOptions = async () => ({transform: {inlineRequires: true}})

module.exports = withUniwindConfig(config, {cssEntryFile: "./src/global.css", dtsFile: "./src/uniwind-types.d.ts"})
