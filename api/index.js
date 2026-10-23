// Single serverless entry point. All routing lives in lib/ so it can also run in tests and the dev server.
module.exports = require('../lib/app');
