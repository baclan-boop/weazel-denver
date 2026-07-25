'use strict';
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const config = require('../config');
const { uploadBufferToCloudinary, shrinkImageIfNeeded } = require('../cloudinary');
const { requireNewsEdit } = require('../middleware/auth');

const router = express.Router();

// Файл принимаем в память (buffer), а не сразу на диск: так его можно
// отправить в Cloudinary. Если Cloudinary не настроен — пишем этот же
// buffer на диск сами (см. роут ниже).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, f, cb) => { if (!f.mimetype.startsWith('image/')) return cb(new Error('Только изображения')); cb(null, true); }
});

// UPLOAD
// Единая точка загрузки картинок для всего сайта: фоны страниц,
// аватарки участников состава ("Состав"), изображения новостей и т.д.
// Все они используют этот один роут — поэтому подключение Cloudinary
// здесь автоматически чинит проблему с потерей файлов при редеплое
// сразу везде, включая аватарки.
router.post('/upload', requireNewsEdit, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  try {
    if (config.CLOUDINARY_ENABLED) {
      const buf = await shrinkImageIfNeeded(req.file.buffer, req.file.mimetype);
      const result = await uploadBufferToCloudinary(buf);
      return res.json({ url: result.secure_url });
    }
    const ext = path.extname(req.file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg';
    const filename = uuid() + ext;
    fs.writeFileSync(path.join(config.UPLOADS_DIR, filename), req.file.buffer);
    return res.json({ url: `/uploads/${filename}` });
  } catch (e) {
    console.error('Ошибка загрузки файла:', e.message);
    return res.status(500).json({ error: 'Не удалось загрузить файл: ' + e.message });
  }
});

module.exports = router;
