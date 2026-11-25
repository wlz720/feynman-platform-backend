// 用法：在 feynman-platform-backend 目录下执行
//   node scripts/reindex-vector-store.js          从 MongoDB 全量重建本地向量库
//   node scripts/reindex-vector-store.js --stats  只查看当前向量库统计
//
// 适用场景：
//   1. 保存知识点时向量化请求刚好失败（网络抖动 / 额度不足），导致笔记检索不到；
//   2. 更换机器或 vector_store/store.json 丢失后，把数据库里的笔记重新入库；
//   3. 更换 Embedding 模型后旧向量维度不一致，需要整体重建。
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const KnowledgePoint = require('../models/KnowledgePoint');
const { reindexUserKnowledgePoints, getStoreStats } = require('../services/vectorStoreService');

(async () => {
  if (process.argv.includes('--stats')) {
    console.log('向量库统计：', await getStoreStats());
    return;
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('MongoDB 已连接，正在读取全部知识点…');

  const knowledgePoints = await KnowledgePoint.find({});
  console.log(`共读取 ${knowledgePoints.length} 个知识点，开始重建向量索引…`);

  const result = await reindexUserKnowledgePoints(knowledgePoints);
  console.log(`重建完成：${result.knowledgePoints} 个知识点，${result.chunks} 个文本块。`);
  console.log('当前向量库统计：', await getStoreStats());

  await mongoose.disconnect();
})().catch((err) => {
  console.error('重建索引失败：', err.response?.data || err.message);
  process.exitCode = 1;
});
