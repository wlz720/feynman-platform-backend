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

// 中间件
app.use(cors());
app.use(express.json());

// MongoDB连接
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// 路由挂载
app.use('/api/users', require('./routes/users'));
app.use('/api/knowledge-points', require('./routes/knowledgePoints'));
app.use('/api/audio', audioRouter);

// 健康检查接口
app.get('/', (req, res) => {
  res.send('Hello, Feynman Learner!');
});

// 启动服务
app.listen(port, () => {
  console.log(`Feynman Platform backend is running at http://localhost:${port}`);
});
