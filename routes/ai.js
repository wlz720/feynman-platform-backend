const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateQuestion, gradeAnswer } = require('../controllers/baiduAiController');

// 出题与阅卷只调用大模型，不读写数据库，所以不挂 requireDb
router.post('/generate-question', auth, generateQuestion);
router.post('/grade-answer', auth, gradeAnswer);

module.exports = router;
