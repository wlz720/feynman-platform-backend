// 必须放在最顶部：加载.env环境变量
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

console.log(
  '百度语音凭证：',
  process.env.BAIDU_API_KEY ? 'API_KEY 已读取' : '缺少 BAIDU_API_KEY',
  '/',
  process.env.BAIDU_SECRET_KEY ? 'SECRET_KEY 已读取' : '缺少 BAIDU_SECRET_KEY'
);

const app = express();
const port = process.env.PORT || 3000;

// 音频语音识别路由
const audioRouter = require('./routes/audio');
const { requireDb } = require('./middleware/dbGuard');

// 中间件
app.use(cors());
// 知识点正文上限 10 万字，中文按 UTF-8 约 300KB，默认的 100kb 会在校验前先报 413
app.use(express.json({ limit: '1mb' }));

// MongoDB连接（Atlas 偶尔选节点很慢，给足超时并在首次失败时重试）
const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
};

async function connectWithRetry(attempt = 1) {
  try {
    await mongoose.connect(process.env.MONGO_URI, MONGO_OPTIONS);
    console.log('MongoDB connected successfully!');
  } catch (err) {
    console.error(`MongoDB connection failed (第 ${attempt} 次):`, err.message);
    if (attempt < 5) setTimeout(() => connectWithRetry(attempt + 1), 3000);
  }
}

mongoose.connection.on('disconnected', () => console.warn('MongoDB 连接已断开，正在自动重连…'));
mongoose.connection.on('error', (err) => console.error('MongoDB 连接异常:', err.message));

connectWithRetry();

// 路由挂载（数据库未就绪时直接返回 503，而不是让请求等到超时再报 500）
// 语音转录、AI 评价与出题阅卷本身不读写数据库，所以不挂数据库守卫
app.use('/api/users', requireDb, require('./routes/users'));
app.use('/api/knowledge-points', requireDb, require('./routes/knowledgePoints'));
app.use('/api/audio', audioRouter);
app.use('/api/ai', require('./routes/ai'));
app.use('/api/quiz', requireDb, require('./routes/quiz'));
// 课时12：知识图谱数据（读知识点表，需要数据库就绪）
app.use('/api/graph', requireDb, require('./routes/graph'));

// 健康检查接口
app.get('/', (req, res) => {
  res.send('Hello, Feynman Learner!');
});

// body-parser 的错误默认返回 HTML，这里统一成前端能展示的 JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ msg: '内容过大，请精简后再保存' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ msg: '请求体不是合法的 JSON' });
  }
  return next(err);
});

// 启动服务
app.listen(port, () => {
  console.log(`Feynman Platform backend is running at http://localhost:${port}`);
});
