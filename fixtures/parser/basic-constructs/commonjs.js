const express = require("express");
const { readFile, writeFile: saveFile } = require("./fs-helpers.js");
require("./setup-side-effects.js");

function createServer() {
  return express();
}

module.exports = createServer;
module.exports.readFile = readFile;
exports.saveFile = saveFile;
