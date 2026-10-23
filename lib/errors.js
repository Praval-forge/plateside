class AppError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const bad = (m, d) => new AppError(400, 'bad_request', m, d);
const unauthorized = (m = 'Please sign in to continue.') => new AppError(401, 'unauthorized', m);
const forbidden = (m = 'You do not have access to that.') => new AppError(403, 'forbidden', m);
const notFound = (m = 'Not found.') => new AppError(404, 'not_found', m);
const conflict = (m) => new AppError(409, 'conflict', m);
const tooMany = (m = 'Too many requests. Please wait a bit and try again.') => new AppError(429, 'rate_limited', m);
module.exports = { AppError, bad, unauthorized, forbidden, notFound, conflict, tooMany };
