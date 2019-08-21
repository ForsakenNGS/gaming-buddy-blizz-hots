const path = require('path');

module.exports.frontend = require( path.resolve(__dirname, "src", "frontend.js") );
module.exports.backend = require( path.resolve(__dirname, "src", "backend.js") );