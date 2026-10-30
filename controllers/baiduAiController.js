const axios = require('axios');

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const ASR_URL = 'https://vop.baidu.com/server_api';

const ASR_ERRORS = {
  3300: '请求参数不合法（cuid/dev_pid 等需要放在 URL 参数里）',
  3301: '音频质量或格式有问题（多见于：实际是 webm/mp3，却声明为 wav）',
  3302: '鉴权失败，access_token 无效或已过期',
  3303: '百度服务端处理失败，请重试',
  3304: '请求超时',
  3305: '音频过长，短语音识别最长 60 秒',
  3307: '音频文件过大',
  3308: '识别结果为空（没说话、静音或音量太小）',
  3310: '音频采样率与声明值不一致',
  3311: '采样率参数不合法（rate 只能是 16000 或 8000，且必须放在 URL 参数里）',
  3312: '音频格式不支持'
};

let cachedToken = '';
let expireAt = 0;
let pendingToken = null;

async function getAccessToken() {
  if (cachedToken && Date.now() < expireAt) return cachedToken;
  if (pendingToken) return pendingToken;

  pendingToken = axios
    .post(TOKEN_URL, null, {
      params: {
        grant_type: 'client_credentials',
        client_id: process.env.BAIDU_API_KEY,
        client_secret: process.env.BAIDU_SECRET_KEY
      },
      timeout: 10000
    })
    .then(({ data }) => {
      if (!data.access_token) {
        const err = new Error('百度 access_token 获取失败');
        err.detail = data;
        throw err;
      }
      cachedToken = data.access_token;
      expireAt = Date.now() + (data.expires_in - 600) * 1000;
      return cachedToken;
    })
    .finally(() => {
      pendingToken = null;
    });

  return pendingToken;
}

exports.transcribeAudio = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ msg: '没有接收到音频文件' });
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    const detail = err.detail || {};
    console.error('获取百度 token 失败：', detail.error || err.message);
    return res.status(502).json({
      msg: '获取百度 access_token 失败，请检查 API Key / Secret Key',
      error: {
        error: detail.error,
        error_description: detail.error_description
      }
    });
  }

  try {
    // 该接口只认「URL 传参 + 原始音频 body」；把 rate 放 JSON body 会返回 3311
    const { data } = await axios.post(ASR_URL, req.file.buffer, {
      params: {
        token,
        cuid: String(req.user?.id || 'feynman-platform'),
        dev_pid: 1537,
        format: 'wav',
        rate: 16000,
        channel: 1
      },
      headers: { 'Content-Type': 'audio/wav;rate=16000' },
      timeout: 30000
    });

    if (data.err_no === 0) {
      const text = (data.result || []).join('').trim();
      if (!text) {
        return res.status(422).json({ msg: '没有识别到语音内容，请靠近麦克风重试' });
      }
      return res.json({ result: text });
    }

    console.error('百度识别失败：', data);
    return res.status(502).json({
      msg: ASR_ERRORS[data.err_no] || '百度语音识别失败',
      error: data
    });
  } catch (err) {
    console.error('调用百度识别接口异常：', err.response?.data || err.message);
    return res.status(502).json({ msg: '调用百度语音识别接口失败' });
  }
};

exports.getAccessToken = getAccessToken;
