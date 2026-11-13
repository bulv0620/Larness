# ADR-060 本机预览默认开启

- 状态：accepted，2026-11-13 用户直接确认。
- 关联：[ADR-043](ADR-043-development-preview-authorization.md)、[M3-12](../../specs/040-services-preview/spec.md#m3-12-本机预览默认开启)。

原默认配置允许新实例登记服务，但关闭了网关，点击预览会收到 `PREVIEW_DISABLED`。新配置及省略该字段的配置中，`preview.enabled` 默认取 `true`。

网关继续监听本机回环地址，默认端口为 3211，采用独立来源、鉴权票据和已登记服务的监听归属检查。端口绑定失败时，管理端继续启动并记录警告。

继续要求手动开启会让新实例可以登记服务却无法预览。批量覆盖旧文件会抹去显式关闭的设置。读取现有配置时遵循其显式值，无需迁移。需要关闭时，将 `preview.enabled` 设为 `false` 后重启。
