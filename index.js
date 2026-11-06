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
app.use(express.json());

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
// 语音转录与 AI 评价本身不读写数据库，所以不挂数据库守卫
app.use('/api/users', requireDb, require('./routes/users'));
app.use('/api/knowledge-points', requireDb, require('./routes/knowledgePoints'));
app.use('/api/audio', audioRouter);

// 健康检查接口
app.get('/', (req, res) => {
  res.send('Hello, Feynman Learner!');
});

// 启动服务
app.listen(port, () => {
  console.log(`Feynman Platform backend is running at http://localhost:${port}`);
});
