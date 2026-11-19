const mongoose = require('mongoose');

// 简答题的阅卷结论按「符合知识点 / 正确但知识点未涵盖 / 待修正」三组存，
// 复习时能直接看出哪部分超纲但没错、哪部分需要回去补。
const QuizFeedbackSchema = new mongoose.Schema({
  matchedPoints: { type: [String], default: [] },
  beyondPoints: { type: [String], default: [] },
  issues: { type: [String], default: [] },
  explanation: { type: String, default: '' }
}, { _id: false });

const QuizAttemptSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  knowledgePoint: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KnowledgePoint',
    required: true
  },
  type: {
    type: String,
    enum: ['single-choice', 'short-answer'],
    required: true
  },
  difficulty: {
    type: String,
    enum: ['基础', '中等', '困难'],
    required: true
  },
  question: {
    type: String,
    required: true
  },
  // 单选题目快照，简答题为 null
  options: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  correctAnswer: {
    type: String,
    default: ''
  },
  answerKeyPoints: {
    type: [String],
    default: []
  },
  // 出题时模型给出的题目解析
  explanation: {
    type: String,
    default: ''
  },
  studentAnswer: {
    type: String,
    required: true
  },
  isCorrect: {
    type: Boolean,
    required: true
  },
  // 仅简答题有阅卷分数（0-100），单选题为 null
  score: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  // 仅简答题有阅卷结论
  feedback: {
    type: QuizFeedbackSchema,
    default: null
  }
}, { timestamps: true });

QuizAttemptSchema.index({ user: 1, knowledgePoint: 1, createdAt: -1 });

module.exports = mongoose.model('QuizAttempt', QuizAttemptSchema);
