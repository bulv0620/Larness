---
id: 035-default-project
status: active
milestone: M2
created: 2026-11-04
---
# M2-13 固定默认项目
人类明确默认工作区也是项目，且不能修改和删除；依赖 M2-12 done，替代 032 中独立默认入口的展示决定。

## 目标 / 非目标
默认工作区是内建系统项目，固定名“默认工作区”、固定目录、固定 ID prj_default，在项目列表置顶，与普通项目同层可折叠、搜索、新建和选择会话；无修改 / 移除菜单。服务端项目列表 / 详情返回 kind=default 的真实默认目录描述，PATCH / DELETE 在后端拒绝，包括设置修改；普通项目 CRUD 不变。默认目录禁止重复登记为普通项目。
保留现有默认目录、projectId=null 的默认会话和终端、workspace:default 文件事件 / 锁及 global 窗口身份，不搬移数据，不改写历史独立会话；内建项目是固定资源描述，不创建可删除的用户登记记录。项目属性不可改不等于内容只读。
不扩展 M3 服务 / Git / Agent dev 启动范围，不改变输入审批。

## 验收
- Given 无普通项目，When 打开 / 刷新，Then 项目组内已有默认项目，无单独游离入口或“还没有登记项目”；可展开和新建会话。
- Given 默认项目，When 右键，Then 无修改 / 移除操作；普通项目仍有。
- Given 已认证客户端，When 直接 PATCH 名称 / 设置或 DELETE prj_default，Then FORBIDDEN，目录 / 文件 / 会话保持，未授权请求仍 401。
- Given 默认项目 API，When 查询列表 / 详情 / 以其 ID 创建会话或访问文件，Then 指向原共享根、旧数据可见、精确根授权不扩大；终端仍共享旧身份。
- Given 默认会话和终端，When 切普通项目并返回 / 刷新，Then 原 ID / 内容恢复，不重复创建。

## 接口 / 数据
Project DTO 与 Web Project 增加可选 kind=project|default；GET /api/projects 默认项目置顶，GET /api/projects/prj_default 返回固定描述。POST sessions 的 prj_default 归一到既有默认会话。FileScope.projectId=prj_default 归一到 workspace:default；终端创建同样归一。原 workspace API / WS stream 继续作为默认资源身份；UI 导航默认仍用兼容 null。不修改 DB schema / 数据。

## 安全 / 边界
新增 ADR-034 记录人类授权的内建项目。不可变保护在项目服务层；默认根逐级拒绝 symlink，项目 alias 只归一到既有精确默认授权，不能用默认 ID 读取 dataDir 其他内容。别名拒绝跨项目 sourceSession，输入审批 / 租约 / 幂等不变。目录不可用失败关闭，不伪造项目目录。保留普通项目、旧独立会话和默认资源身份。

## 测试
先默认项目列表 / 不可变 API 红测试；默认别名文件 / session 与 terminal 真实测试。UI 默认项目与普通项目操作差异、搜索 / 折叠和既有默认会话 / 文件 / PTY E2E；check / build / Demo / 相关真实浏览器，更新契约与状态，提交。
