# dsh-yaya-diary

DSH 插件：**每天晚上 23 点，自动让娅娅读当天的会话记录，写一篇日记。**

## 它怎么工作

1. 宿主进程里每分钟跳一次（`setInterval(60_000)`，`unref`，随宿主退出自动清理）
2. 到点（默认 23 点）、今天还没写过 → spawn 一轮：
   ```
   dsh --profile headless "<写日记的提示词>"
   ```
   （Electron 的 node 跑 asar 里的 `bin.js`，`ELECTRON_RUN_AS_NODE=1`）
3. 那一轮里，娅娅会：
   - 跑 `E:\DS\娅娅日记\tools\collect-today.mjs` 拿今天的会话材料
   - 读 `E:\DS\AGENTS.md` 确认人设
   - 写 `E:\DS\娅娅日记\娅娅日记-<YYYY-MM-DD>.md`
4. 状态和日志：`~/.dsh/yaya-diary/state.json`、`~/.dsh/yaya-diary/diary.log`

## 设置页（client 半）

装好后，**DSH 设置 → 左侧导航「娅娅日记」** 一页：

- 今天写没写、上次运行时间、上次退出码、工作区
- 「现在写一篇」按钮（随时手动触发）
- 日记本列表（最近 12 篇）
- 最近日志尾部（调试用）

走 `/api/yaya-diary/status`、`/api/yaya-diary/run`、`/api/yaya-diary/log` 三个接口。

## 安装

手动安装（desktop profile 由 Electron 独占管理，CLI 装不进去）：

1. 目录联接：`profiles/desktop/node_modules/dsh-yaya-diary` → 本目录
2. `profiles/desktop/cordis.patch.yml` 末尾加：
   ```yaml
   - insert:
       - id: yaya-diary
         name: dsh-yaya-diary
         config:
           enabled: true
           hour: 23
           workspace: 'E:\DS'
           headlessProfile: headless
   ```
3. **重启一次 DSH 桌面版** 生效

## 配置（patch 里覆盖，全部有默认值）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `hour` | `23` | 几点写（0-23） |
| `workspace` | `E:\DS` | 那一轮的工作目录 |
| `dshBin` | 空 | 手动指定 `bin.js` 路径；不填自动推断 |
| `headlessProfile` | `headless` | 用哪个 profile 跑那一轮 |

## 边界

- 只在 **DSH 桌面版运行着** 的时候才会触发；桌面版没开，那一晚就跳过（不会补跑）
- 那一轮会消耗一次 LLM 调用的 token（读材料 + 写日记）
- 日记只写材料里真实发生的事，不编造
