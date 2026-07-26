/**
 * WEAZEL NEWS — реверс-прокси на Cloudflare Workers (бесплатно)
 * ═══════════════════════════════════════════════════════════════════
 * Что делает: пользователь заходит на ваш адрес *.workers.dev (сеть
 * Cloudflare), воркер прозрачно пересылает запрос на настоящий Render,
 * получает ответ и отдаёт его пользователю как есть. Для браузера это
 * выглядит как ОДИН сайт на ОДНОМ домене — ни кук, ни CORS не ломает,
 * потому что и HTML, и /api/* идут через один и тот же workers.dev.
 *
 * КУДА ВСТАВИТЬ: Cloudflare Dashboard → Workers & Pages → Create →
 * Create Worker → вставить этот код целиком вместо примера → Deploy.
 *
 * НЕ ЗАБУДЬТЕ поменять ORIGIN ниже на ваш настоящий адрес Render.
 * ═══════════════════════════════════════════════════════════════════
 */

// Ваш настоящий адрес на Render (без / на конце).
const ORIGIN = 'https://wn-dn.onrender.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = ORIGIN + url.pathname + url.search;

    const proxyHeaders = new Headers(request.headers);
    // Host должен указывать на Render, а не на сам воркер — иначе Render
    // не поймёт, какой сайт запрашивают (хотя у вас на одном сервисе
    // всего один сайт, это всё равно правильная практика для прокси).
    proxyHeaders.delete('host');

    // ВАЖНО ДЛЯ РЕЙТ-ЛИМИТЕРА И СТАТИСТИКИ ПОСЕЩЕНИЙ:
    // Cloudflare сама подставляет заголовок CF-Connecting-IP с настоящим
    // IP посетителя на границе своей сети — его невозможно подделать
    // клиенту. Пробрасываем именно его как X-Forwarded-For, иначе на
    // сервере все запросы через воркер будут выглядеть так, будто они
    // пришли с одного и того же IP (самого воркера), и антиспам-лимит
    // (600 запросов/мин, см. src/middleware/rateLimiters.js) будет
    // делиться на ВСЕХ пользователей сразу, а не на каждого отдельно.
    const realIP = request.headers.get('cf-connecting-ip');
    if (realIP) proxyHeaders.set('x-forwarded-for', realIP);

    const hasBody = !['GET', 'HEAD'].includes(request.method);
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: hasBody ? request.body : undefined,
      // duplex: 'half' обязателен спецификацией fetch, когда body — поток
      // (а не строка/буфер целиком) — без этого браузерный/воркерный
      // fetch кидает ошибку на ЛЮБОМ запросе с телом (логин, создание
      // новости, загрузка файлов и т.д.).
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual', // на сайте нет серверных редиректов — просто отдаём ответ как есть
    });

    const originResponse = await fetch(proxyRequest);

    // Ответ (включая Set-Cookie для сессий, Cache-Control для картинок
    // и т.д.) пробрасываем без изменений.
    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: originResponse.headers,
    });
  },
};
