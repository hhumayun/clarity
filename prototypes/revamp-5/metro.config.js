const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");

const config = getDefaultConfig(__dirname);

// The default cache lives in /tmp, which is RAM on this machine.
config.cacheStores = [new FileStore({ root: path.join(__dirname, ".metro-cache") })];

module.exports = config;
