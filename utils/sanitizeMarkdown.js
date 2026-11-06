// 入库前消毒：删除代码块之外的原始 HTML，避免 <script>、onerror 之类的载荷被持久化。
// 正文是 Markdown，真正的执行防线在渲染层（react-markdown + DOMPurify）；
// 这里只做「恶意代码不入库」的存储侧清理，因此不能粗暴地做 HTML 转义——
// 那会把 > 引用块、$a < b$ 公式和自动链接一起破坏。

const FENCE_RE = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g;
const INLINE_CODE_RE = /(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1/g;
// Markdown 自动链接 <https://example.com>，不能被当成 HTML 标签删掉
const AUTOLINK_RE = /<([a-z][a-z0-9+.-]*:[^\s<>]+)>/gi;
// 连同内容一起删除的容器标签
const DANGEROUS_BLOCKS = [
  /<script\b[\s\S]*?<\/script\s*>/gi,
  /<style\b[\s\S]*?<\/style\s*>/gi,
  /<iframe\b[\s\S]*?<\/iframe\s*>/gi,
  /<object\b[\s\S]*?<\/object\s*>/gi,
  /<noscript\b[\s\S]*?<\/noscript\s*>/gi
];
const TAG_RE = /<\/?[a-z][^<>]*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

const PLACEHOLDER = '\u0000MDSAFE';

function restoreCode(text, blocks) {
  return text.replace(new RegExp(`${PLACEHOLDER}(\\d+)\\u0000`, 'g'), (_, index) => blocks[Number(index)] ?? '');
}

function stripDangerousBlocks(text) {
  let out = text.replace(COMMENT_RE, '');
  DANGEROUS_BLOCKS.forEach((re) => {
    out = out.replace(re, '');
  });
  return out;
}

/**
 * 入库前消毒（正文）：删除代码块之外的原始 HTML，防止 <script>、onerror 之类
 * 的载荷被持久化。正文本身是 Markdown，渲染时还会经过 react-markdown + DOMPurify。
 */
function sanitizeMarkdown(content) {
  if (typeof content !== 'string' || !content) return content;

  const blocks = [];
  const stash = (text) => {
    const token = `${PLACEHOLDER}${blocks.length}\u0000`;
    blocks.push(text);
    return token;
  };

  // 先把「要原样展示的文本」换成占位符：围栏代码块 → 行内代码 → 自动链接
  const guarded = content
    .replace(FENCE_RE, (match) => stash(match))
    .replace(INLINE_CODE_RE, (match) => stash(match))
    .replace(AUTOLINK_RE, (match) => stash(match));

  const cleaned = stripDangerousBlocks(guarded).replace(TAG_RE, '');
  return restoreCode(cleaned, blocks);
}

// 标题按纯文本展示（React 会转义），只需清掉真正的恶意标签，
// 保留 "C++ 模板 <T>" 这类正常写法。
function sanitizeTitle(title) {
  if (typeof title !== 'string' || !title) return title;
  const cleaned = stripDangerousBlocks(title).replace(/<[a-z][^<>]*(?:on\w+\s*=|javascript:)[^<>]*>/gi, '');
  return cleaned;
}

module.exports = { sanitizeMarkdown, sanitizeTitle };
