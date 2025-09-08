# 构建阶段
FROM --platform=linux/amd64 node:22 AS builder

WORKDIR /usr/src/app

# 启用 Corepack 以使用项目指定的 Yarn 版本
RUN corepack enable

# 设置 Yarn 使用 node_modules 模式并清理
RUN yarn config set nodeLinker node-modules
RUN yarn config set enableGlobalCache false

# 复制依赖文件
COPY package.json yarn.lock .yarnrc.yml ./

# 清理并安装依赖
RUN rm -rf .yarn && yarn install

# 复制源代码
COPY . .

# 构建项目
RUN yarn build

# 生产阶段 - 使用 nginx 服务静态文件
FROM --platform=linux/amd64 nginx:alpine

# 复制构建产物
COPY --from=builder /usr/src/app/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 启动 nginx
CMD ["nginx", "-g", "daemon off;"]