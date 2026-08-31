# dsh-mobile-apk 测试报告

## 测试环境

- 设备: V4DUT20428003391 (arm64, 华为 WebView 114.0.5.302)
- APP 版本: 0.13.1
- 快照: arm64

---

## ✅ 已完成测试

### 1. 多模态配置保存

- `ag-multimodal.json` 正确写入
- API Key 正确存储

### 2. Settings.yaml 生成

```yaml
llm-pi-ai:
  providers:
    agnes:
      displayName: Agnes
      apiKeyEnv: AGNES_API_KEY
      api: openai-completions
      baseURL: https://apihub.agnes-ai.cn
      reasoning: high
      models:
        - id: agnes-2.5-flash
          name: agnes-2.5-flash
          contextWindow: 512000
          maxTokens: 65500
      defaultInput:
        - text
        - image
agent-default-model:
  provider: agnes
  model: agnes-2.5-flash
  reasoningEffort: high
```

### 3. Credentials 同步

- `.credentials.yaml` 正确生成
- `AGNES_API_KEY` 已写入
- 权限正确设置为 600

### 4. 引擎启动

- 引擎正常启动，无报错
- `dsh web: http://127.0.0.1:3080`
- CDP 可连接

### 5. Canvas Polyfill 验证

- Chromium 114 WebView 不再报 `@napi-rs/canvas` 警告
- pdfjs 渲染正常

---

## ⏳ 待用户验证

1. **UI 模型选择**
   - 在 APP 中查看「选择模型」是否显示 Agnes
   - 在设置 → 模型中查看 Agnes 供应商

2. **LLM 调用测试**
   - 发送一条消息测试 Agnes LLM 是否可用

---

## 代码修改记录

### 修改的文件

1. `app/src/main/assets/dsh-agconfig/lib/index.js`
   - 添加 `credentials` 依赖
   - 添加 YAML 读写函数
   - 在保存 accounts 时自动同步 credentials 和 settings.yaml

2. `app/src/main/assets/dsh-agconfig/package.json`
   - 添加 `@deepseek-ai/dsh-credentials` peerDependency

3. `app/src/main/assets/dsh-agconfig/lib/client.js`
   - 添加 `credentialsSynced` 响应处理
   - 显示 "LLM 配置已自动同步" 提示

4. `app/src/main/assets/patched/web-frontend-index.html`
   - 新增 Canvas/DOM API polyfill（DOMMatrix/ImageData/Path2D/OffscreenCanvas）

5. `app/src/main/java/com/dshmobile/shell/EngineManager.kt`
   - 新增 `deployAgPlugins()` 方法
   - 在 `startEngine()` 中调用 `deployAgPlugins()`

---

## 已知问题

| 问题 | 状态 | 备注 |
|------|------|------|
| credentials 服务 API 不确定性 | ⚠️ 待确认 | `credentials.set()`/`credentials.delete()` 可能不是正确 API，需确认 dsh-credentials 接口 |
| YAML 序列化 | ✅ 已修复 | 数组格式问题已修复，当前生成的 YAML 与本地格式一致 |

---

*测试时间：2026-08-31*
