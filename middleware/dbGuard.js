const mongoose = require('mongoose');

// MongoDB Atlas 在网络抖动时会让查询卡住数十秒后抛异常，
// 这类失败和业务错误要分开，否则前端只能看到 500「服务器错误」。
const NETWORK_ERROR_NAMES = new Set([
  'MongooseServerSelectionError',
  'MongooseTimeoutError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
]);

function isDbUnavailable(err) {
  if (!err) return false;
  const names = [err.name, err.constructor && err.constructor.name];
  if (names.some((n) => NETWORK_ERROR_NAMES.has(n))) return true;
  return /buffering timed out|server selection timed out|before initial connection|connection .* closed/i.test(
    err.message || ''
  );
}

// 连接未就绪时立刻返回 503，避免请求一直挂到超时
function requireDb(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();
  const state = mongoose.connection.readyState;
  return res.status(503).json({
    msg: state === 2 ? '数据库正在连接，请稍后重试' : '数据库连接已断开，请稍后重试',
  });
}

function sendDbAwareError(res, err, fallbackMsg = '服务器错误') {
  console.error(err.message);
  if (isDbUnavailable(err)) {
    return res.status(503).json({ msg: '数据库连接超时，请检查网络后重试' });
  }
  return res.status(500).json({ msg: fallbackMsg });
}

module.exports = { isDbUnavailable, requireDb, sendDbAwareError };
