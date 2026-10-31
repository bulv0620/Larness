# ADR-021: V1 使用 Passkey（WebAuthn）作为可信设备凭据

- 状态：accepted
- 日期：2026-10-31
- 决策者：用户（会话确认）
- 关联：ADR-002、ADR-006、ADR-016（被本 ADR 替代）、Q-001、[010-foundation spec](../../specs/010-foundation/spec.md)

## 背景

原 ADR-016 计划在 V1 使用 32 字节 opaque device token，Passkey 作为 P1。该方案实现简单，但长期 Token 是 bearer credential：一旦被复制即可重放，直到过期或被撤销；也无法抵抗钓鱼。

用户确认 V1 直接采用 Passkey。当前尚无实现与数据，迁移成本为零，适合在 M0 一次做对。

## 决策

1. `允许本次`（allow_once）：只签发短期浏览器会话，不注册 Passkey，不签发任何长期凭据。
2. `始终允许`（trust）：配对码兑换后必须完成 Passkey 注册，才创建可信设备与会话；**不签发长期设备 Token / Cookie**。
3. 会话过期或浏览器重启后，通过 Passkey assertion 换取新会话；**不提供 refresh token**。
4. Passkey 使用 WebAuthn：`residentKey: required`、`userVerification: required`、`attestation: none`；服务端只存公钥、credential ID、计数器与备份标志。
5. 一个工作空间只有一个 canonical origin / RP ID；开发用 `http://localhost:<port>`，生产用 HTTPS 域名。IP 地址（如 `127.0.0.1`）不能作为 RP ID，访问时明确提示不可用。
6. 设备撤销由本机 TUI 执行：作废 credential + 设备 + 关联会话，并断开 WebSocket。
7. 实现依赖 `@simplewebauthn/server` 与 `@simplewebauthn/browser`；版本在 M0-6 安装时锁定并记录。

## 备选方案

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 长期 opaque token（ADR-016） | 简单、兼容性最好 | 可重放、可钓鱼、需轮换与宽限 | 不采用 |
| Passkey + 长期 token fallback | 兼容旧浏览器 | fallback 削弱安全目标，双轨复杂 | 不采用；用 allow_once 覆盖临时访问 |
| 仅硬件安全密钥 | 抗同步、强绑定 | 门槛高、移动端不便 | 不采用；允许平台/漫游认证器 |
| Passkey + 强制 attestation | 可校验设备型号 | 生态复杂、隐私与兼容性差 | 不采用；attestation none |

## 影响

### 产品 / UI

- 配对页需要 Passkey 注册步骤；登录页需要 “使用 Passkey 登录”。
- 浏览器不支持 WebAuthn、或通过 IP / 非安全上下文访问时，只能 `允许本次`，并展示解释。
- 设备列表显示凭据类型、是否可同步（backup eligible）、最后使用时间；文案称“可信凭据 / 浏览器授权”，不承诺物理设备唯一。

### API / 契约

- 新增 `/api/webauthn/registration/{options,verify}`、`/api/webauthn/authentication/{options,verify}`。
- 删除 `/api/auth/refresh` 与 `harness_device` Cookie。
- `POST /api/pairing/redeem` 对 `trust` 返回 `passkey_required` + 短期 enrollment Cookie，不返回会话。

### 数据 / 迁移

- `trusted_devices` 移除 `token_hash` / `previous_token_hash`。
- 新增 `webauthn_credentials`、`webauthn_challenges`。
- `device_requests` 增加 enrollment 字段与 `enrollment_pending` 状态。
- 尚无生产数据，直接进入新 schema。

### 安全

- 抗钓鱼：凭据绑定 RP ID；挑战一次性、5 分钟；Origin 精确校验。
- 会话仍为短期 HttpOnly Cookie；CSRF / Origin / 限流不变。
- 同步型 Passkey 可跨设备使用，因此撤销与审计按 credential 粒度处理；不能宣称硬件绑定。
- 恢复：Passkey 丢失时经 TUI 撤销后重新配对；TUI 不可用则无法恢复（离线恢复码仍为 P1）。

## 风险

| 风险 | 缓解 |
|---|---|
| 浏览器 / 平台兼容性 | 目标矩阵实测；不支持时明确降级为 allow_once |
| RP ID / Origin 配置错误 | 初始化时推导并校验；doctor 检查；错误信息可操作 |
| 用户取消 / 超时 | enrollment 保留至 TTL，可重试；过期重新配对 |
| 同步 Passkey 被复制 | 展示 backup 标志；TUI 撤销；不承诺物理绑定 |
| SimpleWebAuthn 升级破坏 | 锁定版本；契约测试；升级需 ADR / 回归 |
| 认证器计数器异常 | 记录并审计；不因 0 计数拒绝同步凭据 |

## 验证

必须覆盖 010 spec 的 A4–A6、A9–A10、A16–A18：

- trust 配对必须完成 Passkey 才创建设备；
- 会话过期后 Passkey 登录成功；
- 错误 challenge / 过期 / 重放 / 错误 Origin 被拒绝；
- 撤销设备后 assertion 失败且 WS 断开；
- `allow_once` 不产生设备与 credential。

## 回滚

若 Passkey 方案被平台阻塞，需新增 ADR 才能回到 opaque token；当前无数据迁移负担。回滚必须同时恢复 `/api/auth/refresh`、设备 Cookie 与相应测试，不能只删前端步骤。
