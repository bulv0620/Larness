# M5-1b 官方续跑 PoC（真实凭据）

> 生成时间：2026-11-07T09:32:47.242Z；数据目录：`/Users/bulv/Library/Application Support/larness`；密钥与推理正文未记录。

- model：deepseek-flash (DeepSeek-V4.1-Flash)
- 首次请求：200 finish=tool_calls tool=echo reasoning=0B
- 同轮续跑（回传 reasoning_content）：200 finish=stop content=80B
- 同轮续跑（省略 reasoning_content）：200 finish=stop
- 同轮续跑（reasoning_content 为空串）：200 finish=stop
- 跨轮（历史不带 reasoning）：200 finish=stop content=5B
- 流式适配器首步：reasoning=49B tool=echo
- 流式适配器续跑：finish=stop

## 说明

- 仅记录状态码、finish_reason、工具名与 reasoning 长度，不记录密钥、prompt 或推理正文。
- 同轮续跑分别验证回传 reasoning_content、省略与空串三种请求。
- 跨轮请求把上一轮 assistant 答复作为历史（不带 reasoning），验证是否仍可用。
