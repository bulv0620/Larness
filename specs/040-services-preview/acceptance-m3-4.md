# M3-4 验收记录：Browser/Agent 卡片、HMR 与开发 API

> 2026-11-05；分支 `task/m3-1-registration`。M3-2/M3-3b 已 done。

## 交付

- 服务详情“预览”：打开独立来源 Browser Tab；解析票据后以 **POST 表单**提交到 `/__bootstrap`，303 后 iframe 加载项目页；票据不进 URL/布局。
- iframe `allow-scripts allow-forms allow-same-origin`、`no-referrer`；提供刷新、重新解析、独立来源外部打开与失败提示。
- Browser Tab 以 `browser:<serviceId>:<path>` 去重；布局恢复保留真实服务窗口与 Browser Tab（修复旧迁移把真实 Tab 当 Demo 丢弃）。
- Agent `resolve_service_preview`（L0）返回结构化 `{kind:"preview",serviceId,path}`，不发票据、不启动进程；时间线渲染“打开预览”卡片，点击复用 Browser Tab。
- Vite 项目相对 `/api` 经项目 dev proxy 访问第二个终端后端，浏览器全程经预览网关。

## 证据

| 场景 | 证据 |
|---|---|
| S3 隔离来源 iframe / HTTP / WS / HMR | `e2e-auth/preview.spec.ts`：Vite 页面 `v1`，改文件后 HMR 到 `v2`；WS 使用预览 host；页面请求无直连 Vite 端口 |
| S14 前端相对 API | 同 E2E：iframe 内 `/api/health` 显示后端 `ok`，经 Vite proxy 转发到第二终端 |
| S8 隔离 | 既有 M3-3b 矩阵 + iframe sandbox/独立 host |
| 票据不泄漏 | 组件测试：票据只在 POST 表单 input，不在 URL/文本 |
| Agent 卡片 | `resolve_service_preview` L0 + 组件测试；真实 Turn E2E 中点击卡片打开 iframe |

命令：

```bash
LARNESS_E2E_WEB_PORT=5180 LARNESS_E2E_PORT=3325 LARNESS_E2E_PREVIEW_PORT=3311 \
  pnpm exec playwright test -c playwright.auth.config.ts e2e-auth/preview.spec.ts
pnpm check
```

结果：预览 E2E 1/1、服务窗口 E2E 1/1；`pnpm check` server 442 / 2 skipped、Web 全通过。

## 边界与未覆盖

- 项目返回 `X-Frame-Options/CSP frame-ancestors` 时只能由浏览器判定；界面提供外部打开，但未做自动化浏览器负例。
- Agent 预览卡片已在真实 Turn E2E 中验证：模型调用 `resolve_service_preview`，时间线出现“打开预览”，点击后 iframe 加载当前服务。
- 外部打开依赖浏览器允许新窗口，未做弹窗拦截的自动化。
- 远程独立域 HTTPS、其他浏览器/平台未验证；远程仍延后至上线实验。
