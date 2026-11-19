const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateQuestion, gradeAnswer, answerWithRAG } = require('../controllers/baiduAiController');

// 出题与阅卷只调用大模型，不读写数据库，所以不挂 requireDb
router.post('/generate-question', auth, generateQuestion);
router.post('/grade-answer', auth, gradeAnswer);
// 课时11：RAG 问答（检索本地向量库 + 大模型生成，同样不依赖 MongoDB）
router.post('/rag-qa', auth, answerWithRAG);

module.exports = router;
