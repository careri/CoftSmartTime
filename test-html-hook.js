// Registers a Node.js require extension so .html files can be loaded as
// plain strings during tests (mirrors what esbuild does with --loader:.html=text).
const fs = require("fs");
require.extensions[".html"] = (mod, filename) => {
  mod.exports = fs.readFileSync(filename, "utf-8");
};
