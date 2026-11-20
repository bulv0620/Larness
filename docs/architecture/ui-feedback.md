# 统一消息反馈（Toast）

> 生效日期：2026-11-20。适用于 `apps/web` 与 `packages/ui` 的所有交互界面。
> 目标：成功、失败与中性提示只有一个组件、一种位置、一套视觉；提示不占用布局空间。

## 1. 强制规则

- 所有由用户动作触发的成功 / 失败 / 中性提示，必须使用 `@larness/ui` 导出的 `Toast`；唯一例外是输入框内的会话级轻量开关（见第 3 节）。
- `Toast` 固定在视口顶部居中，浮于弹窗之上，不参与布局；禁止在按钮、表单、列表、卡片或弹窗内部新增“提示条 / 提示栏 / 结果行”。
- 失败使用 `tone="error"`（或既有别名 `ErrorMessage`），成功使用 `tone="success"`，中性状态使用 `tone="info"`。
- 同一区域同一时刻只显示一条消息；新消息替换旧消息，不堆叠。
- 可恢复错误应当提供 `retry`；不可恢复错误保留“关闭”。
- 禁止 `window.alert` / `window.confirm`、自建固定定位消息组件、页面内成功提示行。
- 禁止把 API Key、Token、Cookie、配对码或异常原文放进提示文案。

## 2. 组件 API

```tsx
import { Toast } from "@larness/ui";

<Toast
  message={notice}              // null 隐藏；变化时重置关闭状态与计时器
  tone="success"                // success | info | error
  durationMs={3200}             // 可选；覆盖默认自动消失时间
  retry={{ label: "重试", run: () => void refetch() }}
  onDismiss={() => setNotice(null)}
/>
```

| 属性 | 说明 |
|---|---|
| `message` | `string \| null`；`null` 不渲染。 |
| `tone` | `success`（默认）、`info`、`error`。决定图标与边框颜色。 |
| `durationMs` | 可选。默认 `success` / `info` 为 3200ms 自动消失；`error` 为 0，保持到用户关闭。 |
| `retry` | 可选。显示重试按钮；通常与 `error` 搭配。 |
| `onDismiss` | 自动消失或用户关闭时回调；调用方应清空消息状态。 |

`ErrorMessage` 是 `Toast` 的 `error` 别名，保留给既有调用点；新代码直接使用 `Toast` 并显式指定 `tone`。

## 3. 例外：以下内容不使用 Toast

这些信息是控件或区域状态的一部分，留在原位更利于定位与可访问性：

- **字段级校验**：表单未提交时的必填、格式、范围错误，贴着控件显示，并用 `aria-describedby` 关联；不要在提交前弹 Toast。
- **加载 / 空态 / 占位**：例如“正在读取…”“暂无日志”“终端不可用”“无法访问预览”。
- **数据内容**：任务运行 `errorMessage`、服务 `reasonCode`、文件冲突提示等属于记录或状态，不是操作反馈。
- **持久安全提示**：例如截图输入不被当前模型支持、审批已过期等需要持续可见的区域说明。
- **会话内轻量开关反馈**：输入框上方的模型切换、思考强度与联网搜索开关，沿用 Composer 上方的 10.5px 小字浮标（`absolute bottom-full`，4 秒后自动消失）。动作就发生在输入框内，视口顶部的 Toast 距离过远且会打断连续调整；不要迁到 Toast，也不要扩大成占位提示条。

判断标准：提示是否由一次用户动作产生、完成后即可消失？是则用 Toast；否则留在区域内。

## 4. 代码位置

- 组件：`packages/ui/src/toast.tsx`，由 `packages/ui/src/index.ts` 导出。
- 错误别名：`packages/ui/src/error-message.tsx`。
- 顶部滑入动画：`apps/web/src/styles/global.css` 的 `.toast-slide-in`；全局 `prefers-reduced-motion` 会关闭动画。
- 组件测试：`apps/web/src/components/common/Toast.test.tsx`。
- 会话内轻量开关的小字浮标：`apps/web/src/features/chat/Composer.tsx` 的 `switchNotice`（`absolute bottom-full`，4 秒后自动消失）。

## 5. 新功能检查清单

- [ ] 成功 / 失败反馈使用 `Toast`，没有新增占位提示条；
- [ ] 错误具备关闭或重试路径；
- [ ] 提示不遮挡主要操作、不抢焦点、不堆叠；
- [ ] `role="status"` / `role="alert"` 与关闭按钮标签正确；
- [ ] 字段校验和区域状态留在原位；
- [ ] 输入框内的开关类反馈沿用 Composer 小字浮标，没有另起提示条；
- [ ] 文案简短、中文、无秘密。

## 6. 迁移记录

- 2026-11-20：把联网搜索弹窗的局部 `Toast` 与 `ErrorMessage` 合并为 `@larness/ui` 的单一 `Toast`；`ErrorMessage` 变为 `error` 别名。
- 同日把终端打开结果、文件结果变化、配对错误、移动目录错误与快速打开搜索错误从行内提示迁到顶部 Toast；按人工验收反馈，模型切换与联网搜索开关保留输入框上方小字。
