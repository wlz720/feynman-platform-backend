// 灌入演示用知识点到当前登录账号（通过后端 HTTP API，不直连数据库）
// 用法：
//   SEED_EMAIL=xxx@xx.com SEED_PASSWORD=xxx node scripts/seed-demo-kps.js
//   或：node scripts/seed-demo-kps.js <email> <password>
// 说明：先按标题去重，已存在的同名知识点跳过；新建后再回写学习状态与复习标记。
const axios = require('axios');

const BASE = process.env.SEED_API_BASE || 'http://localhost:3000/api';

const DEMO_KPS = [
  {
    title: 'HTTP 与 HTTPS',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
HTTP 是浏览器与服务器之间传输超文本的应用层协议；HTTPS 在 HTTP 下层加了 TLS 加密，保证内容机密、完整且可验证身份。

## 核心要点
- **请求方法**：GET 查、POST 增、PUT 改、DELETE 删，HEAD 只取响应头。
- **常见状态码**：200 成功、301/302 重定向、400 参数错误、401 未登录、403 无权限、404 不存在、500 服务器错误。
- **报文结构**：请求行/状态行 + 请求头/响应头 + 空行 + 请求体/响应体。
- **HTTPS 优势**：加密防窃听、校验完整性防篡改、证书验证服务器身份。

## 易错提醒
- 401 是没带凭证或凭证无效，403 是已识别但没权限，两者不要混。
- HTTPS 只是传输层加密，不代表接口业务逻辑一定安全。`
  },
  {
    title: 'CSS 盒模型与定位',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
盒模型描述一个元素由内容（content）、内边距（padding）、边框（border）、外边距（margin）四部分组成；定位规则决定它在页面中的摆放位置。

## 核心要点
- **box-sizing**：\`content-box\` 宽高只算内容；\`border-box\` 宽高含 padding 与 border，布局更可控。
- **定位方式**：static 静态、relative 相对自身偏移、absolute 相对最近定位祖先、fixed 相对视口、sticky 滚动到阈值后吸附。
- **层叠**：定位元素用 z-index 控制上下层叠，父级层叠上下文会限制子级。
- **普通流**：块级元素纵向排列，行内元素横向排列，float 与定位会脱离普通流。

## 易错提醒
- relative 不脱离文档流，仍占位；absolute / fixed 脱离文档流，不占原位置。
- margin 会折叠，padding 不会；盒模型宽度默认不含 border 和 padding。`
  },
  {
    title: '进程与线程',
    status: 'not_started',
    reviewList: false,
    content: `## 一句话定义
进程是操作系统分配资源的最小单位，线程是进程内执行调度的最小单位；一个进程可以包含多个共享其资源的线程。

## 核心要点
- **进程**：有独立地址空间，进程间通信（IPC）成本高，一个进程崩溃通常不影响其他进程。
- **线程**：同进程内共享堆、全局变量与文件句柄，切换成本低，一个线程崩溃可能拖垮整个进程。
- **并发与并行**：并发是交替推进多任务，并行是同一时刻多核同时执行。
- **典型模型**：多进程、多线程、协程（用户态轻量线程）。

## 易错提醒
- 线程上下文切换比进程轻，但共享资源带来竞态，需要加锁同步。
- Node.js 主线程单线程，但通过事件循环异步处理 IO，不等于只能做一件事。`
  },
  {
    title: 'JWT 鉴权流程',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
JWT（JSON Web Token）是一种无状态的令牌：登录后服务器签发一段含用户信息的加密字符串，后续请求带上它即可识别身份，不必在服务端存会话。

## 核心要点
- **三段结构**：Header（算法与类型）、Payload（用户标识与声明）、Signature（签名校验），用点号连接。
- **流程**：账号密码登录 → 服务端校验并签发 token → 前端保存并在请求头携带 → 服务端验签后放行。
- **验签关键**：用密钥校验签名是否被篡改，Payload 只是编码，不能放敏感明文。
- **过期处理**：设置过期时间，必要时用刷新令牌（refresh token）续期。

## 易错提醒
- JWT 默认不加密，Payload 可被解码查看，不要写密码等敏感信息。
- 登出在纯前端很难真正作废已签发 token，通常靠短过期期 + 黑名单实现。`
  },
  {
    title: '数据库索引与 B+ 树',
    status: 'not_started',
    reviewList: false,
    content: `## 一句话定义
索引是为加速查询而建立的数据结构；关系型数据库常用 B+ 树组织索引，把有序键值存放在多层平衡树上，减少磁盘 IO 次数。

## 核心要点
- **B+ 树特点**：非叶子节点只存键，数据都在叶子节点；叶子节点有序链表相连，适合范围查询。
- **索引收益**：把全表扫描降到树高次数级别的查找，加速 WHERE、ORDER BY、JOIN。
- **代价**：占用存储空间，写入时要同步维护索引，索引过多会拖慢增删改。
- **适用场景**：高频过滤、排序、关联的列；区分度低的列（如性别）建索引收益小。

## 易错提醒
- 索引不是越多越好，要结合查询语句和最左前缀原则设计。
- 模糊查询前置通配符（\`%xx\`）通常无法有效利用 B+ 树索引。`
  },
  {
    title: '浏览器渲染流程：从 HTML 到像素',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
浏览器把 HTML、CSS、JavaScript 转成屏幕像素的过程，大致经过解析构建 DOM/CSSOM、合成渲染树、布局回流、绘制与合成几个阶段。

## 核心要点
1. **解析**：HTML 解析成 DOM 树，CSS 解析成 CSSOM 树。
2. **渲染树**：DOM 与 CSSOM 合并成 Render Tree，只包含可见节点。
3. **布局（回流 reflow）**：计算每个元素的几何位置与尺寸。
4. **绘制（repaint）**：填充颜色、文字、图像等像素。
5. **合成（composite）**：图层合并上屏，transform、opacity 常可只走合成层。

## 易错提醒
- 改变几何尺寸会触发回流，代价高；只改颜色/背景触发重绘；改 transform/opacity 走合成最快。
- 频繁读写样式要先缓存读取，避免强制同步布局（layout thrashing）。`
  },
  {
    title: '数组与链表',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
数组在连续内存中存元素，靠下标随机访问；链表用指针把零散节点串起来，插入删除不必移动整块数据。

## 核心要点
- **数组**：随机访问 O(1)，中间插入/删除 O(n)，连续存储，缓存友好。
- **链表**：访问第 i 个元素 O(n)，已知节点的插入/删除 O(1)，内存零散、有指针开销。
- **变种**：单链表、双向链表、循环链表；常见应用有链表反转、环检测、合并有序链表。

## 易错提醒
- 链表省了搬移数据的时间，但不支持下标随机访问，查找不能二分。
- 实际工程中顺序结构多用动态数组（如 JS 数组 / Python list），链表更适合频繁头尾增删的场景。`
  },
  {
    title: '递归与分治',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
递归是函数不断调用自身直到触达基线条件；分治把大问题拆成同类子问题，分别求解后再合并结果。

## 核心要点
- **递归三要素**：基线条件（出口）、递推关系、收敛到出口的参数变化。
- **分治步骤**：分解（divide）→ 解决（conquer）→ 合并（combine）。
- **典型例子**：归并排序、快速排序、二叉树遍历、汉诺塔、阶乘与斐波那契。
- **代价**：递归调用占用调用栈，层数过深可能栈溢出；重复子问题可加记忆化优化。

## 易错提醒
- 没有基线条件或参数不收敛会无限递归，最终栈溢出。
- 递归写法简洁，但要关注栈深度与重复计算，必要时改写成迭代或加缓存。`
  },
  // —— 第二组：互相引用、成簇的关联知识点 ——
  {
    title: 'RESTful API 设计规范',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
RESTful 是一种用 URL 定位资源、用 HTTP 方法表达动作的接口设计风格，主张接口简洁、面向资源、无状态。

## 核心要点
- **资源定位**：名词复数命名路径，如 \`/api/books\`，避免在 URL 里堆砌动词。
- **方法语义**：GET 查询、POST 新建、PUT 全量更新、PATCH 局部更新、DELETE 删除。
- **无状态**：每次请求自带凭证，服务端不保存会话上下文，便于水平扩展。
- **统一响应**：用一致的状态码、错误结构和分页格式返回结果。

## 相关知识点
配合《前后端分离架构》《HTTP 与 HTTPS》《状态码与请求方法》一起理解：接口风格建立在 HTTP 协议之上，而前后端分离决定了接口的组织方式。

## 易错提醒
- 不要把数据库表名直接当接口资源名，资源应是面向业务的抽象。
- GET 不应修改数据，写操作要走 POST/PUT/DELETE。`
  },
  {
    title: '前后端分离架构',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
前后端分离把页面展示（前端）与数据逻辑（后端）拆开，前端通过接口调用后端提供的数据服务，双方各自独立部署迭代。

## 核心要点
- **分工**：前端负责渲染与交互，后端负责业务规则、数据持久化与接口。
- **通信**：通过 HTTP 接口交换 JSON，常见 RESTful 风格见《RESTful API 设计规范》。
- **鉴权**：接口无状态，登录态通常用《JWT 鉴权流程》里的令牌携带。
- **优点**：并行开发、复用同一套后端服务多端适配、部署灵活。

## 相关知识点
建立在《HTTP 与 HTTPS》协议之上，与《RESTful API 设计规范》《JWT 鉴权流程》紧密配合。

## 易错提醒
- 分离不等于后端不管页面渲染；服务端渲染（SSR）仍是前后端协作的一种形态。
- 跨域、凭证、接口契约需要在前后端之间提前约定。`
  },
  {
    title: '状态码与请求方法',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
请求方法说明对资源做什么操作，状态码告诉客户端请求的处理结果，二者是 HTTP 接口沟通的基础语言。

## 核心要点
- **常用方法**：GET 读取、POST 创建、PUT 更新、DELETE 删除、HEAD 取响应头。
- **2xx 成功**：200 OK、201 Created、204 No Content。
- **3xx 重定向**：301 永久、302 临时、304 资源未修改。
- **4xx 客户端错误**：400 参数错、401 未认证、403 无权限、404 不存在、429 限流。
- **5xx 服务端错误**：500 内部错误、502 网关错误、503 不可用、504 网关超时。

## 相关知识点
方法与状态码都运行在《HTTP 与 HTTPS》协议之上，设计接口时对照《RESTful API 设计规范》。

## 易错提醒
- 401 是凭证缺失或无效，403 是已识别但无权操作，不要混淆。
- 状态码要真实反映结果，不要所有错误都返回 200 加一个错误文案。`
  },
  {
    title: '会话管理与 Cookie',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
会话管理解决「多次请求之间如何认出同一个用户」的问题；Cookie 是浏览器在本地保存、随请求自动携带的一小段凭证。

## 核心要点
- **Cookie 机制**：服务器下发 Set-Cookie，浏览器后续请求自动带上，可设置过期、路径与作用域。
- **会话标识**：传统服务端用 Session ID 存登录态；令牌方案见《JWT 鉴权流程》。
- **安全属性**：HttpOnly 防脚本窃取、Secure 仅 HTTPS 携带、SameSite 防跨站伪造。
- **适用对比**：Cookie 适合浏览器场景；纯接口/多端常用无状态令牌。

## 相关知识点
底层依托《HTTP 与 HTTPS》传输，鉴权方案可对照《JWT 鉴权流程》。

## 易错提醒
- Cookie 会被 CSRF 利用，敏感操作要加 SameSite 与校验。
- 不要把密码等敏感明文写进 Cookie。`
  },
  {
    title: '二叉树与二叉搜索树',
    status: 'not_started',
    reviewList: false,
    content: `## 一句话定义
二叉树是每个节点最多两个子节点的树形结构；二叉搜索树（BST）满足左子树值小于根、右子树值大于根，支持有序查找。

## 核心要点
- **遍历**：前序、中序、后序、层序；BST 中序遍历得到有序序列。
- **查找**：从根出发按大小关系向左或向右，平均 O(log n)。
- **平衡问题**：普通 BST 可能退化成链表，AVL、红黑树通过旋转保持平衡。
- **关联结构**：数据库有序索引常采用类似的树结构，见《数据库索引与 B+ 树》。

## 相关知识点
树形递归思路参考《递归与分治》，底层顺序存储对照《数组与链表》。

## 易错提醒
- 不平衡的 BST 查找会退化成 O(n)，不能只记住平均复杂度。
- 插入删除后要检查是否需要旋转再平衡。`
  },
  {
    title: '哈希表与散列冲突',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
哈希表用散列函数把键映射到数组下标，实现平均 O(1) 的按键存取；不同键映射到同一位置即为散列冲突。

## 核心要点
- **冲突解决**：链地址法（桶内挂链表）、开放寻址法（探测空位）。
- **负载因子**：元素数 / 槽位数，过高时冲突增多，需要扩容重散列。
- **典型应用**：键值缓存、去重、计数、字典与集合。
- **对比结构**：链式桶里节点组织方式与《数组与链表》相关。

## 相关知识点
衡量哈希表效率要结合《时间复杂度与空间复杂度》分析。

## 易错提醒
- 哈希查找平均 O(1)，最坏冲突退化为 O(n)。
- 哈希表无序，需要排序或范围查询时要另选结构。`
  },
  {
    title: '排序算法概览',
    status: 'not_started',
    reviewList: false,
    content: `## 一句话定义
排序算法把一组元素按关键字递增或递减重新排列，常见有冒泡、选择、插入、归并、快速、堆排序等。

## 核心要点
- **简单 O(n²)**：冒泡、选择、插入，实现简单，适合小规模数据。
- **分治 O(n log n)**：归并稳定占额外空间；快速平均快，最坏退化。
- **堆排序**：建堆后反复取顶，原地排序但不稳定。
- **稳定性**：相等值排序后相对顺序是否保持，影响业务结果。

## 相关知识点
数据存放与遍历对照《数组与链表》，算法代价用《时间复杂度与空间复杂度》衡量，分治思想见《递归与分治》。

## 易错提醒
- 选择算法不只看平均速度，还要看稳定性、空间占用和数据规模。
- 快排最坏情况与基准选取有关，并非永远 O(n log n)。`
  },
  {
    title: '时间复杂度与空间复杂度',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
复杂度衡量算法随数据规模增长的代价：时间复杂度看运行步数增长趋势，空间复杂度看额外占用内存增长趋势，常用大 O 记号表示。

## 核心要点
- **常见阶**：O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2ⁿ)。
- **分析方法**：关注最坏情况与上界，去掉常数项和低阶项。
- **空间换时间**：用哈希表等额外空间降低时间开销，权衡见《哈希表与散列冲突》。
- **对比基线**：顺序结构存取对照《数组与链表》，整体算法目录见《排序算法概览》。

## 相关知识点
是评估《哈希表与散列冲突》《排序算法概览》等结构与算法的统一尺子。

## 易错提醒
- 复杂度描述的是增长趋势，不代表具体运行毫秒数。
- 递归算法要同时看调用栈带来的空间开销。`
  }
];

async function main() {
  const email = process.argv[2] || process.env.SEED_EMAIL;
  const password = process.argv[3] || process.env.SEED_PASSWORD;
  if (!email || !password) {
    console.error('请提供账号邮箱和密码：node scripts/seed-demo-kps.js <email> <password>');
    process.exit(1);
  }

  let token;
  try {
    const login = await axios.post(`${BASE}/users/login`, { email, password });
    token = login.data.token;
    console.log(`登录成功：${login.data.user?.username || email}`);
  } catch (err) {
    console.error('登录失败：', err.response?.data?.msg || err.message);
    process.exit(1);
  }

  const http = axios.create({
    baseURL: BASE,
    headers: { 'x-auth-token': token }
  });

  // 取现有知识点标题用于去重
  const existing = await http.get('/knowledge-points');
  const seen = new Set((existing.data || []).map((k) => k.title));
  console.log(`当前已有 ${seen.size} 个知识点`);

  let created = 0;
  let skipped = 0;
  for (const kp of DEMO_KPS) {
    if (seen.has(kp.title)) {
      console.log(`· 跳过（已存在）：${kp.title}`);
      skipped += 1;
      continue;
    }
    try {
      const res = await http.post('/knowledge-points', { title: kp.title, content: kp.content });
      const id = res.data._id;
      await http.put(`/knowledge-points/${id}`, { status: kp.status, reviewList: kp.reviewList });
      console.log(`· 已创建：${kp.title}（${kp.status}）`);
      created += 1;
    } catch (err) {
      console.error(`  创建失败：${kp.title} ——`, err.response?.data?.msg || err.message);
    }
  }

  console.log(`\n完成：新建 ${created} 个，跳过 ${skipped} 个。`);
  process.exit(0);
}

main().catch((err) => {
  console.error('脚本异常：', err.response?.data || err.message);
  process.exit(1);
});
