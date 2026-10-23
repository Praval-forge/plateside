const { createApp } = require('./http');
const { getDb } = require('./db');

const health = async () => { const db = await getDb(); await db.query('select 1'); return { status: 'ok', db: db.kind }; };
const routes = [
  ['GET', '/health', health, { auth: false }],
  ...require('./routes/auth'),
  ...require('./routes/me'),
  ...require('./routes/meals'),
  ...require('./routes/coach'),
];
module.exports = createApp(routes);
