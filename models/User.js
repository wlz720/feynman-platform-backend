const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  // 可选手机号：不填时字段不写入文档，配合 sparse 唯一索引避免多个空值互相冲突
  phone: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: true
  }
}, { timestamps: true });

// 手机号稀疏唯一：只有填了手机号的记录才参与唯一约束
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('User', UserSchema);
