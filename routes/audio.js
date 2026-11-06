const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const { transcribeAudio, evaluateFeynmanAttempt } = require('../controllers/baiduAiController');

//内存存储，音频只放内存中转，不写硬盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 //限制2MB，百度短语音最大60秒
  }
});

// POST /api/audio/transcribe
router.post('/transcribe', auth, upload.single('audio'), transcribeAudio);

// POST /api/audio/evaluate  AI 润色 + 评价打分
router.post('/evaluate', auth, evaluateFeynmanAttempt);

module.exports = router;
