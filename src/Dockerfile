FROM node:20-alpine

WORKDIR /app

# Устанавливаем зависимости по lock-файлу (npm ci) — версии транзитивных
# пакетов фиксированы, сборки воспроизводимы между деплоями.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Код сервера
COPY server.js ./
COPY src/ ./src/
COPY public/ ./public/

# UPLOADS_DIR (см. src/config.js) — это "./uploads" от корня проекта.
# Используется только как fallback, если Cloudinary не настроен (см.
# src/cloudinary.js) — сам по себе не переживает редеплой на Render/Fly,
# т.к. диск контейнера каждый раз создаётся заново.
RUN mkdir -p uploads

# Не запускаем процесс от root — на случай RCE в одной из зависимостей
# это ограничивает то, что атакующий сможет сделать внутри контейнера.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "server.js"]
