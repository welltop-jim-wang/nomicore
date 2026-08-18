# mabf-poller 多仓库监控说明

mabf-poller 是 MABF 流水线的轮询调度组件。本文档说明其多仓库监控、事件发现与任务派发机制。

## 1. 多仓库监控 (Multi-repo monitoring)

mabf-poller 同时监控 (multi-repo) 多个仓库：除原有的 `film-studio-fe` 外，
现已纳入对本仓库的监控。poller 周期性轮询多仓库监控清单中每个被监控仓库的状态。

## 2. 事件发现 (Event-watch discovery)

mabf-poller 通过 event-watch 机制发现新任务 / 新事件。当被监控仓库产生待处理事件时，
event-watch 负责检测 (detect) 并上报，使 poller 能够及时发现 (discover) 待派发的工作项。

## 3. 任务派发 (Dispatch to idle issue-runner machines)

发现新任务后，mabf-poller 将任务派发 (dispatch) 给空闲 (idle) 的 issue-runner 机器执行。
调度策略确保任务只派发给当前空闲的 issue-runner，避免对繁忙机器重复派发。
