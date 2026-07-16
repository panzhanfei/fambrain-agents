# brain-service 单元测试

生产代码在 `src/`；单元测试集中在本目录，按模块分子文件夹：

| 目录 | 覆盖 |
|------|------|
| `intake-coordinator/` | Intake 路由 / plan repair / path-plan |
| `knowledge-manager/` | KM 列举时间窗等 |
| `tool-orchestrator/` | 工具编排 / field-catalog |
| `tools/` | age / tenure / extract 等确定性工具 |

约定：

- 新单测放这里，**不要**再写到 `src/**/*.test.ts`
- 用 `@/` 导入被测模块（走模块 `index` 或已有公开路径）
- 跑：`pnpm test:unit`（根目录 vitest 已 include `apps/brain-service/tests/**/*.test.ts`）
