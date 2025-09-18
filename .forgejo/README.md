# Forgejo CI/CD 配置说明

## 概述

这个 CI/CD 配置支持多分支部署：
- `master` 分支：推送到正式环境
- `dev` 分支：推送到测试环境

## 配置要求

### 1. 仓库 Secrets 配置

在 Forgejo 仓库设置中添加以下 Secrets：

#### Harbor 镜像仓库认证
- `HARBOR_USERNAME`: Harbor 仓库用户名
- `HARBOR_PASSWORD`: Harbor 仓库密码

#### Webhook URLs
- `PRODUCTION_WEBHOOK_URL`: 正式环境部署 webhook URL
- `TESTING_WEBHOOK_URL`: 测试环境部署 webhook URL

### 2. 镜像标签策略

- `master` 分支：生成 `master` 和 `latest` 标签
- `dev` 分支：生成 `dev` 标签
- 所有分支：生成 `{branch}-{commit-sha}` 标签

### 3. 部署流程

#### Master 分支 (正式环境)
1. 代码推送到 `master` 分支
2. 构建 Docker 镜像
3. 推送到 Harbor 仓库
4. 调用正式环境 webhook 进行部署

#### Dev 分支 (测试环境)
1. 代码推送到 `dev` 分支
2. 构建 Docker 镜像
3. 推送到 Harbor 仓库
4. 调用测试环境 webhook 进行部署

## Webhook 数据格式

部署 webhook 会发送以下 JSON 数据：

```json
{
  "image": "harbor.luxhub.top:2097/realtime-ts-demo:master",
  "environment": "production",
  "branch": "master",
  "commit": "abc123def456"
}
```

## 自定义配置

### 修改镜像仓库地址
在 `.forgejo/workflows/ci.yml` 中修改：
```yaml
env:
  REGISTRY: your-registry.com
  IMAGE_NAME: your-image-name
```

### 添加更多分支
在 `on.push.branches` 中添加新分支：
```yaml
on:
  push:
    branches: [ master, dev, staging ]
```

### 自定义部署逻辑
修改对应的部署步骤，添加你的部署脚本或 API 调用。

## 故障排除

1. **构建失败**：检查 Dockerfile 和依赖配置
2. **推送失败**：验证 Harbor 认证信息
3. **部署失败**：检查 webhook URL 和网络连接
4. **权限问题**：确保 CI 有足够的权限访问仓库和镜像仓库
