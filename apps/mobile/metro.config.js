// Expo's default config detects the pnpm workspace root and watches it, so
// the shared @erp/client package resolves from the hoisted node_modules.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
