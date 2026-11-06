const mongoose = require('mongoose');

// 最近一次费曼复述的评价快照，详情页直接读这里，不再回查模型
const AttemptSchema = new mongoose.Schema({
  transcribedText: { type: String, default: '' },
  polishedText: { type: String, default: '' },
  evaluation: { type: String, default: '' },
  strengths: { type: [String], default: [] },
  weaknesses: { type: [String], default: [] },
  score: { type: Number, default: null },
  createdAt: { type: Date, default: null }
}, { _id: false });

const KnowledgePointSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: true,
    maxlength: 100000
  },
  status: {
    type: String,
    enum: ['not_started', 'need_review', 'mastered'],
    default: 'not_started'
  },
  reviewList: {
    type: Boolean,
    default: false
  },
  lastAttempt: {
    type: AttemptSchema,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('KnowledgePoint', KnowledgePointSchema);