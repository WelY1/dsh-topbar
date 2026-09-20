# DSH 顶栏会话指示器

在 Ubuntu / GNOME 顶栏显示 DeepSeek Harness 各会话的运行状态，一眼看清哪些任务在跑、哪些完成了、哪些在等你处理。

```
[ 活动 ][ Firefox 网络浏览器 ][ DSH插件实现Ubun… ][ 重建索引 ]      18:57
                                ↑ 灰=运行中          ↑ 绿=已完成
```

## 状态与颜色

| 颜色 | 含义 | 判定依据 | 实测 |
|---|---|---|---|
| 灰 `#8a8a8a` | 运行中 | session store `running === true` | ✅ |
| 绿 `#3fa34d` | 已完成（未确认） | session store `completed === true` | ✅ |
| 黄 `#e0a819` | 等待审批 / 等待回复 | host 侧 `approval/request` + `user-questions/request` waterfall | ✅ |
| 红 `#cc3b3b` | ~~出错~~ | **未实现**（见下方说明） | ❌ |

**黄色覆盖侧栏黄点的全部三种情况**：审批（approval）、向你提问等待回复
（`ask_user_question`）、计划评审（plan mode 的批准）——后两种在 host 侧都走
`user-questions/request` 这条 waterfall（计划评审由计划服务代理提问服务发出）。

**绿 ≠ idle。** `completed` 是侧栏那个绿色小圆点的同一语义：**跑完但你还没点开看过**。
点开会话（或它再次开始运行），绿块自动消失——不需要插件自己维护"已读"。

## 架构

```
浏览器页面 (client 半部)
   │  读 session store: running / completed
   │  心跳在 Web Worker 里，每秒 POST /dsh-topbar/state
   ↓
DSH host 半部 (dsh-topbar 插件)
   │  ← 同时监听 approval/request + user-questions/request，
   │    把待审批 / 待回复的会话标黄
   │  gdbus call org.dsh.Topbar.Push '<JSON>'
   ↓
GNOME Shell 扩展 (持有 org.dsh.Topbar 这个 D-Bus 名)
   │  渲染色块 + 像素截断 + 5 秒无推送自动清理
   ↓
GNOME 顶栏 _leftBox 末尾
```

### 为什么状态必须来自页面，而不是日志

`completed` 只活在内存里。源码注释（`dsh-api-session-controller/.../manager.js`）：

```js
/**
 * Sessions that finished running while not selected — the sidebar's green
 * "done" reminder (manager-owned, survives connection generations;
 * cleared on select and session-removed, re-armed by the next completion).
 */
completedNotifications = new Set();
```

它**从不写入会话日志**，所以任何读磁盘的方案都拿不到。只有页面能看见。

### 为什么黄色要由 host 侧提供

`pendingInteraction` 是 `dsh-cordis-client-runner` 注入的 **slot prop**，
不在 `sessions.list.getSnapshot()` 里——client 半部取不到（session store 的
投影里根本没有这个字段）。

而审批和提问在 host 侧都是 waterfall 事件：审批走 `approval/request`，
向你提问（`ask_user_question`）和计划评审走 `user-questions/request`，
两者都携带 `agent.id`（即 session id），host 监听后叠加到 client 上报的
快照上。所以黄由 host 判定。

**注意**：`approval/asked` 和 `approval/decided` 是 `session.append()` 写的**审计日志**，
不是 `ctx.emit()` 事件，**不能**用 `ctx.on()` 监听。能监听的只有两条 waterfall：
`approval/request` 和 `user-questions/request`。

### 黄色块的清除时机（重要）

审批 / 提问的 waterfall **在你回答的瞬间就 resolve 了**——通常只过了几秒。
如果在这里清除黄色，那么任何**起身离开过的人回来时都看不到**，提醒就失去意义了。

所以黄色**不在 waterfall settle 时清除**，而是：

| 时机 | 行为 |
|---|---|
| 审批 / 提问 / 计划评审弹出 | 变黄 ✅ |
| 你点击允许/拒绝或回答 | **仍然保持黄色**，dwell（默认 90 秒，可配置）从**点击时刻**重新计时 |
| dwell = `-1`（常驻模式） | 回答后黄色**不降级**，一直保持到该会话真正结束（变 done）或从列表消失 |
| dwell 期间 turn 结束（变 `done` 等） | 黄色 → 立即跟随真实状态 |
| dwell 期间会话恢复 `running` | **保持黄色**直到 dwell 到期（有意的：提醒要活到你看见） |
| 会话从会话列表消失 | 立即清除 |
| 一直不回答 | **一直黄**（没有时间上限——agent 被你阻塞着，就该黄着） |
| 页面关闭 | watchdog 清空顶栏 |

设计原则：**提醒必须活到你看见为止**。不用短超时自删。

## 配置（设置 → 插件 → 顶栏会话指示器）

设置卡片读写 `settings.yaml` 的 `dsh-topbar` 命名空间（host 用官方
`settings.installSection` 注册，卡片走 `/dsh-topbar/settings` bridge 读写）。
**改动 1 秒内生效**：配置随每次推送一同发往 GNOME 扩展，无需刷新任何界面。

| 配置 | 范围 | 默认 | 说明 |
|---|---|---|---|
| 字体大小 | 9~14 px | 11 | 标题文字字号（截断测量同步使用） |
| 标题最大宽度 | 60~400 px | 140 | 超出显示 `…` |
| 最大色块数 | 1~12 | 8 | 超出时优先保留：等待 > 运行 > 已完成 |
| 极简模式 | 开关 | 关 | 纯色小块（12px 方块），标题移入悬停提示 |
| 显示：运行中/已完成/等待中 | 开关 ×3 | 全开 | 关闭的状态不上顶栏 |
| 点击色块 | 无 / 打开网页 / 跳转到对应会话 | 无 | 见下 |
| 网页地址 / 应用地址 | http(s) URL | 空 | `打开网页` = 点击打开此地址；`跳转到对应会话` 时此字段作为应用基址，点击打开 `<基址>?open=<会话ID>`，页面加载后自动选会话 |
| 提醒保持 | -1 / 0~7200 秒 | 90 | `0` = 回答后立即跟随真实状态；`-1` = 常驻（见上表） |
| 自动安装 GNOME 扩展 | 开关 | 开 | DSH 启动时把扩展文件幂等同步到 `~/.local/share/gnome-shell/extensions/`（无需 sudo） |
| 自动重载 Shell | 开关 | **开** | 扩展文件变化时自动 `global.reexec_self()` 重载 Shell（仅 X11；Wayland 拒绝）——与 Alt+F2→r 等效，桌面短暂闪烁、窗口保持 |

改设置**不需要**重载 Shell/浏览器/重启 DSH；只有改这三个源文件才需要（见下）。

## 安装

本包即 npm 包根（`lib/ + extension/ + install.sh + cordis.patch.yml`）。三条路：

**A. npm（推荐，其他主机可一键装）**

```bash
# 仓库侧（一次）:
npm login                      # npm 账号（npmjs.com 注册）
npm publish --access public    # 包名 dsh-topbar（未被占用）
# 其他主机: DSH 插件管理粘贴 dsh-topbar 安装 → 重启 DSH → 扩展半部自动自装
```

**B. 离线 tar.gz**

```bash
cd dsh-topbar-dev && ./pack.sh        # 产出 dist/dsh-topbar-<ver>-bundle.tar.gz
# 目标主机:
mkdir dsh-topbar && tar xzf dsh-topbar-<ver>-bundle.tar.gz -C dsh-topbar && cd dsh-topbar
PROFILE_DIR=~/.dsh/profiles/<名字> ./install.sh register   # 幂等注册 + 装扩展
```

`register` 会：把包复制到 `<profile>/dsh-topbar/`（file: 依赖的源）、幂等修改
profile 的 `package.json`（依赖行 + `dsh.profile.bundles`）与 `cordis.patch.yml`、
安装 GNOME 扩展。可重复执行（升级同用）。

**C. 本机开发（当前 profile 的安装方式）**

```bash
# 在 dsh-topbar-dev 根（pack.sh 所在处）执行:
./pack.sh                                      # 或直接:
cp plugin-dsh/lib/*.js ~/.dsh/profiles/web/node_modules/dsh-topbar/lib/
cp plugin-dsh/extension/*.js ~/.local/share/gnome-shell/extensions/dsh-topbar@cf206.local/
```

插件本体通过 profile 的 `package.json` 注册（`dsh-topbar` 加入
`dsh.profile.bundles` + `dependencies`），**DSH 实际加载的是
`<profile>/node_modules/dsh-topbar/` 这份部署副本**；改源码不同步过去不生效。

### 改完代码要做什么

| 改了哪里 | 需要 |
|---|---|
| `extension/extension.js` | 同步到部署位置 + 重载 Shell：**Alt+F2 → `r` → 回车**（仅 X11） |
| `lib/index.js`（host） | **重启 DSH** |
| `lib/client.js`（client） | 浏览器**硬刷新** `Ctrl+F5` |

改 DSH 设置页里的配置项**都不需要**这些操作（随推送即时生效）。

GNOME 3.36 会缓存扩展模块，`disable`/`enable` 不会重新加载代码——必须重载 Shell。

## 已知限制

- **关闭浏览器标签页 → 顶栏清空。** 数据源是页面。心跳跑在 Web Worker 里，
  切到别的标签页、最小化窗口**不再**导致清空（Worker 定时器不受浏览器对
  隐藏标签页的节流影响）；只有真正**关闭标签页**（或标签页被 Chrome 因内存
  压力丢弃）才会清空。
- **红色未实现。** 原计划从 `turn/end` 的 `reason.kind == "error"` 取，
  实测该值确实存在（样本：133 completed / 6 aborted / 1 error），但未在运行中验证渲染。
  （早期尝试过 herald 的 `outcome` 字段——**不可用**：`exit 3` 的失败任务被记为 `outcome=ok`，
  且只有 job 粒度，与 session 粒度的标题无法关联。）
- **依赖 `gdbus` 二进制**（`/usr/bin/gdbus`）。
- **GNOME 3.36 专用**：扩展用旧式 GJS（`imports.gi`），不能在 GNOME 42+ 运行。
- 色块数量无硬上限；每个标题按 140px 像素截断，超出显示 `…`。
- 本机任意进程都可以 `POST /dsh-topbar/state` 伪造顶栏状态（路由无鉴权）。
  单用户本机场景下可接受，知悉即可。

## 源码内常量（改这些才需要重启/刷新）

`lib/index.js`（host）：

| 常量 | 默认 | 说明 |
|---|---|---|
| `CLIENT_STALE_MS` | `15000` | 页面多久没上报就清空顶栏 |
| `HEARTBEAT_MS` | `3500` | 内容未变时的最小推送间隔（必须小于扩展端 `STALE_MS`，否则色块会闪断） |

`lib/client.js`：

| 常量 | 默认 | 说明 |
|---|---|---|
| `PUSH_MS` | `1000` | 上报间隔（心跳在 Web Worker 里跑；无 Worker 环境回退定时器链） |

`extension/extension.js`：

| 常量 | 默认 | 说明 |
|---|---|---|
| `STALE_MS` | `5000` | 无推送多久后清空（cfg 未配置时的几何默认值也在此） |
| `COLORS` | 灰/绿/黄 | 调色板 |

## 调试

```bash
# 手动推一个快照（绕过页面，直接验证 D-Bus → 顶栏；cfg 缺省时用扩展端默认几何）
gdbus call --session --dest org.dsh.Topbar --object-path /org/dsh/Topbar \
  --method org.dsh.Topbar.Push \
  '{"ts":1,"sessions":[{"id":"a","title":"测试","state":"waiting"}],"cfg":{"fontSize":11,"maxLabelPx":140,"maxChips":8}}'

# 设置卡片背后的 bridge（助手/排查用）
curl -s http://127.0.0.1:3080/dsh-topbar/settings        # 读当前配置与 revision
curl -s http://127.0.0.1:3080/dsh-topbar/state -X POST -d '{"sessions":[]}'

# 扩展日志
journalctl _COMM=gnome-shell -f | grep dsh-topbar

# host 调试日志
DSH_TOPBAR_DEBUG=1 ./dsh
```

会话内可用诊断工具 `topbar_status`：上报状态、推送计数、当前配置与
扩展自装结果（`extInstall`）。

## 目录

```
dsh-topbar/                    ← npm 包根（本目录）
├── lib/
│   ├── index.js               host：路由 + 设置 + 审批/提问监听 + D-Bus 推送 + 扩展自装
│   └── client.js              浏览器：session store 上报 + 设置卡片
├── extension/
│   ├── metadata.json          GNOME 扩展清单（uuid / shell-version 3.36）
│   └── extension.js           GNOME 扩展：色块渲染 + cfg 应用 + D-Bus 服务
├── install.sh                 双半部安装/离线注册（ext|plugin|register|uninstall）
├── cordis.patch.yml           组合补丁
├── package.json               npm 清单（files 含 extension/ 与 install.sh）
└── README.md
```

开发/打包在包根上级：

```
dsh-topbar-dev/
├── plugin-dsh/                ← 上面的包（npm publish 从这里发）
├── pack.sh                    离线 tar.gz 打包 → dist/
├── tools/                     watch-bar.mjs / test-client.mjs 调试工具
└── dist/                      pack.sh 产物
```
