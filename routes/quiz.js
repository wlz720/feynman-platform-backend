const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');
const QuizAttempt = require('../models/QuizAttempt');
const { sendDbAwareError } = require('../middleware/dbGuard');

const QUIZ_TYPES = ['single-choice', 'short-answer'];
const QUIZ_DIFFICULTIES = ['基础', '中等', '困难'];
const OPTION_KEYS = ['A', 'B', 'C', 'D'];
const MAX_QUESTION_CHARS = 2000;
const MAX_ANSWER_CHARS = 5000;
const MAX_LIST_ITEMS = 8;

function readText(value, max, label) {
  if (typeof value !== 'string' || !value.trim()) return { error: `缺少${label}` };
  const text = value.trim();
  if (text.length > max) return { error: `${label}过长，请控制在 ${max} 字以内` };
  return { value: text };
}

function readStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS)
    .map((item) => item.slice(0, 500));
}

// 只保存当前用户自己的知识点下的作答记录
async function findOwnedKnowledgePoint(kpId, userId) {
  if (!mongoose.Types.ObjectId.isValid(kpId)) {
    return { error: { status: 400, msg: 'knowledgePointId 不合法' } };
  }
  const kp = await KnowledgePoint.findById(kpId);
  if (!kp) return { error: { status: 404, msg: '知识点不存在' } };
  if (kp.user?.toString() !== userId) {
    return { error: { status: 403, msg: '无权访问该知识点的测评记录' } };
  }
  return { kp };
}

router.post('/attempts', auth, async (req, res) => {
  try {
    const body = req.body || {};
    const found = await findOwnedKnowledgePoint(body.knowledgePointId, req.user.id);
    if (found.error) return res.status(found.error.status).json({ msg: found.error.msg });

    if (!QUIZ_TYPES.includes(body.type)) {
      return res.status(400).json({ msg: '题型不合法' });
    }
    if (!QUIZ_DIFFICULTIES.includes(body.difficulty)) {
      return res.status(400).json({ msg: '难度不合法' });
    }
    const question = readText(body.question, MAX_QUESTION_CHARS, '题目');
    if (question.error) return res.status(400).json({ msg: question.error });
    const studentAnswer = readText(body.studentAnswer, MAX_ANSWER_CHARS, '作答内容');
    if (studentAnswer.error) return res.status(400).json({ msg: studentAnswer.error });

    const attempt = {
      user: req.user.id,
      knowledgePoint: found.kp._id,
      type: body.type,
      difficulty: body.difficulty,
      question: question.value,
      studentAnswer: studentAnswer.value,
      explanation: typeof body.explanation === 'string' ? body.explanation.trim().slice(0, 2000) : ''
    };

    if (body.type === 'single-choice') {
      const rawOptions = body.options && typeof body.options === 'object' ? body.options : {};
      const options = {};
      for (const key of OPTION_KEYS) {
        const value = rawOptions[key];
        if (typeof value === 'string' && value.trim()) options[key] = value.trim().slice(0, 500);
      }
      if (Object.keys(options).length < OPTION_KEYS.length) {
        return res.status(400).json({ msg: '选项不完整，无法保存记录' });
      }
      const correctAnswer = String(body.correctAnswer || '').trim().toUpperCase();
      if (!options[correctAnswer]) {
        return res.status(400).json({ msg: '正确答案不合法' });
      }
      if (!options[studentAnswer.value.toUpperCase()]) {
        return res.status(400).json({ msg: '所选答案不合法' });
      }

      attempt.options = options;
      attempt.correctAnswer = correctAnswer;
      // 以服务端重新比较的结果为准，避免前端传入的 isCorrect 与选项不一致
      attempt.isCorrect = studentAnswer.value.toUpperCase() === correctAnswer;
      attempt.studentAnswer = studentAnswer.value.toUpperCase();
    } else {
      let score = null;
      if (body.score !== undefined && body.score !== null) {
        const parsed = Number(body.score);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          return res.status(400).json({ msg: '阅卷分数不合法' });
        }
        score = Math.round(parsed);
      }
      if (score === null && typeof body.isCorrect !== 'boolean') {
        return res.status(400).json({ msg: '缺少阅卷分数 score' });
      }
      attempt.answerKeyPoints = readStringList(body.answerKeyPoints);
      attempt.score = score;
      // 分数在服务端重新换算及格线，避免前端传入的 isCorrect 与分数冲突
      attempt.isCorrect = score === null ? body.isCorrect : score >= 60;
      attempt.feedback = {
        matchedPoints: readStringList(body.matchedPoints),
        beyondPoints: readStringList(body.beyondPoints),
        issues: readStringList(body.issues),
        explanation:
          typeof body.feedbackExplanation === 'string'
            ? body.feedbackExplanation.trim().slice(0, 2000)
            : ''
      };
    }

    const saved = await new QuizAttempt(attempt).save();
    return res.status(201).json(saved);
  } catch (err) {
    return sendDbAwareError(res, err, '保存测评记录失败');
  }
});

router.get('/attempts', auth, async (req, res) => {
  try {
    const found = await findOwnedKnowledgePoint(req.query.knowledgePointId, req.user.id);
    if (found.error) return res.status(found.error.status).json({ msg: found.error.msg });

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const filter = { user: req.user.id, knowledgePoint: found.kp._id };
    if (req.query.onlyWrong === 'true') filter.isCorrect = false;

    const [attempts, total, wrongCount] = await Promise.all([
      QuizAttempt.find(filter).sort({ createdAt: -1 }).limit(limit),
      QuizAttempt.countDocuments({ user: req.user.id, knowledgePoint: found.kp._id }),
      QuizAttempt.countDocuments({ user: req.user.id, knowledgePoint: found.kp._id, isCorrect: false })
    ]);

    return res.json({ attempts, total, wrongCount });
  } catch (err) {
    return sendDbAwareError(res, err, '获取测评记录失败');
  }
});

module.exports = router;
