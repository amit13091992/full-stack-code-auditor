const { greet } = require("./helper.js");

function run() {
  return greet("world");
}

module.exports = { run };
