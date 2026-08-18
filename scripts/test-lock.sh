#!/usr/bin/env bash
# test-lock.sh — SA6 建立的测试策略锁（greenfield 基线，Issue #3 VFSL v1 parser）
#
# 当前测试策略：
#   - 运行时：node（vitest），纯函数单测，无端口、无外部服务依赖
#   - 被测包：@nomicore/vfsl（packages/vfsl），零运行时依赖
#   - 构建前置：pnpm --filter @nomicore/vfsl run build（SA2 攻击点 1 / 设计 §13.1 路径 A——
#     pnpm exec 直接运行 vitest 二进制、不触发包 test 脚本，须先显式 build 产出 dist 供 exports 解析）
#   - 执行入口：pnpm --filter @nomicore/vfsl exec vitest run
#   - 状态：绿灯基线 —— 公共接缝 parseVfsl 已实现，4 个测试套件全绿为预期
#
# 后续 SA 若新增测试包或端口依赖，须同步更新本文件的策略声明。
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm --filter @nomicore/vfsl run build && pnpm --filter @nomicore/vfsl exec vitest run
