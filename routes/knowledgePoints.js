const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');

// 创建知识点
router.post('/', auth, async (req, res) => {
  try {
    const { title, content } = req.body;
    const newKp = new KnowledgePoint({
      title,
      content,
      user: req.user.id
    });
    const kp = await newKp.save();
    res.json(kp);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// 获取当前用户所有知识点
router.get('/', auth, async (req, res) => {
  try {
    const kps = await KnowledgePoint.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(kps);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
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
    console.error(err.message);
    res.status(500).send('Server Error');
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

    const { title, content, status, reviewList } = req.body;
    kp = await KnowledgePoint.findByIdAndUpdate(
      req.params.id,
      { $set: { title, content, status, reviewList } },
      { new: true }
    );
    res.json(kp);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
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
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;