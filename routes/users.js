const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendDbAwareError } = require('../middleware/dbGuard');

// ===== 校验规则（前后端保持一致；后端二次校验，防止绕过前端直接发请求）=====
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

function normalizeAccount(account) {
  const v = String(account || '').trim();
  return v.includes('@') ? v.toLowerCase() : v;
}

function validateUsername(username) {
  const v = String(username || '').trim();
  if (!v) return '请输入用户名';
  if (v.length < 2 || v.length > 20) return '用户名长度需为 2–20 个字符';
  return null;
}

function validateEmail(email) {
  const v = String(email || '').trim();
  if (!v) return '请输入邮箱地址';
  if (!EMAIL_RE.test(v)) return '请输入正确的邮箱地址';
  return null;
}

function validatePhone(phone) {
  const v = String(phone || '').trim();
  if (!v) return null; // 手机号选填
  if (!PHONE_RE.test(v)) return '请输入正确的 11 位手机号';
  return null;
}

function validatePassword(password) {
  const v = String(password || '');
  if (!v) return '请输入密码';
  if (v.length < 6) return '密码长度至少 6 位';
  // 不能是完全相同的字符（如 111111、aaaaaa）
  if (v.length >= 2 && new Set(v.split('')).size === 1) return '密码不能由同一个字符重复组成';
  return null;
}

function validateConfirmPassword(password, confirmPassword) {
  if (String(password || '') !== String(confirmPassword || '')) return '两次输入的密码不一致';
  return null;
}

// ===== 找回密码：验证码占位存储（演示用内存 Map，重启后失效）=====
// TODO(接入短信/邮件)：把下面的 console 输出替换为短信服务商 / 邮件模板发送。
const CODE_TTL_MS = 10 * 60 * 1000; // 验证码 10 分钟内有效
const resetCodes = new Map(); // account -> { code, expiresAt }

function issueResetCode(account) {
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 位数字
  resetCodes.set(account, { code, expiresAt: Date.now() + CODE_TTL_MS });
  // 演示占位：真实环境改为发送短信 / 邮件，前端不再展示
  console.log(`[找回密码] 账号 ${account} 的验证码：${code}（10 分钟内有效）`);
  return code;
}

function consumeResetCode(account, code) {
  const record = resetCodes.get(account);
  if (!record) return '验证码已过期，请重新获取';
  if (Date.now() > record.expiresAt) {
    resetCodes.delete(account);
    return '验证码已过期，请重新获取';
  }
  if (String(code || '').trim() !== record.code) return '验证码不正确';
  resetCodes.delete(account);
  return null;
}

// 注册：前端表单校验之外，后端再校验一遍格式与查重
router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim();
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    const fieldError =
      validateUsername(username) ||
      validateEmail(email) ||
      validatePhone(phone) ||
      validatePassword(password) ||
      validateConfirmPassword(password, confirmPassword);
    if (fieldError) return res.status(400).json({ msg: fieldError });

    // 查重：邮箱、手机号、用户名任一已存在即拦截（不区分是哪一项，避免被用来探测账号）
    const emailLower = email.toLowerCase();
    const existCondition = [{ email: emailLower }, { username }];
    if (phone) existCondition.push({ phone });
    const existing = await User.findOne({ $or: existCondition });
    if (existing) return res.status(400).json({ msg: '该账号已注册，请直接登录' });

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);
    const user = new User({
      username,
      email: emailLower,
      phone: phone || undefined,
      password: hashed
    });
    await user.save();
    res.status(201).json({ msg: '用户注册成功' });
  } catch (err) {
    // 并发下唯一索引兜底
    if (err && err.code === 11000) {
      return res.status(400).json({ msg: '该账号已注册，请直接登录' });
    }
    sendDbAwareError(res, err);
  }
});

// 登录：支持邮箱或手机号 + 密码；账号不存在与密码错误统一提示，防止被枚举账号
router.post('/login', async (req, res) => {
  try {
    const account = normalizeAccount(req.body.account ?? req.body.email);
    const password = String(req.body.password || '');

    if (!account) return res.status(400).json({ msg: '请输入邮箱或手机号' });
    if (!password) return res.status(400).json({ msg: '请输入密码' });

    const user = await User.findOne({
      $or: [{ email: account }, { phone: account }]
    });
    // 账号不存在或密码错误：同一句提示，不区分
    if (!user) return res.status(400).json({ msg: '账号或密码不正确' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: '账号或密码不正确' });

    const payload = { user: { id: user.id } };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' }, (err, token) => {
      if (err) throw err;
      res.json({
        token,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          phone: user.phone || ''
        }
      });
    });
  } catch (err) {
    sendDbAwareError(res, err);
  }
});

// 找回密码 - 第一步：发送验证码（演示占位，验证码打印到后端控制台）
router.post('/forgot-password/send-code', async (req, res) => {
  try {
    const account = normalizeAccount(req.body.account);
    if (!account) return res.status(400).json({ msg: '请输入已注册的邮箱或手机号' });

    const user = await User.findOne({
      $or: [{ email: account }, { phone: account }]
    });
    // 不泄露账号是否已注册：存在才生成验证码，但无论是否存在都返回同一句提示
    if (user) issueResetCode(account);
    res.json({ msg: '若该账号已注册，验证码已发送（演示模式：请查看后端控制台输出）' });
  } catch (err) {
    sendDbAwareError(res, err);
  }
});

// 找回密码 - 第二步：校验验证码并设置新密码
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const account = normalizeAccount(req.body.account);
    const code = req.body.code;
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    if (!account) return res.status(400).json({ msg: '请输入邮箱或手机号' });
    if (!code) return res.status(400).json({ msg: '请输入验证码' });

    const pwdError = validatePassword(password) || validateConfirmPassword(password, confirmPassword);
    if (pwdError) return res.status(400).json({ msg: pwdError });

    const codeError = consumeResetCode(account, code);
    if (codeError) return res.status(400).json({ msg: codeError });

    const user = await User.findOne({
      $or: [{ email: account }, { phone: account }]
    });
    if (!user) return res.status(400).json({ msg: '账号或密码不正确' });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();
    res.json({ msg: '密码已重置，请使用新密码登录' });
  } catch (err) {
    sendDbAwareError(res, err);
  }
});

module.exports = router;
