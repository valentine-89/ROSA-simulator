const path = require("node:path");
module.exports = function dependency(name) {
  const cache = process.env.ROSA_SIMULATOR_NODE_MODULES;
  return cache ? require(path.join(cache, name)) : require(name);
};
