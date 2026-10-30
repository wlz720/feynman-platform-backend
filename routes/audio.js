const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const { transcribeAudio } = require('../controllers/baiduAiController');

//内存存储，音频只放内存中转，不写硬盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 //限制2MB，百度短语音最大60秒
  }
});

// POST /api/audio/transcribe
router.post('/transcribe', auth, upload.single('audio'), transcribeAudio);

module.exports = router;
