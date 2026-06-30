# ИНСТРУКЦИЯ: Публикация Weazel News (Render + Neon)
# Карта не нужна. Всё бесплатно.

## ЧТО ПОНАДОБИТСЯ
1. Аккаунт GitHub (бесплатно) — github.com
2. Аккаунт Neon (база данных) — neon.tech
3. Аккаунт Render (хостинг) — render.com
Всё регистрируется через Google — без карты.

=========================================
ШАГ 1: ЗАГРУЗИТЬ КОД НА GITHUB
=========================================

1. Зайди на github.com → [Sign up] → войди через Google

2. Нажми [+] (верхний правый угол) → [New repository]
   - Repository name: weazel-news
   - Выбери: Private
   - Нажми [Create repository]

3. Установи Git для Windows:
   https://git-scm.com/download/win
   (установи с настройками по умолчанию)

4. Распакуй архив weazel-server.zip, например в:
   C:\weazel-news\

5. Открой командную строку (Win+R → cmd → Enter):

   cd C:\weazel-news
   git init
   git add .
   git commit -m "first commit"
   git branch -M main
   git remote add origin https://github.com/ТВОЙ_НИК/weazel-news.git
   git push -u origin main

   Замени ТВОЙ_НИК на свой никнейм GitHub.
   GitHub попросит войти — нажми разрешить в браузере.

6. Обнови страницу github.com/ТВОЙ_НИК/weazel-news
   Ты должен увидеть файлы: server.js, package.json, папку public.

=========================================
ШАГ 2: СОЗДАТЬ БАЗУ ДАННЫХ НА NEON
=========================================

1. Зайди на neon.tech → [Sign up] → [Continue with Google]
   Карта не нужна.

2. Нажми [Create a project]
   - Project name: weazel-news
   - Database name: weazel
   - Region: Europe West (Frankfurt)
   - Нажми [Create project]

3. Появится окно. Нажми вкладку [Connection string]
   Выбери: Node.js

4. Скопируй строку вида:
   postgresql://weazel_owner:XXXXX@ep-xxx.eu-central-1.aws.neon.tech/weazel?sslmode=require

   СОХРАНИ ЭТУ СТРОКУ — понадобится на шаге 3!

=========================================
ШАГ 3: ОПУБЛИКОВАТЬ САЙТ НА RENDER
=========================================

1. Зайди на render.com → [Get Started for Free]
   → [Continue with GitHub] → разреши доступ
   Карта не нужна.

2. Нажми [New +] → [Web Service]

3. Найди репозиторий weazel-news → нажми [Connect]

4. Заполни настройки:
   Name:           weazel-news
   Region:         Frankfurt (EU Central)
   Branch:         main
   Runtime:        Node
   Build Command:  npm install
   Start Command:  node server.js
   Plan:           Free  ← ОБЯЗАТЕЛЬНО выбери Free!

5. Прокрути вниз до [Environment Variables]
   Нажми [Add Environment Variable] для каждой:

   KEY               | VALUE
   ------------------|--------------------------------------------
   DATABASE_URL      | (строка из Neon, начинается с postgresql://)
   SESSION_SECRET    | weazel_secret_majestic_rp_2024_xk7jQp9mNv
   ADMIN_EMAIL       | computer52552@gmail.com
   ADMIN_PASSWORD    | 098456964
   ADMIN_NAME        | degrees
   NODE_ENV          | production

6. Нажми [Create Web Service]

7. Подожди 2-5 минут. В логах появится:
   "Weazel News: http://0.0.0.0:3000"
   — сайт готов!

8. Вверху страницы будет ссылка:
   https://weazel-news-xxxx.onrender.com

   Открой её и войди:
   Почта:  computer52552@gmail.com
   Пароль: 098456964

=========================================
ШАГ 4: ДОБАВИТЬ ДОМЕН (бесплатно)
=========================================

--- ВАРИАНТ А: Бесплатный домен weazelnews.js.org ---

1. Зайди на github.com/js-org/js.org
2. Нажми [Fork]
3. В своём форке открой файл: cnames_active.js
4. Нажми иконку карандаша (редактировать)
5. Добавь строку в алфавитном порядке:
   "weazelnews": "weazel-news-xxxx.onrender.com",
   (замени xxxx на свой реальный адрес Render)
6. Нажми [Commit changes]
7. Нажми [Contribute] → [Open pull request] → [Create pull request]
8. Подожди 1-2 дня — одобрят автоматически.
9. Сайт будет: https://weazelnews.js.org

--- ВАРИАНТ Б: Если уже есть свой домен (.ru, .com и т.д.) ---

1. На Render: Settings → Custom Domains → Add Custom Domain
2. Введи свой домен, например: weazelnews.ru
3. Render покажет CNAME:
   weazelnews.ru → weazel-news-xxxx.onrender.com
4. У своего регистратора (reg.ru, nic.ru и др.)
   в настройках DNS добавь:
   Type:  CNAME
   Name:  @
   Value: weazel-news-xxxx.onrender.com
5. Подожди до 24 часов.
6. HTTPS включится автоматически.

=========================================
ШАГ 5: КАК ОБНОВИТЬ САЙТ
=========================================

Если хочешь обновить файлы:

1. Замени файл в папке C:\weazel-news\
2. Открой командную строку:
   cd C:\weazel-news
   git add .
   git commit -m "обновление"
   git push

3. Render автоматически обновит сайт (1-3 минуты)

=========================================
ВОЗМОЖНЫЕ ПРОБЛЕМЫ
=========================================

Сайт не отвечает 30-60 секунд при первом заходе
→ Нормально! Бесплатный Render засыпает после 15 мин
  неактивности. Первый посетитель его разбудит.

"ОШИБКА: DATABASE_URL не задан"
→ Проверь Environment Variables на Render.
  Строка должна начинаться с postgresql://

Забыл пароль администратора
→ На Neon: SQL Editor → выполни:
  DELETE FROM users WHERE email='computer52552@gmail.com';
  → Перезапусти сервис на Render — admin создастся заново.

=========================================
БЕЗОПАСНОСТЬ
=========================================
✓ Пароли — bcrypt (невозможно восстановить)
✓ Сессии — httpOnly cookie, только HTTPS
✓ Брутфорс — блокировка после 10 попыток
✓ SQL инъекции — параметризованные запросы
✓ Роли — проверяются на сервере
✓ HTTPS — автоматически через Let's Encrypt
