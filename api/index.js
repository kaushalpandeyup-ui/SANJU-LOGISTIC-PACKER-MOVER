// Vercel serverless wrapper
// Imports the server module which, when running on Vercel, exports a handler
// The server.js file initializes asynchronously; this wrapper simply forwards requests.

const handler = require('../server.js');

module.exports = (req, res) => {
  // handler may be a function that returns a promise (async); ensure we handle it
  try {
    const maybePromise = handler(req, res);
    if (maybePromise && typeof maybePromise.then === 'function') return maybePromise;
    return undefined;
  } catch (e) {
    console.error('api/index wrapper error', e && (e.stack || e));
    try { res.statusCode = 500; res.end('Internal server error'); } catch(_) {}
  }
};
