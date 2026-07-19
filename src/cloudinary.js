/**
 * CLOUDINARY: постоянное хранилище для загруженных картинок.
 * Render/Fly пересоздают диск контейнера при каждом деплое — всё, что
 * сохранено локально в UPLOADS_DIR, пропадает. Поэтому все загрузки
 * (фоны страниц, аватарки участников состава, картинки новостей) уходят
 * в Cloudinary — облако, независимое от деплоя сайта.
 * Нужны 3 переменные окружения: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 * CLOUDINARY_API_SECRET (см. Dashboard → Product Environment Credentials
 * на cloudinary.com). Если их нет — сайт продолжит работать, но упадёт
 * обратно на локальный диск (только для локальной разработки: на проде
 * без этих переменных загруженные файлы будут теряться при редеплое).
 */
'use strict';
const cloudinary = require('cloudinary').v2;
const config = require('./config');

// sharp используется ТОЛЬКО для необязательного сжатия картинок перед
// загрузкой в Cloudinary (см. shrinkImageIfNeeded ниже). Грузим его
// защищённо: если на конкретной платформе/архитектуре не нашлось
// подходящего нативного бинарника и require бросает исключение — сайт
// всё равно должен подняться и работать, просто без автосжатия (файлы
// больше 10 МБ в этом случае будут отклоняться Cloudinary как раньше).
let sharp = null;
try { sharp = require('sharp'); }
catch (e) { console.warn('ВНИМАНИЕ: модуль sharp не загрузился — автосжатие изображений перед Cloudinary отключено:', e.message); }

if (config.CLOUDINARY_ENABLED) {
  cloudinary.config({
    cloud_name: config.CLOUDINARY_CLOUD_NAME,
    api_key: config.CLOUDINARY_API_KEY,
    api_secret: config.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log('Cloudinary подключён — загруженные файлы переживут редеплой');
} else {
  console.warn('ВНИМАНИЕ: Cloudinary не настроен (нет CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET). Загруженные через сайт картинки (фоны, аватарки, изображения новостей) будут теряться при каждом редеплое!');
}

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'weazel-news', resource_type: 'image' },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    stream.end(buffer);
  });
}

// Бесплатный план Cloudinary принимает картинку не тяжелее 10 МБ
// (10 485 760 байт) — а фото с телефона/скриншоты часто крупнее. Чтобы
// загрузка не падала с «File size too large», перед отправкой в Cloudinary
// пережимаем файл: сначала аккуратно уменьшаем разрешение, если оно
// избыточно для сайта, затем при необходимости постепенно снижаем
// качество/разрешение ещё, пока не впишемся в лимит (максимум 6 попыток).
// GIF не трогаем вообще — пересжатие сломало бы анимацию.
const CLOUDINARY_MAX_BYTES = 9.5 * 1024 * 1024; // небольшой запас под лимит в 10 МБ
async function shrinkImageIfNeeded(buffer, mimetype) {
  if (!sharp || buffer.length <= CLOUDINARY_MAX_BYTES || mimetype === 'image/gif') return buffer;
  try {
    const meta = await sharp(buffer).metadata();
    const format = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg';
    let width = meta.width || 2600;
    let quality = 85;
    let out = buffer;
    for (let i = 0; i < 6; i++) {
      let pipeline = sharp(buffer, { failOn: 'none' }).rotate(); // rotate() без аргументов — учитывает EXIF-ориентацию
      if (width < (meta.width || width)) pipeline = pipeline.resize({ width, withoutEnlargement: true });
      if (format === 'png') out = await pipeline.png({ quality, compressionLevel: 9, palette: true }).toBuffer();
      else if (format === 'webp') out = await pipeline.webp({ quality }).toBuffer();
      else out = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.length <= CLOUDINARY_MAX_BYTES) break;
      quality = Math.max(40, quality - 12);
      width = Math.round(width * 0.85);
    }
    return out.length < buffer.length ? out : buffer;
  } catch (e) {
    console.error('Не удалось сжать изображение перед загрузкой в Cloudinary:', e.message);
    return buffer; // не получилось сжать — пробуем отправить как есть
  }
}

module.exports = { uploadBufferToCloudinary, shrinkImageIfNeeded };
