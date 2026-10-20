# dsh-topbar

<div align="center">
  <b style="font-size: 1.15em;">把 DSH 每个会话的运行状态，搬到 GNOME 顶栏上</b><br /><br />
  <a href="https://www.npmjs.com/package/dsh-topbar"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-topbar" /></a>
  <a href="https://gitee.com/We1YI/dsh-topbar"><img alt="gitee" src="https://img.shields.io/badge/gitee-We1YI%2Fdsh--topbar-4d6bfe" /></a>
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <img alt="GNOME 3.36-48" src="https://img.shields.io/badge/GNOME-3.36%20%7C%2044%20%7C%2048-4d6bfe" /><br /><br />
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="支持的 DSH 版本：0.1.1-rc.1+，含 0.2.0-rc.2" src="https://img.shields.io/badge/DSH-0.2.0--rc.2-4d6bfe" /></a>
  <a href="https://gitee.com/We1YI/dsh-topbar/tags"><img alt="最新版本" src="https://img.shields.io/badge/%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC-v0.5.0-4d6bfe" /></a><br /><br />
  <img alt="灰=运行中" src="https://img.shields.io/badge/---8a8a8a" /> <img alt="绿=已完成未确认" src="https://img.shields.io/badge/---3fa34d" /> <img alt="黄=等待回复或审批" src="https://img.shields.io/badge/---e0a819" /><br /><br />
  <code>[ 活动 ][ Firefox ][ 当前ros2的流程是… ][ 重建索引 ]</code><br />
  <i>↑ 每个会话一个色块，紧挨时钟，最要事的排最左</i>
</div>

<div align="center">
  ✅ <b>GNOME 3.36 \~ 48</b>：安装扩展时自动探测 <code>gnome-shell --version</code> 并选对应变体 · 详见 <a href="#️-平台支持">平台支持</a>
</div>

## 📑 目录

- [✨ 功能一览](#-功能一览)
- [🚀 安装](#-安装)
- [🎨 状态与颜色](#-状态与颜色)
- [⚙️ 配置](#️-配置)
- [🧩 子智能体与分叉对话](#-子智能体与分叉对话)
- [🆕 最近更新](#-最近更新)
- [🛠️ 工作原理](#️-工作原理)
- [🐛 排障](#-排障)
- [🖥️ 平台支持](#️-平台支持) · [⚠️ 已知限制](#️-已知限制) · [🔐 安全](#-安全)
- [🧑‍💻 开发](#-开发) · [📄 许可证](#-许可证)

## ✨ 功能一览

- **🟦 三态色块**：灰=运行中、绿=已完成未确认、黄=等待回复/审批，一眼看清哪些在跑、哪些跑完了、哪些卡在等你
- **🟨 审批与提问即变黄**：审批、`ask_user_question`、计划评审三种「需要你」的情况统一标黄，且**提醒活到你看见为止**——回答后仍按可配置的 dwell 保持，不会几秒就消失
- **🟩 分叉对话照常显示**：DSH 的「分叉对话」与「子智能体」在 header 里都写 `parentSession`，本插件按 `origin` 正确区分（见 [子智能体与分叉对话](#-子智能体与分叉对话)）
- **👥 子智能体活动上卷**：子智能体自己不出块（不刷屏），但它运行时会让所属会话保持灰色——父 turn 结束后依然看得见
- **🪟 多页面并集**：同时开多个 DSH 标签页/浏览器时按「等待 > 运行 > 完成」取并集，不再互相覆盖导致闪烁或黄标丢失
- **⚙️ 配置界面在插件自己的页面**：侧边栏 **插件 → 已安装 → dsh-topbar → 查看**，在插件详情页上直接调字号、宽度、色块上限、极简模式、显示哪些状态、点击行为、提醒时长；改完 1 秒内生效
- **🖱️ 点击色块直达**：可配置为打开 DSH 网页、跳转到对应会话（`?open=<id>` 深链），浏览器可选
- **🔧 自装自愈**：DSH 启动时把 GNOME 扩展幂等同步到 `~/.local/share/gnome-shell/extensions/`（无需 sudo），X11 下文件变化自动重载 Shell
- **🩺 自带诊断**：会话内 `topbar_status` 工具可查上报状态、推送计数、当前配置与扩展自装结果

## 🚀 安装

**前置**：已装好 DSH（`dsh web` 能跑）、Node.js ≥ 20、Ubuntu 20.04 / GNOME 3.36、系统中存在 `/usr/bin/gdbus`。

**支持的 DSH 版本**：

<a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="支持的 DSH 版本：0.1.1-rc.1+，含 0.2.0-rc.2" src="https://img.shields.io/badge/DSH-0.2.0--rc.2-4d6bfe" /></a>

`engines.dsh` 声明 `>= 0.1.1-rc.1`。逐版核对过、所依赖契约一致的版本：

| DSH 版本 | 状态 |
|---|---|
| 0.1.1-rc.1 / 0.1.1-rc.2 | compatible |
| 0.1.2-alpha.2 / 0.1.2-alpha.5 | compatible |
| 0.1.5-rc.1 / 0.1.5-rc.2 | compatible |
| **0.2.0-rc.2** | compatible（本机实测版本） |

> 📌 本插件只用到三处 DSH 契约：**会话列表投影**（`running` / `origin` / `parentId`）、**客户端 UI 状态服务** `uiSession.sessionStatus`（完成提醒走它的 `completionUnread`）、以及 **host 侧两条 waterfall**（`approval/request`、`user-questions/request`，只用于黄色）。
>
> ⚠️ **从 0.2.0-rc.2 起有两个破坏性变更**，v0.4.8 已相应迁移：`SessionSummary.completed` 被删除（绿灯改读 `sessionStatus.completionUnread`）；插件配置页的 slot 与设置命名空间被重构（见 [配置](#️-配置)）。其余真正挑版本的是 **GNOME 侧**（见 [平台支持](#️-平台支持)），不是 DSH。

### 方式一：npm（推荐）

```sh
dsh plugin --profile web add dsh-topbar
```

装完**硬刷新浏览器**（`Ctrl+F5`）。GNOME 扩展半部由插件自动安装，X11 下会自动重载一次 Shell（桌面短暂闪烁，窗口保持）。

### 方式二：离线 tar.gz（无 npm 网络时）

```sh
mkdir dsh-topbar && tar xzf dsh-topbar-<版本>-bundle.tar.gz -C dsh-topbar && cd dsh-topbar
PROFILE_DIR=~/.dsh/profiles/<名字> ./install.sh register
# 重启 DSH，硬刷新浏览器
```

`register` 幂等：把包复制到 `<profile>/dsh-topbar/`、改 `package.json`（依赖 + `dsh.profile.bundles`）与 `cordis.patch.yml`、安装 GNOME 扩展。升级重复执行即可。

### 方式三：让 DSH 自己装

把下面这段发给任意一个 DSH 会话：

```text
帮我安装 dsh-topbar 插件（DSH 顶栏会话指示器）：
1. 执行 dsh plugin --profile web add dsh-topbar
2. 装完提醒我硬刷新浏览器（Ctrl+F5）
3. 如果顶栏没出现色块，帮我查 topbar_status 工具的输出
本插件支持 GNOME 3.36\~48，扩展会按 gnome-shell --version 自动选变体；装完如果顶栏没动静，帮我看看 topbar_status 里的 extInstall。
```

## 🎨 状态与颜色

| 颜色 | 含义 | 判定依据 |
|---|---|---|
| 灰 `#8a8a8a` | 运行中 | `sessionStatus.running ?? SessionSummary.running` |
| 绿 `#3fa34d` | 已完成、**未点开确认** | `sessionStatus.completionUnread === true` |
| 黄 `#e0a819` | 等待你回复 / 审批 | host 侧 `approval/request` + `user-questions/request` |
| 红 | 出错 | **未实现**（见 [已知限制](#️-已知限制)） |

**绿 ≠ 空闲。** 绿块是侧栏那个「跑完但你没点开看」的绿点：点开会话、或它再次开始运行，绿块自动消失——插件不自己维护「已读」。

**黄块活到你看见为止。** 审批 / 提问的 waterfall 在你回答的瞬间就 resolve 了（通常几秒）。如果那时就清黄，任何起身离开过的人回来都看不到，提醒就失去意义。所以黄色**不在 settle 时清除**，而是按 dwell 计时（见 [配置](#️-配置)）。

| 时机 | 行为 |
|---|---|
| 审批 / 提问 / 计划评审弹出 | 变黄 ✅ |
| 你点允许/拒绝或回答 | 仍保持黄色，dwell 从**点击时刻**重新计时 |
| dwell = `0` | 回答后立即跟随真实状态 |
| dwell = `-1`（常驻） | 一直黄到该会话真正结束或从列表消失 |
| 一直不回答 | **一直黄**（agent 被你阻塞着，就该黄着） |
| 会话从列表消失 | 立即清除 |

## ⚙️ 配置

**侧边栏 → 插件 → 已安装 → `dsh-topbar` → 查看**，配置表单就渲染在这个插件详情页上（描述下方、「包含的组件」上方）。

> 📌 **不在「设置」里。** DSH 0.2.0-rc.2 把「设置 → 插件」改成了只读清单，插件配置迁到了侧边栏的 Plugins 页。本插件 v0.4.8 起注册到 `plugins.bundle.config`，表单由宿主渲染（`configForms` 服务），**只有点「保存」才写入**。
>
> ⚠️ **升级注意**：设置命名空间已从 `dsh-topbar` 改为 profile 条目 id `topbar`，旧版写在 `settings.yaml` 里的 `dsh-topbar:` 一节**不会自动迁移**，需在新表单里按需重设一次（各字段默认值与原先一致）。

配置随每次推送一同发往 GNOME 扩展，**改动 1 秒内生效**，不需要重启 DSH 或重载 Shell。保存后的值落在这个 profile 的 `cordis.patch.yml` 中本插件条目（`- id: topbar`）的 `config:` 下。

| 配置 | 范围 | 默认 | 说明 |
|---|---|---|---|
| 字体大小 | 9\~14 px | 11 | 标题文字字号（截断测量同步使用） |
| 标题最大宽度 | 60\~400 px | 140 | 超出显示 `…` |
| 最大色块数 | 1\~12 | 8 | 超出时优先保留：等待 > 运行 > 已完成 |
| 极简模式 | 开关 | 关 | 纯色小块（12px 方块），标题移入悬停提示 |
| 显示：运行中/已完成/等待中 | 开关 ×3 | 全开 | 关闭的状态不上顶栏 |
| 子智能体 | 上卷 / 完全隐藏 | 上卷 | 见下节 |
| 点击色块 | 无 / 打开网页 / 跳转到对应会话 | 无 | 跳转会打开 `<应用地址>?open=<会话ID>` |
| 跳转浏览器 | 默认 / Firefox / Edge / Chrome / Chromium / 自定义 | xdg-open | Firefox 以 `--new-tab` 进已运行实例的新标签页 |
| 网页地址 / 应用地址 | http(s) URL | 空 = 自动 | **可留空**：自动用本机 DSH 网页地址（host 从 webServer 端口推导） |
| 提醒保持 | -1 / 0\~7200 秒 | 90 | `0` = 回答后立即跟随真实状态；`-1` = 常驻 |
| 自动安装 GNOME 扩展 | 开关 | 开 | 幂等同步到 `~/.local/share/gnome-shell/extensions/` |
| 自动重载 Shell | 开关 | 开 | 扩展文件变化时自动 `global.reexec_self()`（仅 X11） |

## 🧩 子智能体与分叉对话

顶栏只反映**顶层会话**。DSH 里两类「有父会话」的会话必须分开对待，判据是 header 的 `origin`，**不是** `parentId`：

| 类型 | `parentSession` | `isSeeded` | `origin` | `delegationDepth` | 上不上顶栏 |
|---|---|---|---|---|---|
| 子智能体 | 有 | false | `'subagent'` | 1 | 自己不出块 |
| **分叉对话** | **有** | **true** | **缺省** | **0** | **正常出块** |

`parentId` 投影自 `parentSession`，而分叉会话同样会写 `parentSession`（种子血缘，语义是「从哪个会话分叉而来」）。**用 `parentId` 当「是不是子智能体」的判据，会把每一个分叉对话静默丢弃**——会话在跑，顶栏却无色块（0.4.3 及更早）。

**子智能体的活动如何影响顶栏**：

- **上卷到所属会话**（默认）——子智能体运行中时，沿 `parentId` 一路上溯，把它所属的顶层会话点亮成灰色。子智能体自己**永远不出块**，所以不刷屏。上溯是传递的：孙智能体在跑，整条祖先链都亮着。
- **完全隐藏**——子智能体既不出块，也不影响任何会话（0.4.3 及更早的行为）。

上卷解决的是一个真实盲区：子智能体的 `running` 属于**子**会话，而父会话的 turn 可能已经结束（continuable 子智能体活过父 turn），此时顶栏曾经完全静默。正常委派时父 turn 未结束、父块本来就是灰的，所以这个盲区平时看不出来。「运行中」优先于「已完成」：父会话已绿但子智能体还在跑时，色块转灰。

## 🆕 最近更新

完整历史见 [gitee tags](https://gitee.com/We1YI/dsh-topbar/tags)。

### v0.5.0

从「GNOME 3.36 专用」扩到 **3.36\~48**，靠按 Shell 版本自动选变体。

- ✨ **扩展拆成双变体**：`extension/legacy/`（旧式 `imports.*` GJS，覆盖 3.36\~44）与 `extension/modules/`（ESM `import`，覆盖 45+）。GNOME 45 移除了扩展可用的 `imports.*` 接口，同一份文件无法两边都跑，所以拆成两份；两者渲染主体逐行相同，只差 import 头与生命周期壳（legacy 的 `init/enable/disable` ↔ ESM 的 `export default class … extends Extension`）。**每个变体目录各自是完整单文件**，部署目录内不会引用缺失的同级文件
- ✨ **运行时自动识别**（不是 npm install 钩子）：`lib/index.js` 的 `selfInstallExtension()` 在拷贝前跑 `gnome-shell --version` 解析主版本，≤ 44 装 legacy、≥ 45 装 modules；探测失败或版本超范围时**装 legacy 并打印明确警告**（stderr + `topbar_status.extInstall.message`），不静默装错。`install.sh` 的 `install_ext()` 用同一套规则（bash 侧）
- 📦 **metadata 按变体分开**：`legacy` 声明 `["3.36","3.38","40","42","44"]`，`modules` 声明 `["45","46","47","48"]`；变体自身声明的版本集合就是它会被加载的集合
- 🔁 **换版自动换面**：部署的变体名记在 `state.extInstall.variant` 里，Shell 升级跨过 45 后重新挂载会重新探测并重装对应变体
- 📖 **README 补 GNOME 兼容矩阵**（逐主版本 ↔ 变体 ↔ 实测/推断）与 **Wayland 说明**：`Alt+F2` → `r` 在 Wayland 不可用，需 `gnome-extensions enable`（45+）或注销重登（3.36+Wayland 只能注销重登）
- 🔢 版本 0.4.9 → 0.5.0

### v0.4.9

- 🐛 **修 v0.4.8 的依赖声明错误**：v0.4.8 把 schemastery 改成了 **peer-only**。在「只装了本插件」的干净 profile 上没有任何包提供它，导入直接失败：

  ```
  ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'
  ```

  实测对照（新建一个只含本插件的临时 profile）：无提供者 → ❌ 导入失败；配合一份嵌套的 3.18.4 → ✅ 导入成功、14 个字段全 volatile。因此改回 **`dependencies: "^3.18.4"`**。
- 📌 **要修的是版本下限，不是依赖形态**：`^3.18.1` 装出来的 3.18.1 没有 `.volatile()`，才是 `failed to import` 的根因；下限提到 `^3.18.4` 即解决。这也是生态通行做法——本机 profile 里 20 个插件中 **17 个**把 `^3.18.4` 写成普通依赖，peer-only 只有两个第三方包。

### v0.4.8

适配 DSH **0.2.0-rc.2** 的两处破坏性变更；v0.4.3 及更早在这版 DSH 上**配置页会整个消失、绿块永不出现，且没有任何报错**。

- ✨ **配置页迁到侧边栏 Plugins 页**：新 DSH 删除了旧的 `settings.plugin.item` slot（连同 `settings.installSection`），旧版注册进去的是一个**已不存在**的 seam，失败还被 `try/catch` 静默吞掉。现改为注册 `plugins.bundle.config`，表单交给宿主渲染
- 🐛 **绿灯恢复**：`SessionSummary.completed` 被删除，原先读它取「已完成未确认」恒为假。改读客户端状态服务 `uiSession.sessionStatus.completionUnread`——与侧栏绿点同一个源。相应地客户端半部必须在 `dsh.client.inject` 里声明 `uiSession`，否则服务不可达
- 🐛 **修 `topbar (dsh-topbar): failed to import`**：`@deepseek-ai/schemastery` 原为普通依赖 `^3.18.1`，pnpm 会在包内嵌一份 3.18.1 盖住宿主的 3.18.4；而配置表单需要的 `.volatile()` 直到 3.18.4 才有，于是**模块求值期**抛 `TypeError`，整条插件不激活。**版本下限**才是根因（v0.4.9 定了最终做法）
- 📦 设置命名空间改为 profile 条目 id（`topbar`），`Config` 需导出且**全部字段声明 `.volatile()`**，否则该条目根本不会出现在 `settings.describe()` 里
- 📖 README 同步更新配置入口、状态判定依据与 DSH 版本矩阵

> ⚠️ **旧的 `settings.yaml` 里 `dsh-topbar:` 一节不会迁移**，升级后需在新表单里重设一次。

### v0.4.6

- 📦 **补全 npm 元数据**：`repository` / `homepage` / `bugs` / `keywords`，包页面补上源码与问题反馈入口
- 📖 **重写 README**：按插件生态惯例重排，补 DSH 版本适配矩阵、GNOME 平台约束、dwell 时机表、子智能体判据表

### v0.4.5

- 🐛 **分叉对话不再被当作子智能体滤掉**：顶栏过滤子智能体改用 `origin` 判据。原先用 `parentId`，而分叉对话同样会写 `parentSession`（种子血缘，非父子从属），于是每个分叉对话被静默丢弃——会话明明在跑，顶栏却一个色块都没有
- ✨ **子智能体活动上卷到所属会话**：子智能体运行中沿 `parentId` 上溯点亮顶层会话（传递，孙智能体点亮整条祖先链）。新增「子智能体」设置项：上卷到所属会话 / 完全隐藏。解决「子智能体活过父 turn」时顶栏完全静默的盲区
- 🐛 **点击行为下拉选中 `openSession` 存不下来**：`buildOps` 的两值归一把 `openSession` 并进了 `none`，两侧归一后相等、不产生 op，选择被静默丢弃。改用同一份白名单归一
  - 注：这不是「改其它字段会冲掉已存的 `openSession`」——草稿是存储值的副本，未改动时两侧归一相同，不发 op

### v0.4.3 及更早

- 多页面心跳合并视图（消除多开页面导致的闪烁与黄标丢失）、点击行为下拉修复、应用地址可留空、跳转浏览器可选、极简模式零高度修复、待审批标记刷新窗口误删

## 🛠️ 工作原理

```
浏览器页面（client 半部）
   │  读 session store: running / origin / parentId
   │  读 uiSession.sessionStatus: completionUnread（绿）
   │  心跳在 Web Worker 里，每秒 POST /dsh-topbar/state
   ↓
DSH host 半部（dsh-topbar 插件）
   │  合并多页面上报（等待 > 运行 > 完成）
   │  同时监听 approval/request + user-questions/request，把待审批/待回复标黄
   │  gdbus call org.dsh.Topbar.Push '<JSON>'
   ↓
GNOME Shell 扩展（持有 org.dsh.Topbar 这个 D-Bus 名）
   │  渲染色块 + 像素截断 + 5 秒无推送自动清理
   ↓
GNOME 顶栏 _leftBox 末尾
```

**为什么完成状态必须来自页面，而不是日志**：`completionUnread` 是客户端 UI 状态服务里的内存事实（「跑完了、但你没点开确认」），**从不写入会话日志**，所以任何读磁盘的方案都拿不到，只有页面能看见。它与侧栏那个绿点同源；host 侧即便拿到会话列表也看不到它。

**为什么黄色要由 host 侧提供**：`pendingInteraction` 是 UI slot prop，不在 `sessions.list.getSnapshot()` 里；而审批和提问在 host 侧都是 waterfall 事件，监听后叠加到页面上报的快照上。

> ⚠️ `approval/asked` / `approval/decided` 是审计日志写入，**不是**可监听事件。能监听的只有上面那两条 waterfall。

## 🐛 排障

<details>
<summary><b>常见问题</b></summary>

| 现象 | 原因与解决 |
|---|---|
| 顶栏完全没有色块 | ① 最常见：**没有打开 DSH 网页**，或标签页被关闭——数据源是页面，关掉就清空。② 跑 `topbar_status` 看 `clientLive` 与 `clientDiag`。 |
| 会话在跑但没色块 | 检查它是不是**子智能体**（子智能体默认不上自己的块）或**分叉会话**（0.4.3 及更早会被漏掉，请升级）。 |
| 装完不生效 | client 半部要**硬刷新浏览器**（`Ctrl+F5`）；host 半部要**重启 DSH**；扩展半部要**重载 Shell**（X11：`Alt+F2` → `r`）。 |
| 改了 `lib/index.js` 没反应 | host 半部是 DSH 进程里跑的，**必须重启 DSH**。 |
| 改了 `extension/*/extension.js` 没反应 | GNOME 3.36 会缓存扩展模块，`disable`/`enable` 不会重新加载代码——**必须重载 Shell**；Wayland 下只能注销重登（见 [Wayland 说明](#wayland-说明)）。 |
| Shell 没自动重载 | 「自动重载 GNOME Shell」只在 **X11** 生效；Wayland 会被拒绝，需手动注销重登（Wayland 下 `Alt+F2` → `r` 也无效）。 |
| 报 `gdbus: not found` | 扩展半部依赖 `/usr/bin/gdbus`，装 `glib2` 相关包或调整 `GDBUS` 路径。 |
| 扩展没被启用 | 插件会写 `enabled-extensions`；若 dconf 不可用会跳过，手动在「tweaks」或 `gsettings` 里启用 `dsh-topbar@cf206.local`。 |
| 点了色块没反应 | 「点击色块」是「无操作」。想要跳转需在插件配置页（插件 → 已安装 → dsh-topbar → 查看）里选「跳转到对应会话」，且「应用地址」可留空自动推导。 |
| 升级 DSH 后配置页消失 / 绿块不出现 | 0.2.0-rc.2 的两处破坏性变更所致，升到 **v0.4.9+** 即可（配置页与绿灯本身自 v0.4.8 起就修好了，但 v0.4.8 的依赖声明有误，见 [最近更新](#-最近更新)）。若启动日志出现 `topbar (dsh-topbar): failed to import`，基本是 schemastery 版本漂移（见 [开发](#-开发)）。 |

</details>

<details>
<summary><b>手动排查命令</b></summary>

```sh
# 手动推一个快照，绕过页面直接验证 D-Bus → 顶栏
gdbus call --session --dest org.dsh.Topbar --object-path /org/dsh/Topbar \
  --method org.dsh.Topbar.Push \
  '{"ts":1,"sessions":[{"id":"a","title":"测试","state":"waiting"}],"cfg":{"fontSize":11,"maxLabelPx":140,"maxChips":8}}'

# 确认 host 半部已挂载（405 = 路由存在，只接受 POST）
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/dsh-topbar/state

# 扩展日志
journalctl _COMM=gnome-shell -f | grep dsh-topbar

# host 调试日志
DSH_TOPBAR_DEBUG=1 ./dsh
```

</details>

会话内还可用诊断工具 `topbar_status`：上报状态、推送/失败计数、当前配置、子智能体计数与扩展自装结果。

## 🖥️ 平台支持

| 维度 | 支持情况 |
|---|---|
| **GNOME** | **3.36 \~ 48**，安装时自动探测选变体（见下表） |
| 显示服务器 | X11 与 Wayland 都能用；仅「自动重载 Shell」限 X11。 |
| 发行版 | 任何 GNOME 3.36+ + 已装 `gdbus` 的 Linux 均可。 |
| 其他桌面 | 不支持（依赖 GNOME Shell 顶栏扩展机制）。 |
| Node.js | ≥ 20 |

### GNOME 版本兼容矩阵

GNOME 45 移除了扩展可用的旧式 GJS 接口（`imports.*`），因此本包内置**两个变体**，安装扩展时读 `gnome-shell --version` 决定装哪个：

| GNOME 主版本 | 发行版参考 | 变体 | 状态 |
|---|---|---|---|
| 3.36 | Ubuntu 20.04 / Debian 11 | `extension/legacy/`（`imports.*`） | ✅ **实测**（本机 3.36.9 X11） |
| 3.38 | Ubuntu 20.10 | `legacy` | 🟡 推断支持（同一 GJS 接口，未实机验证） |
| 40 / 41 | Ubuntu 21.04 / 21.10 | `legacy` | 🟡 推断支持（未实机验证） |
| 42 / 43 / 44 | Ubuntu 22.04 / 22.10 / 23.04 | `legacy` | 🟡 推断支持（未实机验证） |
| 45 / 46 | Ubuntu 23.10 / 24.04 | `extension/modules/`（ESM） | 🟡 推断支持（按 GNOME 45 ESM 语义编写，未实机验证） |
| 47 / 48 | Fedora 41+ / Ubuntu 24.10+ | `modules` | 🟡 推断支持（未实机验证） |
| < 3.36 或 > 48 | — | 回退 `legacy` / 取 `modules` | ⚠️ 超出声明范围，会打印警告 |

- **探测发生在运行时**（`lib/index.js` 的 `selfInstallExtension()`，以及 `install.sh` 的 `install_ext()`），不是 npm 安装钩子——两边用同一套规则：主版本 ≤ 44 取 `legacy`，≥ 45 取 `modules`。
- **探测失败或版本超出范围不会装错就完事**：回退 `legacy` 的同时向 stderr（`install.sh`）或日志与 `topbar_status`（插件侧）输出明确警告——`WARNING: GNOME version unknown ... falling back to the legacy extension face`。
- 「实测」仅 3.36.9 一行；其余按接口兼容性推断。在 42/44/46 上跑过的用户请回报，好把 🟡 改成 ✅。

### Wayland 说明

Wayland 会话下本插件**功能完全可用**（色块渲染、推送、点击跳转都不受影响），只有两处「重载 Shell」的便利性差别：

- **`Alt+F2` → `r` 不可用。** 那是 X11 时代的 Shell 重启入口，Wayland 下被禁用（GNOME 有意为之：无法在不销毁会话的情况下重启合成器）。
- **插件的「自动重载 Shell」也会被拒绝**，并在 `topbar_status` 的 `extInstall.message` 里追加 `[Wayland detected: automatic reload refused]`。

Wayland 下让扩展生效/更新，用下面任一方式：

```sh
# 1) 会话内即可完成：禁→启 走一遍（GNOME 45+ 下足够；3.36 会缓存模块，见下）
gnome-extensions disable dsh-topbar@cf206.local
gnome-extensions enable  dsh-topbar@cf206.local

# 2) 最稳妥：注销后重新登录（Wayland 下唯一能真正重新加载扩展代码的方式）
```

> ⚠️ **GNOME 3.36 有个额外坑**：它会缓存扩展模块，`disable`/`enable` **不会**重新加载代码。所以在 3.36 + Wayland 上，改了扩展代码后唯一生效路径就是**注销重登**；X11 上则可以直接用插件的自动重载（`global.reexec_self()`）。

> 📌 `install.sh` 和插件的自动安装都会把 uuid 写进 `org.gnome.shell` 的 `enabled-extensions`；若 dconf 不可用会被跳过，此时按上面命令手动启用。

## ⚠️ 已知限制

- **关闭浏览器标签页 → 顶栏清空。** 数据源是页面。心跳跑在 Web Worker 里，切标签页、最小化窗口**不会**导致清空；只有真正关闭标签页（或被浏览器因内存压力丢弃）才会清。
- **红色（出错）未实现。** 原计划从 `turn/end` 的 `reason.kind == "error"` 取，实测该值存在（样本：133 completed / 6 aborted / 1 error），但未在运行中验证渲染。早期尝试过 herald 的 `outcome` 字段——不可用。
- **GNOME 45+ 变体未实机验证**（本机只有 3.36）；ESM 侧按 GNOME 45 语义自审，见 [开发](#-开发)。
- **依赖 `gdbus` 二进制**（`/usr/bin/gdbus`）。
- 色块数量由「最大色块数」设置封顶；每个标题按设置的宽度像素截断。

## 🔐 安全

- 本机任意进程都可以 `POST /dsh-topbar/state` 伪造顶栏状态（该路由**无鉴权**）。单用户本机场景下可接受，知悉即可。
- 安装只写 `~/.local/share/gnome-shell/extensions/`，**不需要 sudo**。
- 点击色块通过 `execFile` 数组方式拉起浏览器，无 shell 注入面；浏览器命令限单 token 白名单。

## 🧑‍💻 开发

仓库结构：npm 包根即 `plugin-dsh/`，开发/打包在上一层的 `dsh-topbar-dev/`。

```
plugin-dsh/
├── lib/
│   ├── index.js      host：状态路由 + Config schema + 审批/提问监听 + D-Bus 推送 + 扩展自装
│   └── client.js     浏览器：session store + sessionStatus 上报 + 子智能体上卷 + 配置卡片
├── extension/
│   ├── legacy/       变体一：GNOME 3.36\~44（旧式 imports.* GJS）
│   │   ├── metadata.json  shell-version: ["3.36","3.38","40","42","44"]
│   │   └── extension.js   色块渲染 + cfg 应用 + D-Bus 服务
│   └── modules/      变体二：GNOME 45+（ESM import）
│       ├── metadata.json  shell-version: ["45","46","47","48"]
│       └── extension.js   同一渲染主体，仅 import 头与 export enable/disable 不同
├── install.sh        双半部安装（ext|plugin|register|uninstall）
└── package.json
```

> 📌 **两个变体各自是完整单文件**，部署目录里只会出现被选中变体的 `metadata.json` + `extension.js`（不会有壳文件引用缺失的同级模块）。变体按 `gnome-shell --version` 的主版本选择：≤ 44 取 `legacy`，≥ 45 取 `modules`；这层规则在 `lib/index.js` 的 `pickVariant()` 与 `install.sh` 的 `pick_variant()` 里各写一份，改的时候两边一起改。

本地开发部署（DSH 实际加载的是 `<profile>/node_modules/dsh-topbar/` 这份部署副本，**改源码不同步过去不生效**）：

```sh
cd dsh-topbar-dev
./pack.sh                                                                 # 打离线包
cd plugin-dsh && PROFILE_DIR=~/.dsh/profiles/web bash install.sh plugin   # 同步 lib/ 到部署副本
bash install.sh ext                                                       # 探测版本并装对应变体
```

> 💡 若 profile 里把依赖写成 `file:./dsh-topbar-dev/plugin-dsh`（本地迭代推荐），一次 `pnpm install` 就会把部署副本指向本仓库；否则任何一次从插件页的装/升都会跑 pnpm、按 lockfile 把部署副本回退成旧版，**你手工同步的改动会被静默覆盖**。
>
> ⚠️ **`@deepseek-ai/schemastery` 必须是普通依赖，且版本下限 ≥ `^3.18.4`。** 两头都会出事：
> - 把**下限改小**（如 `^3.18.1`）：pnpm 在包内嵌的那份会盖住宿主带 `.volatile()` 的那份，模块**求值期**抛 `TypeError`，整条 entry 报 `failed to import`。
> - 把它**挪到 `peerDependencies`**：在只装本插件的干净 profile 上无人提供它，导入报 `ERR_MODULE_NOT_FOUND`。
>
> 两种情况都实测过，只有 `dependencies: "^3.18.4"` 在两种环境下都能正常导入。

### 改扩展变体的注意事项

两个变体是**同一份渲染主体**（从 `const BUS_NAME` 到 `_onPush` 之前的全部逻辑逐行相同），改渲染/推送/stale 逻辑时**必须两边一起改**。核对方法：

```sh
# 除 import 头、Util.spawn、export 壳外应无差异
diff <(sed -n '/^const BUS_NAME/,$p' extension/legacy/extension.js | sed '/^function init() {/,$d') \
     <(sed -n '/^const BUS_NAME/,$p' extension/modules/extension.js | sed '/^\/\*\* Enable\/disable live/,$d')
```

**ESM 侧无法在本机实跑**（本机 GJS 1.64 / GNOME 3.36 不认识 `gi://` 与 `resource:///org/gnome/shell/…`），因此只做语法校验 + 语义自审：

```sh
node --check extension/legacy/extension.js    # 语法层
node --check extension/modules/extension.js   # 语法层（不真正 import GJS 资源）
```

ESM 变体自审确认过的点：

1. 导入路径用 GNOME 45 规范写法：`gi://St` 等 GI 模块默认导入、`resource:///org/gnome/shell/ui/main.js` 命名空间导入、`resource:///org/gnome/shell/extensions/extension.js` 只取 `Extension` 具名导出。
2. 生命周期是 `export default class … extends Extension` + 实例方法 `enable()` / `disable()`，没有遗留 `init()`（45+ 已弃用），也没有顶层 `enable`/`disable` 具名导出。
3. 无任何残留 `imports.*` 引用（`grep -n 'imports\.'` 仅命中注释里对历史的说明）。
4. `imports.misc.util.spawn(argv)`（legacy 的 `_chipClick`）改为 `Util.spawn(argv)` 并显式导入 `resource:///org/gnome/shell/misc/util.js`。
5. 面板挂载改用 45+ 支持的 `Main.panel.addToStatusArea(uuid, box, 0, 'left')`，不再直接操作私有的 `Main.panel._leftBox`（该私有字段在 45+ 已不存在）。
6. 模块级可变状态（`_box` / `_chips` / `_exported` / `_ownerId` / `_staleTimer` / `_lastPushAt` / `_cfg`）与 legacy 一致，`enable()` 重建、`disable()` 清空，重复启停不泄漏。
7. D-Bus 契约一字未动：bus 名 `org.dsh.Topbar`、对象路径 `/org/dsh/Topbar`、`Push(s) → s` 签名与 payload 结构（`{ts, sessions, cfg}`）与 legacy 完全相同。

改完代码要做什么：

| 改了哪里 | 需要 |
|---|---|
| `lib/client.js`（浏览器半部） | 浏览器**硬刷新** `Ctrl+F5` |
| `lib/index.js`（host 半部） | **重启 DSH** |
| `extension/legacy/extension.js` 或 `extension/modules/extension.js` | 同步 + **重载 Shell**（X11：`Alt+F2` → `r`；Wayland：注销重登）。两份渲染主体需保持一致 |

源码内常量（只有改这些才需要重启/刷新）：

| 位置 | 常量 | 默认 | 说明 |
|---|---|---|---|
| `lib/index.js` | `CLIENT_STALE_MS` | 15000 | 页面多久没上报就清空顶栏 |
| `lib/index.js` | `HEARTBEAT_MS` | 3500 | 内容未变时的最小推送间隔（必须小于扩展端 `STALE_MS`，否则色块会闪断） |
| `lib/client.js` | `PUSH_MS` | 1000 | 上报间隔（心跳在 Web Worker 里跑） |
| `extension/legacy/extension.js` / `extension/modules/extension.js` | `STALE_MS` | 5000 | 无推送多久后清空（两个变体一致） |

## 📄 许可证

[MIT](https://opensource.org/licenses/MIT)
