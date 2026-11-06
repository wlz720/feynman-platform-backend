const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');
const { sendDbAwareError } = require('../middleware/dbGuard');

const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 100000;
const STATUS_VALUES = ['not_started', 'need_review', 'mastered'];

// 标题和正文都会原样存库并在前端渲染，这里只做边界校验（类型/长度），
// HTML 与脚本的清理交给渲染层的 react-markdown + DOMPurify。
function readTitle(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: '标题不能为空' };
  const title = value.trim();
  if (title.length > MAX_TITLE_CHARS) return { error: `标题不能超过 ${MAX_TITLE_CHARS} 字` };
  return { value: title };
}

function readContent(value) {
  if (typeof value !== 'string' || !value.trim()) return { error: '内容不能为空' };
  if (value.length > MAX_CONTENT_CHARS) return { error: `内容不能超过 ${MAX_CONTENT_CHARS} 字` };
  return { value };
}

// 创建知识点
router.post('/', auth, async (req, res) => {
  try {
    const title = readTitle(req.body?.title);
    if (title.error) return res.status(400).json({ msg: title.error });
    const content = readContent(req.body?.content);
    if (content.error) return res.status(400).json({ msg: content.error });

    const newKp = new KnowledgePoint({
      title: title.value,
      content: content.value,
      user: req.user.id
    });
    const kp = await newKp.save();
    res.json(kp);
  } catch (err) {
    sendDbAwareError(res, err, 'Server Error');
  }
});

// 获取当前用户所有知识点
router.get('/', auth, async (req, res) => {
  try {
    const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(kps);
  } catch (err) {
    sendDbAwareError(res, err, 'Server Error');
  }
});

// 获取单个知识点详情
router.get('/:id', auth, async (req, res) => {
  try {
    const kp = await KnowledgePoint.findById(req.params.id);
    if (!kp) {
      return res.status(404).json({ msg: 'Knowledge point not found' });
    }
    if (kp.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    res.json(kp);
  } catch (err) {
    sendDbAwareError(res, err, 'Server Error');
  }
});

// 更新知识点
router.put('/:id', auth, async (req, res) => {
  try {
    let kp = await KnowledgePoint.findById(req.params.id);
    if (!kp) {
      return res.status(404).json({ msg: 'Knowledge point not found' });
    }
    if (kp.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }

    const updates = {};
    if (req.body?.title !== undefined) {
      const title = readTitle(req.body.title);
      if (title.error) return res.status(400).json({ msg: title.error });
      updates.title = title.value;
    }
    if (req.body?.content !== undefined) {
      const content = readContent(req.body.content);
      if (content.error) return res.status(400).json({ msg: content.error });
      updates.content = content.value;
    }
    if (req.body?.status !== undefined) {
      if (!STATUS_VALUES.includes(req.body.status)) {
        return res.status(400).json({ msg: 'status 取值不合法' });
      }
      updates.status = req.body.status;
    }
    if (req.body?.reviewList !== undefined) {
      updates.reviewList = Boolean(req.body.reviewList);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ msg: '没有需要更新的字段' });
    }

    kp = await KnowledgePoint.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    res.json(kp);
  } catch (err) {
    sendDbAwareError(res, err, 'Server Error');
  }
});

// 删除知识点
router.delete('/:id', auth, async (req, res) => {
  try {
    const kp = await KnowledgePoint.findById(req.params.id);
    if (!kp) {
      return res.status(404).json({ msg: 'Knowledge point not found' });
    }
    if (kp.user.toString() !== req.user.id) {
      return res.status(401).json({ msg: 'Not authorized' });
    }
    await KnowledgePoint.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Knowledge point removed' });
  } catch (err) {
    sendDbAwareError(res, err, 'Server Error');
  }
});

module.exports = router;