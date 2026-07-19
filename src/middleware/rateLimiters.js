'use strict';
const rateLimit = require('express-rate-limit');
const { hashIP } = require('../utils/helpers');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Слишком много попыток. Подождите 15 минут.' }, keyGenerator: r => hashIP(r.ip) });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { error: 'Слишком много запросов.' }, keyGenerator: r => hashIP(r.ip) });

module.exports = { loginLimiter, apiLimiter };
