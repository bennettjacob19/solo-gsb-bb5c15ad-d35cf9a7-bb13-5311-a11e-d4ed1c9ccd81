# ---------- 构建阶段：安装依赖并打包 ----------
FROM node:20-alpine AS build
WORKDIR /app

# 先拷贝依赖清单，利用 Docker 层缓存；npm ci 按 lockfile 精确安装
COPY package.json package-lock.json ./
RUN npm ci

# 拷贝源码并构建（含 TypeScript 类型检查）
COPY . .
RUN npm run build

# ---------- 运行阶段：Nginx 托管静态文件 ----------
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
