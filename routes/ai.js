const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { requireDb } = require('../middleware/dbGuard');
const { generateQuestion, gradeAnswer, answerWithRAG, reindexUserStore } = require('../controllers/baiduAiController');

// 出题与阅卷只调用大模型，不读写数据库，所以不挂 requireDb
router.post('/generate-question', auth, generateQuestion);
router.post('/grade-answer', auth, gradeAnswer);
// 课时11：RAG 问答（检索本地向量库 + 大模型生成，同样不依赖 MongoDB）
router.post('/rag-qa', auth, answerWithRAG);
// 重建当前用户的向量索引（需要读数据库里的知识点）
router.post('/reindex', auth, requireDb, reindexUserStore);

module.exports = router;
