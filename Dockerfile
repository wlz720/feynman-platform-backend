# 课时16：后端容器化
# 说明：项目使用 bcryptjs（纯 JavaScript）而非原生 bcrypt，
# 因此 Alpine（musl）也能直接安装依赖，无需编译工具链。
FROM node:20-alpine

WORKDIR /app

# 生产环境：只装运行依赖
ENV NODE_ENV=production

# 先复制依赖清单，利用镜像层缓存：代码改动不会触发重新 npm ci
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# 后端服务端口（可由 .env 的 PORT 覆盖）
EXPOSE 3000

# 健康检查：根路径不依赖数据库，容器启动即可探活
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "index.js"]
