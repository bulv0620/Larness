---
status: accepted
milestone: M2
---
# M2-27 Git 文件行补充动作
用户直接要求：更改保留暂存，新增放弃更改；已暂存新增取消暂存。依赖 M2-26/24b done，沿用必要校验、自行统一验收，不合并/push。

## 目标与非目标
未暂存文件行保留＋暂存，增加撤销图标放弃更改；已暂存文件行增加－取消暂存。放弃弹窗显示精确路径和后果，取消不请求写操作。已跟踪文件只恢复工作区到index，保留已暂存版本；未跟踪文件确认后删除该单文件。取消暂存只恢复index到HEAD，无首提交时仅移除index条目，保留工作区；重命名同时处理原路径的index。冲突/子模块/目录/符号链接拒绝放弃，不递归清理、不reset整个仓库、不新增Agent工具。

## 验收
- Given一个文件stage后再次修改，When放弃，Then工作区等于stage、stage内容保留；When取消暂存，Then工作区不变。
- Given新增已暂存/未跟踪文件（含无HEAD仓库），When取消暂存，Then保留文件并成为untracked；When确认放弃untracked，Then只删除目标文件。
- Given已删除文件，When放弃，Then从index恢复；特殊文件名/通配符按字面处理，路径越界和symlink/目录拒绝。
- Given操作创建后文件再次变化，When执行放弃，Then拒绝而不覆盖新内容；锁冲突/未认证/未确认拒绝，重复执行幂等。
- Given文件行，Then按staged状态显示对应动作，写入期间禁用；取消弹窗不写，成功刷新，失败保留提示。

## 接口/数据与安全
现有 GitActionSchema 增 unstage(paths[])、discard(path,confirmed:true)，复用鉴权/CSRF资源动作 prepare/execute、5分钟快照、项目写锁/fencing、审计/幂等。discard额外绑定目标文件内容哈希，准备和锁后执行重验；不只依赖porcelain状态。路径逐级拒绝符号链接/非普通文件，删除仅git clean -f精确字面单文件，无-d/-x；Git子命令无Shell，不给Agent注册新能力。无新REST路径/DB列/配置/依赖。默认不删除源码的规则由用户显式确认单文件放弃授权补充，见ADR-041。

## 失败和测试
读取/快照/锁失败关闭；外部编辑/任意进程仍非OS原子隔离，已开编辑器草稿保留、文件监听继续。先真实临时仓库/组件红测试，再实现，必要Git/Agent现有回归、受影响类型/Biome/diff。用户自行界面验收，不做全量check/build/E2E。
