# 073 任务清单

| ID | 交付 | 依赖 | 状态 |
|---|---|---|---|
| RB-1 | 结果预算按总量分配：单字段可占约 14k，总量仍 ≤ 16k | — | `done` |
| RB-2 | `read_file` 字符分页：连续页、真实 `nextOffset`、摘要续读提示 | — | `done` |
| RB-3 | 命令输出头尾保留，不再丢弃尾部诊断 | — | `done` |
| RB-4 | 数据审查与验收回填（spec、STATUS、ROADMAP） | RB-1～RB-3 | `done` |

## 验收记录

### RB-1～RB-3（2026-11-12，macOS，本机）

- 数据：`read_file` 160 次，其中 15 次是「同一 Turn、同一路径、尚未修改该文件」的重复读（4 个 Turn；最典型一轮 `style.css` 在首次 patch 前读了 5 次）。根因是序列化器把每个字符串压到 4,000 字符、`nextOffset` 却指向请求范围末尾，模型再读也拿不到中部。
- RB-1：字段预算改为「总量 − 2,000」起步（14,000），超限阶梯减半、最多 6 次；总量仍 ≤ 16,000，JSON 始终合法。
- RB-2：`readTextFile` 新增 `maxChars`；`read_file` 传 12,000 字符，按整行切分，`truncated`/`nextOffset` 按实际返回行计算；摘要附「lines X–Y of Z, next offset=N」。单行超预算时截断该行并前进一行（`clipped` 计入 `truncated`）。
- RB-3：`boundedCommandOutput` 取代只留头部的截断，超 12k 时保留头 60% + 尾 40% 并标注省略字符数。
- 验证：`packages/agent` 57 通过 / 1 跳过；`test/agent` 120 通过 / 2 个既有环境失败（缺 PATH 上的 node/pnpm）；`apps/web` 168 通过；resources/agent/server typecheck 与改动文件 biome 通过。
- **夹具调整（非放宽断言）**：`compacts history into a checkpoint…` 的 `big.txt` 从 20,000 字符改为 4,000，因为单页上限从 4k 提到 12k 后原夹具会直接越过 hard 水位；断言仍要求 soft 水位与检查点内容。
- **未运行**：完整 `pnpm check`（本机无 pnpm）。
