// 用法：在 feynman-platform-backend 目录下执行
//   node scripts/check-baidu.js                  只测密钥能否换到 token
//   node scripts/check-baidu.js 音频路径.wav      再顺带测一次识别
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const axios = require('axios');

const API_KEY = process.env.BAIDU_API_KEY || '';
const SECRET_KEY = process.env.BAIDU_SECRET_KEY || '';

const mask = (s) => (s.length <= 6 ? s : `${s.slice(0, 4)}***${s.slice(-4)}`);

const HINTS = {
  invalid_client: [
    '与 token 接口不匹配的凭证。服务端不认这组 client_id/client_secret。',
    '排查顺序：',
    '  1) 打开 https://console.bce.baidu.com/ai-engine/old/#/ai/speech/app/list',
    '     必须是【语音技术 → 应用列表】里某个应用页上的 API Key / Secret Key，',
    '     同一页还应有 AppID（三件套齐全）。用户中心 → 安全认证 里的 AK/SK 不行。',
    '  2) 确认该应用创建时勾选了「短语音识别」。',
    '  3) 确认当前登录的百度账号 == 创建应用的账号（手机号/邮箱可能各有一个账号）。',
    '  4) 到该应用详情里重新「显示」一次 Secret Key，整体复制（不要带空格换行）。'
  ],
  unauthorized_client: ['应用未获得该接口权限，确认应用已勾选「短语音识别」服务。']
};

(async () => {
  console.log('=== 1. 本地读取到的凭证 ===');
  console.log('API_KEY   :', mask(API_KEY), `(长度 ${API_KEY.length})`);
  console.log('SECRET_KEY:', mask(SECRET_KEY), `(长度 ${SECRET_KEY.length})`);

  if (!API_KEY || !SECRET_KEY) {
    console.log('\n.env 里没有读到 BAIDU_API_KEY / BAIDU_SECRET_KEY，先修配置。');
    return;
  }
  if (API_KEY.length !== 24 || SECRET_KEY.length !== 32) {
    console.log('\n[警告] 语音技术的 API Key 通常是 24 位、Secret Key 32 位，当前长度不符合，可能复制错或复制不全。');
  }

  console.log('\n=== 2. 用密钥换 access_token ===');
  let token;
  try {
    const { data } = await axios.post(
      'https://aip.baidubce.com/oauth/2.0/token',
      null,
      {
        params: {
          grant_type: 'client_credentials',
          client_id: API_KEY,
          client_secret: SECRET_KEY
        },
        timeout: 15000
      }
    );
    if (!data.access_token) {
      console.log('失败，返回：', data);
      (HINTS[data.error] || ['未知错误类型，请把上面的返回原样发出来。']).forEach((l) => console.log('  ' + l));
      return;
    }
    token = data.access_token;
    console.log('成功！access_token =', mask(token), `有效期 ${data.expires_in / 86400} 天`);
  } catch (err) {
    console.log('请求异常：', err.response?.data || err.message);
    return;
  }

  const filePath = process.argv[2];
  if (!filePath) {
    console.log('\n密钥没问题。要顺带验证识别，再执行：node scripts/check-baidu.js 你的音频.wav');
    return;
  }

  console.log('\n=== 3. 调用短语音识别 ===');
  const buf = fs.readFileSync(filePath);
  console.log('音频文件:', filePath, `${(buf.length / 1024).toFixed(1)} KB`);

  const { data } = await axios.post('https://vop.baidu.com/server_api', buf, {
    params: { token, cuid: 'check-baidu-script', dev_pid: 1537, format: 'wav', rate: 16000, channel: 1 },
    headers: { 'Content-Type': 'audio/wav;rate=16000' },
    timeout: 30000
  });

  console.log('返回：', JSON.stringify(data, null, 2));
  if (data.err_no === 0) {
    console.log('识别结果：', (data.result || []).join(''));
  } else if (data.err_no === 3301 || data.err_no === 3310 || data.err_no === 3312) {
    console.log('👉 鉴权已通过，现在是音频格式问题：必须是 16000Hz / 单声道 / wav 或 pcm。');
  }
})().catch((e) => console.error('脚本异常：', e.message));
