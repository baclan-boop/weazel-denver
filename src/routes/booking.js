'use strict';
const express = require('express');
const config = require('../config');
const { requireAdvertising } = require('../middleware/auth');

const router = express.Router();

// ─── GOOGLE APPS SCRIPT: поиск свободных слотов для объявлений ──────────────
// Вся логика поиска слотов живёт в скрипте ВНУТРИ самой Google Таблицы
// (Расширения → Apps Script), развёрнутом как веб-приложение.
// Наш сервер — просто прокси: получает запрос от сайта, пересылает
// в Apps Script, возвращает ответ. Настраивается ОДНОЙ переменной:
//   GOOGLE_APPS_SCRIPT_URL — ссылка вида https://script.google.com/macros/s/.../exec
// Полный код скрипта и инструкция — см. google-apps-script/Code.gs и README.md

router.post('/booking/search', requireAdvertising, async (req, res) => {
  try {
    const scriptUrl = config.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.status(503).json({ error: 'Google Таблица не подключена. Обратитесь к администратору сайта — нужно указать переменную GOOGLE_APPS_SCRIPT_URL.' });
    }

    let { color, days, adsPerDay } = req.body;
    color = color === 'red' ? 'red' : 'green';
    days = Math.max(2, Math.min(7, parseInt(days, 10) || 2));
    adsPerDay = Math.max(2, Math.min(10, parseInt(adsPerDay, 10) || 2));

    const url = `${scriptUrl}?color=${encodeURIComponent(color)}&days=${days}&adsPerDay=${adsPerDay}`;
    const resp = await fetch(url, { redirect: 'follow' });
    const rawText = await resp.text();

    // Apps Script при неверных настройках доступа ("Who has access")
    // может вернуть HTML-страницу входа Google вместо JSON. Ловим это явно,
    // а не даём упасть в невнятный SyntaxError.
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      const looksLikeGoogleLogin = /accounts\.google\.com|ServiceLogin|<html/i.test(rawText);
      const hint = looksLikeGoogleLogin
        ? 'Похоже, Google вернул страницу входа вместо данных. Проверь в настройках развёртывания Apps Script: "Who has access" / "У кого есть доступ" должно быть "Anyone" / "Все", а не "Only myself".'
        : 'Ответ Apps Script не является JSON.';
      console.error('Ads search: non-JSON response from Apps Script. Status:', resp.status, 'Snippet:', rawText.slice(0, 300));
      return res.status(502).json({ error: `Google Apps Script вернул некорректный ответ (код ${resp.status}). ${hint}` });
    }

    if (!resp.ok) {
      return res.status(502).json({ error: data.error || `Google Apps Script вернул ошибку (код ${resp.status}).` });
    }
    if (data.error) return res.status(502).json({ error: data.error });

    res.json(data);
  } catch (e) {
    console.error('Ads search error:', e.message);
    res.status(500).json({ error: 'Не удалось связаться с Google Apps Script: ' + e.message });
  }
});

module.exports = router;
