'use strict';
const rateLimit = require('express-rate-limit');
const { hashIP } = require('../utils/helpers');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Слишком много попыток. Подождите 15 минут.' }, keyGenerator: r => hashIP(r.ip) });
// max поднят с 200 до 600: лимит считается по IP, а провайдеры (особенно
// мобильные операторы в РФ) очень часто пускают тысячи РАЗНЫХ реальных
// посетителей через один и тот же публичный IP (CGNAT) — старый лимит
// в 200 запросов/мин на такой общий IP исчерпывался обычным трафиком
// нескольких ничем не связанных людей, и они получали "Слишком много
// запросов"/обрывы, хотя лично никто из них лимит не превышал. Это не
// защита от взлома (для неё есть отдельный loginLimiter выше) — здесь
// это просто грубая защита от накрутки/спама, ей есть куда быть щедрее.
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, message: { error: 'Слишком много запросов.' }, keyGenerator: r => hashIP(r.ip) });

module.exports = { loginLimiter, apiLimiter };
