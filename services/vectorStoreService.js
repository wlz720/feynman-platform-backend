// 课时10：RAG 后端基础 —— 文档分割、文本向量化与本地向量库
//
// 课件示例使用 LangChain.js + @langchain/baidu-qianfan + HNSWLib，这里按课件
// 「LangChain.js 或原生代码」的许可做了两点工程化调整：
// 1. Embedding 走与对话模型同一套凭证：优先 OpenAI 兼容接口（LLM_*，如智谱
//    embedding-2），回退千帆 v2（bce-v3 Key + embedding-v1）。项目已迁移到
//    新版 Key，旧版 AK/SK 换 token 的 SDK 路线不再适用。
// 2. 向量库用本地 JSON 文件 + 余弦相似度暴力检索，替代需要本地编译的
//    hnswlib-node（Windows + 新版 Node 经常装不上）。教学规模（几百个文本块）
//    下性能完全够用，接口签名与课件保持一致，后续可无缝换成真正的向量数据库。
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');

const VECTOR_STORE_PATH = path.join(__dirname, '..', 'vector_store');
const STORE_FILE = path.join(VECTOR_STORE_PATH, 'store.json');

const CHUNK_SIZE = 500; // 每个文本块的最大长度（字符）
const CHUNK_OVERLAP = 50; // 块之间的重叠长度，保证语义连续性
const EMBED_BATCH = 16; // 每次请求最多送多少个文本块
const MAX_CHUNKS_PER_KP = 60; // 单个知识点最多索引的块数（正文上限 10 万字时的保护）

// ---------- 文本分割（对应 LangChain 的 RecursiveCharacterTextSplitter） ----------

// 分隔符按语义粒度从粗到细：先按段落切，切不动再按句子、逗号，最后按字符
const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', '; ', '，', ', ', ' ', ''];

function splitWithSeparator(text, separator) {
  if (separator === '') return Array.from(text); // 按字符（含 emoji 等代理对）
  // 保留分隔符本身，避免句子边界丢失
  const parts = text.split(separator);
  const pieces = [];
  parts.forEach((part, i) => {
    if (i < parts.length - 1) pieces.push(part + separator);
    else if (part) pieces.push(part);
  });
  return pieces;
}

function recursiveSplit(text, separators) {
  if (text.length <= CHUNK_SIZE) return text ? [text] : [];
  const [separator, ...rest] = separators;
  if (separator === undefined) return [text];

  const pieces = splitWithSeparator(text, separator);
  const goodPieces = pieces.filter((p) => p.length <= CHUNK_SIZE);
  const finalChunks = [];
  let pending = [];

  for (const piece of pieces) {
    if (piece.length > CHUNK_SIZE) {
      // 先把攒下的小片段合并成块，再递归处理超长片段
      if (pending.length) {
        finalChunks.push(...mergePieces(pending, separator));
        pending = [];
      }
      finalChunks.push(...recursiveSplit(piece, rest.length ? rest : ['']));
    } else {
      pending.push(piece);
    }
  }
  if (pending.length) finalChunks.push(...mergePieces(pending, separator));
  return finalChunks;
}

// 把小片段合并到接近 CHUNK_SIZE，并让相邻块之间保留 CHUNK_OVERLAP 的重叠
function mergePieces(pieces, separator) {
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > CHUNK_SIZE) {
      chunks.push(current);
      // 从上一块尾部截取重叠部分，保证跨块语义连续
      let overlap = current.slice(-CHUNK_OVERLAP);
      // 不要在重叠区开头留半个分隔符
      if (separator && overlap.startsWith(separator)) overlap = overlap.slice(separator.length);
      current = overlap;
    }
    current += piece;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function splitText(text) {
  return recursiveSplit(String(text || '').trim(), SEPARATORS)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, MAX_CHUNKS_PER_KP);
}

// ---------- Embedding（文本 → 向量） ----------

function resolveEmbeddingConfig() {
  const baseUrl = (process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  if (baseUrl && apiKey) {
    return {
      url: `${baseUrl}/embeddings`,
      apiKey,
      model: (process.env.EMBEDDING_MODEL || 'embedding-2').trim(),
      kind: 'openai'
    };
  }
  const qfKey = (process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY || '').trim();
  if (qfKey && qfKey.startsWith('bce-v3/')) {
    return {
      url: 'https://qianfan.baidubce.com/v2/embeddings',
      apiKey: qfKey,
      model: (process.env.EMBEDDING_MODEL || 'embedding-v1').trim(),
      kind: 'qianfan'
    };
  }
  const err = new Error(
    '未配置 Embedding 凭证：请在 .env 设置 LLM_BASE_URL / LLM_API_KEY（可选 EMBEDDING_MODEL，默认 embedding-2），或配置千帆 bce-v3 Key'
  );
  err.code = 'NO_CREDENTIAL';
  throw err;
}

async function embedTexts(texts) {
  if (!texts.length) return [];
  const config = resolveEmbeddingConfig();
  const vectors = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const { data } = await axios.post(
      config.url,
      { model: config.model, input: batch },
      {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );
    if (data.error || data.error_code) {
      const err = new Error(data.error?.message || data.error_msg || 'Embedding 接口返回错误');
      err.llm = data.error || { code: data.error_code, message: data.error_msg };
      throw err;
    }
    const items = (data.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (items.length !== batch.length || items.some((item) => !Array.isArray(item.embedding))) {
      throw new Error('Embedding 接口返回的向量数量或格式不正确');
    }
    vectors.push(...items.map((item) => item.embedding));
  }
  return vectors;
}

// ---------- 本地向量库（加载 / 保存 / 追加 / 检索） ----------

// 写入串行化：多个知识点同时保存时避免互相覆盖 store.json
let writeQueue = Promise.resolve();
function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {});
  return run;
}

async function loadStore() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const store = JSON.parse(raw);
    if (!Array.isArray(store.docs)) throw new Error('store.json 结构不正确');
    return store;
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, docs: [] };
    throw err;
  }
}

async function saveStore(store) {
  await fs.mkdir(VECTOR_STORE_PATH, { recursive: true });
  // 先写临时文件再改名，避免进程中断留下半个 JSON
  const tmpFile = `${STORE_FILE}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(store), 'utf8');
  await fs.rename(tmpFile, STORE_FILE);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 课时10：将单个知识点的内容添加到向量库（创建/更新知识点时异步调用）。
 * 与课件的简化策略一致：更新时先按 knowledgePointId 删掉旧块再添加新块，
 * JSON 文件存储天然支持删除，比 HNSWLib 的「允许冗余」更干净。
 */
exports.addKnowledgePointToStore = (knowledgePoint) =>
  enqueue(async () => {
    const kpId = knowledgePoint._id.toString();
    const userId = knowledgePoint.user.toString();
    console.log(`正在为知识点 ${kpId} 创建向量...`);

    const chunks = splitText(knowledgePoint.content);
    if (!chunks.length) {
      console.log(`知识点 ${kpId} 内容为空，跳过索引。`);
      return;
    }
    console.log(`知识点被分割成 ${chunks.length} 个文本块。`);

    const vectors = await embedTexts(chunks);
    const store = await loadStore();
    const before = store.docs.length;
    store.docs = store.docs.filter((doc) => doc.knowledgePointId !== kpId);
    const removed = before - store.docs.length;
    chunks.forEach((chunk, i) => {
      store.docs.push({
        id: `${kpId}:${i}`,
        userId,
        knowledgePointId: kpId,
        title: knowledgePoint.title,
        text: chunk,
        embedding: vectors[i]
      });
    });
    await saveStore(store);
    console.log(
      `知识点 ${kpId} 的向量已成功保存（替换旧块 ${removed} 个，当前库共 ${store.docs.length} 块）。`
    );
  }).catch((error) => {
    // 索引失败不影响知识点保存本身，只记日志（与课件一致）
    console.error('添加到向量库失败:', error.response?.data || error.message);
  });

/** 统计某个用户当前已索引的文本块数量（用于判断知识库是否为空 / 是否需要重建） */
exports.countChunksByUser = async (userId) => {
  const store = await loadStore();
  const uid = String(userId);
  return store.docs.filter((doc) => doc.userId === uid).length;
};

/**
 * 按用户重建向量索引：先清掉该用户的旧块，再把传入的知识点重新分割、向量化入库。
 * 用于修复“保存时向量化失败导致笔记检索不到”的索引漂移问题。
 * @param {Array} knowledgePoints Mongo 知识点文档数组
 * @returns {Promise<{knowledgePoints:number, chunks:number}>}
 */
exports.reindexUserKnowledgePoints = (knowledgePoints) =>
  enqueue(async () => {
    const list = Array.isArray(knowledgePoints) ? knowledgePoints : [];
    const userIds = new Set(list.map((kp) => kp.user.toString()));
    const store = await loadStore();
    store.docs = store.docs.filter((doc) => !userIds.has(doc.userId));

    let chunks = 0;
    for (const kp of list) {
      const pieces = splitText(kp.content);
      if (!pieces.length) continue;
      const vectors = await embedTexts(pieces);
      const userId = kp.user.toString();
      const kpId = kp._id.toString();
      pieces.forEach((chunk, i) => {
        store.docs.push({
          id: `${kpId}:${i}`,
          userId,
          knowledgePointId: kpId,
          title: kp.title,
          text: chunk,
          embedding: vectors[i]
        });
      });
      chunks += pieces.length;
    }
    await saveStore(store);
    return { knowledgePoints: list.length, chunks };
  });

/** 删除知识点时同步清掉它的向量块 */
exports.removeKnowledgePointFromStore = (knowledgePointId) =>
  enqueue(async () => {
    const kpId = String(knowledgePointId);
    const store = await loadStore();
    const before = store.docs.length;
    store.docs = store.docs.filter((doc) => doc.knowledgePointId !== kpId);
    if (store.docs.length !== before) {
      await saveStore(store);
      console.log(`已从向量库删除知识点 ${kpId} 的 ${before - store.docs.length} 个文本块。`);
    }
  }).catch((error) => {
    console.error('从向量库删除失败:', error.message);
  });

/**
 * 课时11：相似度检索。把问题也向量化，在库中找余弦相似度最高的 k 个文本块。
 * @param {string} query 用户的问题
 * @param {object} options { userId, k }
 * @returns {Promise<Array<{pageContent, metadata, score}>>}
 */
exports.queryVectorStore = async (query, { userId, k = 4 } = {}) => {
  const store = await loadStore();
  const candidates = userId ? store.docs.filter((doc) => doc.userId === String(userId)) : store.docs;
  if (!candidates.length) return [];

  const [queryVector] = await embedTexts([String(query)]);
  return candidates
    .map((doc) => ({
      pageContent: doc.text,
      metadata: { knowledgePointId: doc.knowledgePointId, title: doc.title },
      score: cosineSimilarity(queryVector, doc.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
};

/** 供自检脚本使用：返回库的统计信息（不含向量本体） */
exports.getStoreStats = async () => {
  const store = await loadStore();
  const byKp = new Map();
  store.docs.forEach((doc) => {
    byKp.set(doc.knowledgePointId, (byKp.get(doc.knowledgePointId) || 0) + 1);
  });
  return {
    path: VECTOR_STORE_PATH,
    totalChunks: store.docs.length,
    knowledgePoints: byKp.size,
    dimensions: store.docs[0]?.embedding?.length || 0
  };
};

exports.splitText = splitText;
exports.embedTexts = embedTexts;