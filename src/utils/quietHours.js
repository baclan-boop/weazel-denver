/**
 * Weazel News — «тихие часы».
 *
 * С 01:00 до 12:00 по Москве сайт сам, без участия посетителей, не должен
 * ничего делать: ни пинговать себя (чтобы Render мог уснуть), ни ходить
 * в базу по таймерам (чтобы Neon мог уснуть и не тратил compute-часы).
 * Если в это время на сайт зашёл живой пользователь — всё работает как
 * обычно: Render просыпается, Neon просыпается на первом же запросе.
 *
 * Границы меняются константами ниже.
 */
'use strict';

const QUIET_FROM_HOUR = 1;   // включительно: с 01:00 МСК
const QUIET_TO_HOUR = 12;    // не включительно: до 12:00 МСК

function mskHour() {
  // Москва — UTC+3 без перехода на летнее время; берём час через Intl,
  // чтобы не зависеть от часового пояса сервера (на Render это UTC).
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
  }).format(new Date());
  return parseInt(h, 10) % 24;
}

function isQuietHours() {
  const h = mskHour();
  return h >= QUIET_FROM_HOUR && h < QUIET_TO_HOUR;
}

module.exports = { isQuietHours, QUIET_FROM_HOUR, QUIET_TO_HOUR };
