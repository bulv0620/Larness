---
id: 032-default-workspace
status: active
milestone: M2
created: 2026-11-04
---
# M2-10 共享默认工作区

人类要求未选项目有默认工作区，并明确选择“所有未关联项目的新会话共享目录，旧独立会话保留原目录”。依赖 M2-9 done。

## 目标 / 非目标
未选项目可直接聊天、浏览 / 编辑文件、手动创建终端；新未关联会话、文件与终端共享稳定目录。左栏提供“默认工作区”入口，跨默认会话 / 草稿 / 刷新恢复同组窗口。旧独立会话和已运行终端不移动、不删除。默认目录复用既有全局终端的 dataDir/sessions/global-terminal/workspace，防止现有全局终端失去归属。具名项目仍使用登记根。
不创建伪项目、不登记源码目录、不自动搬移历史文件、不增加服务 / 预览 / Git / 自动部署。AI 的 project dev 启动仍按具名项目契约；默认终端支持已有输入 / 中断 / 读取 / 交接，保留审批。

## 验收场景
- Given 未选项目且无会话，When 打开，Then 默认工作区可直接输入，文件树和终端可用，无需登记项目。
- Given 新的两个未关联会话，When 创建，Then workspacePath 相同；已有文件保留；归档不删除共享内容。
- Given 旧独立会话，When 升级 / 打开，Then 原 workspacePath 与文件不变，视图不混入默认目录。
- Given 默认终端，When 切默认会话 / 草稿 / 项目再返回 / 刷新，Then 同一 terminalId，无隐式创建或终止。
- Given 授权客户端，When 通过 workspace:default 文件读写 / 订阅 / 补拉，Then 同根相同版本、共享 seq 与写锁；跨目录、配置 / 密钥、符号链接替换和未授权请求拒绝。
- Given 默认会话与默认 Shell，When Agent 经审批获取控制 / 输入 / 读取，Then 真实输出；项目 / 历史独立终端不能伪装为默认终端，人工持权不可抢。

## 接口 / 数据
FileScope 新增 { workspace: "default" }；GET /api/files?workspace=default&path=...，GET /api/workspaces/default/files；PUT 文件与 TerminalCreate.scope 接受同 schema。file resourceId workspace:default、streamId file:workspace:default。Session DTO / Web summary 增加 workspaceKind: project | default | session 以区分历史，不更改既有 workspacePath。新未关联会话写共享路径，无数据库迁移 / 新配置。session scope 指向共享根时规范化为 workspace:default 事件流与锁域。

## 安全 / 权限
既有鉴权 / Origin / CSRF、秘密扫描、相对路径、版本冲突、幂等 / 审计 / fencing 不变。只为精确默认根提供文件授权，不开放 dataDir 的其他目录；创建目录逐级检查非符号链接，根身份改变失败关闭。AI 按真实会话的授权根匹配终端，不凭 projectId=null 放行所有终端。历史目录不可迁移或自动清理。

## 失败与测试
目录不可用 / 被替换、未知 workspace、失效会话与跨根控制拒绝；建立共享目录失败不创建会话，事务失败不得清空共享目录。先写真实 API / 文件 / 旧记录保留 / PTY / UI scope 红测试；check / build、默认工作区真实浏览器、M2 相关回归与目视 QA，逐任务提交。
