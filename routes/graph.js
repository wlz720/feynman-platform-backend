// 课时12：知识图谱数据接口
// 节点 = 知识点；边 = 引用关系（知识点 A 的正文提到了知识点 B 的标题）。
// 返回 ECharts graph 系列所需的 { nodes, links } 结构。
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KnowledgePoint = require('../models/KnowledgePoint');
const { sendDbAwareError } = require('../middleware/dbGuard');

// @route   GET /api/graph/knowledge-map
// @desc    获取当前用户的知识图谱数据（节点 + 引用边）
// @access  Private
router.get('/knowledge-map', auth, async (req, res) => {
  try {
    const kps = await KnowledgePoint.find({ user: req.user.id });
    if (kps.length === 0) {
      return res.json({ nodes: [], links: [] });
    }

    // 节点大小随正文长度增大（20~50），并带上状态供前端着色（课后挑战题）
    const nodes = kps.map((kp) => ({
      id: kp._id.toString(),
      name: kp.title,
      value: kp.content.substring(0, 100),
      symbolSize: 20 + Math.min(kp.content.length / 50, 30),
      status: kp.status,
      reviewList: kp.reviewList,
      createdAt: kp.createdAt
    }));

    // 关系发现（课件简化版）：A 的 content 包含 B 的 title 即建立 A → B 的引用边。
    // 标题过短（<2 字）时跳过，避免「栈」这类单字标题造成满屏误连。
    const links = [];
    const titleMap = new Map(
      kps.filter((kp) => kp.title.trim().length >= 2).map((kp) => [kp.title, kp._id.toString()])
    );
    for (const sourceKp of kps) {
      for (const [targetTitle, targetId] of titleMap) {
        if (sourceKp._id.toString() === targetId) continue;
        if (sourceKp.content.includes(targetTitle)) {
          links.push({ source: sourceKp._id.toString(), target: targetId });
        }
      }
    }

    res.json({ nodes, links });
  } catch (err) {
    sendDbAwareError(res, err, 'Server Error');
  }
});

module.exports = router;