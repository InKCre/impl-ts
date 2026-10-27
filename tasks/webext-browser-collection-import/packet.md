# WebExt 浏览器采集与已有资料导入

## 2026-10-26 合并与本地清理

用户已授权合并 PR #161 并清理本任务的本地 worktree 与分支。合并前发现 main `59436e5` 的公开依赖安装改动与本分支锁文件冲突；保留 WebExt 正式 InkUI 2.6.0、两个输入组件补丁和 main 的免凭据安装方式，补齐 2.6.0 的公开 Release override，并重新生成锁文件。WebExt 发布工作流同步移除过时的私有包认证；不改变版本或执行商店签名。待当前 head 检查通过后 squash 合并，保留独立安装包与仓库外身份私钥，删除任务 worktree 和已合并分支；不操作其他 checkout、stash 或日常浏览器。

## 2026-10-26 PR 审阅收口

用户要求整理并将 PR #161 转为 Ready for review；仅授权进入审阅，不合并、不发布、不操作商店或日常浏览器。已快进同步远端 `e973936`，完整保留其合入 main `6cd68df` 的 TS7 工具链改动；当前无冲突、无未解决评审线程。此次仅更新任务交付记录和 PR 摘要，不改运行时代码，不重写提交历史。

当前实现 head 的 [CI 40170309569](https://github.com/InKCre/impl-ts/actions/runs/40170309569) 与 PR 预览均通过，包括全仓格式、type-aware lint、统一 TS7/Vue 类型及构建、client-web E2E、WebExt 无数据库回归 4 项通过／7 项条件跳过和发布规则 3/3。此前真实可销毁数据库 Helium 11/11、sfp7 Firefox 及视觉检查是历史补充证据，不冒充当前 CI 的完整数据库旅程。旧的额外 type-aware lint 50 项诊断不再是当前阻塞，独立 `type-check:ts7` 入口已由上游统一工具链取代。

安装迁移与未签名限制继续由 `docs/40-deployment/webext-delivery.md` 维护。没有新增打包或替换已提供的本地候选包；旧下载产物的来源仍以其 `source.json` 为准。收口提交后的检查和 Ready 状态以 [PR #161](https://github.com/InKCre/impl-ts/pull/161) 为准。下文保留此前阶段证据，不代表仍需重复执行的计划。

## 2026-10-25 分发实现进展

用户已接受提案，授权继续实现和验证；Chrome 与 Mozilla 开发者账号均未建立，先完成无需账号部分，不付费、不上传商店、不实际发布。当前工作只在隔离 worktree，原日常扩展与主 checkout 未改。此前自由提交和更新 Draft PR #161 的授权继续有效。实施边界与验收见 [delivery-plan.md](delivery-plan.md)，持久操作说明归入 `docs/40-deployment/webext-delivery.md`。

已加入固定 Chromium 公钥、版本显示、完整本机数据转移、深浅图标、Changeset 与独立发布工作流。私钥仅位于 `/Users/lanzhijiang/.config/inkcre/webext/chromium.pem`，不进入源码与产物。功能 PR 不直接升级或发布旧 `0.1.3`；待 Version PR 消费 minor Changeset 后准备 `0.2.0`。旧路径 ID 不能反推 RSA 身份，不自动替换用户安装；未来商店 ID 承接尚未验证。

已通过全仓 `pnpm check`、TS7、针对性 type-aware lint、双浏览器构建、发布规则 3/3、core SDK 3/3，以及隔离 Helium 的完整 11/11（46.3 秒）与 sfp7 Firefox 156 配置/采集/导入/PDF/公开 MDN 读回。实际检查宽窄深色截图和 optical 工具栏资产，未改变原 UI 风格。身份迁移/换目录升级保留整份合成数据；迁移 ZIP 已验证不带固定 key，且单独输出到 `chrome-mv3-migration`，不会覆盖正常构建。测试数据库、容器、profile 和转发均已清理。

Changesets 实际识别唯一待升 minor 的包为 `@inkcre/client-webext`；公钥派生固定 Chromium ID 为 `fnejbpghhbcojofhgjglkejhednalfoa`，私钥权限为 0600。分支已同步 `origin/main` 的 `e4f75a6`，不改变其他会话工作。源码提交后本地 `release:webext:build` 和 `release:webext:check` 已成功，`.webext-delivery/source.json` 记录实际来源和校验值。两个 ZIP 各 33 条目，源码归档 793 条目，无私钥或本机凭据文件；尚为 `0.1.3` 开发候选，不执行 publish。商店账号/签名、Firefox 原生 popup 与工具栏主题切换、实际 GitHub Release 写入仍未验收。

回查旧远端 CI，发现原任务的 `web-collection` 类型检查和 E2E 入口依赖本机残留 Core dist；补为与其他源码包一致的类型路径，并在 E2E 命令先构建 Core。Playwright 明确使用根 tsconfig，让 Node 测试走 package exports，不误套浏览器消费者的源码类型别名。已把隔离 worktree 的旧 dist 移至 `/tmp/inkcre-webext-core-build.HP65Ra/dist`，无旧产物的材料类型检查、E2E 命令通过（4 项无数据库检查通过，7 项按条件跳过），全仓类型再次通过；不修改 Core 发布入口或其他会话源码。

修复后的完整 Helium 11/11 再次通过（35.2 秒）。远端工作区检查通过；Linux 原生字体使 ON/OFF switch 为 64.5px，旧测试将 64px 当作绝对上限误报。已下载检查 CI 实际截图，保持原 UI，只为紧凑宽度断言增加 2px 字体度量容差。升级回归从当前 manifest 计算下一 patch，不将未来 0.2.0 错当作升级到硬编码 0.1.4。CI 证据位于 `/tmp/inkcre-webext-ci-evidence.twh3iF`，最终状态以 PR #161 的当前 head checks 为准。

## 2026-10-25 版本管理与分发提案

用户要求处理 WebExt 的版本管理和分发，已明确首期以自己和少量使用者安装、接受开发者模式和手动更新为主，但后续接入浏览器商店不能重做发布流程。本轮形成提案，不修改源码、创建商店项目或发布；此前自由提交和草稿 PR 授权不等于对新分发渠道的发布授权。

现状：PR #161 仍为未合并草稿，head 为 `01c71de`；WebExt 版本仍为 `0.1.3`，WXT 从 package.json 生成 manifest 版本。已有 Chrome/Firefox 构建及 zip 命令，无 WebExt 发布流程。Changesets 支持私包版本管理，但当前 Extension release 的分发对象是 MF Extension，不是 WebExt Peer。主 checkout 有其他会话改动，不动其源码或 stash。

拟议边界：WebExt 独立版本，Chrome/Firefox 为同一版本的浏览器产物，不与 client-web/Core 版本或 MF Registry 发布绑定。复用 Changesets 的版本意图与 Release PR，初次重写候选建议为 `0.2.0`；正式发布从受保护 main 构建并归档 GitHub Release，保存版本、来源和实际包，后续商店提交消费相同发布产物，仅增加渠道步骤，不再决定版本。首期 Chromium ZIP 解压加载、手动替换更新；Firefox 若交付可持续安装版本，需要 Mozilla 签名的 unlisted XPI，不把临时加载称为正式安装。不自建更新服务、不引入多渠道版本号或发布框架。

安装身份与流水线复用分别验收。Firefox 已声明 `webext@inkcre.org`；Chromium 尚无固定 key，应在首个分发版本确定身份。官方支持先上传未发布商店草稿取得公钥，使解压版与未来商店版 ID 一致；尚未确认用户是否已有商店项目或账号，不承诺既有路径派生 ID 能原地转成商店身份，也不以卸载重装作为无损更新。升级检查应覆盖连接、Peer ID、待发送材料和导入进度。WXT 默认会去掉预发布后缀，不能把 beta 后缀当作浏览器递增版本。

事实来源：[WXT manifest](https://wxt.dev/guide/essentials/config/manifest.html)、[WXT publishing](https://wxt.dev/guide/essentials/publishing.html)、[Chrome 分发](https://developer.chrome.com/docs/extensions/how-to/distribute)、[Chrome key](https://developer.chrome.com/docs/extensions/reference/manifest/key)、[Firefox 签名](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)。本地 WXT 0.20.27 版本生成源码已核对。下一步先收口以上产品边界，再制定技术与验收方案；商店账号、签名和存量安装迁移尚未验证。

## 此前实现与提交

2026-10-23 提交授权：用户明确允许自由提交、创建 Draft PR，随后要求处理冲突。WebExt 重写、精简、相关 core 接缝、测试与文档在隔离 worktree 的 `feat/webext-collection` 分支，通过 [PR #161](https://github.com/InKCre/impl-ts/pull/161) 提交；允许更新该草稿，不合并、不发布、不改主仓或混合 stash。此授权取代下文此前的“不提交”限制。

2026-10-23 当前状态：用户要求“开始精简”，九项审计已落实。配置完整回填、离线保存、同库地址可改且保留身份/待办，纯改名不再请求授权或登记；排除规则回填且刷新不改草稿。逐材料登记与界面驱动后台已移除；保留按连接缓存的独立 Peer 生命周期、错误可见及原队列恢复。设置正常读取只读、无消费者字段删除、带登录控件的公开正文不再误拒绝。未引入新依赖、权限体系或可靠性框架，原界面风格和 InkUI 显隐/紧凑 ON/OFF 保留。

最终验证：Helium 10/10（1.8 分钟）、sfp7 Firefox 156 完整配置编辑/采集/导入/公开 MDN 读回通过，宽屏/窄屏/深色截图已检查。全仓格式、lint、合同、类型、构建、core SDK 3/3 通过；最终两处简化后重跑 WebExt 类型、type-aware lint、双构建和全部浏览器旅程。两种产物已同步原加载目录并逐文件一致；前版可从 `/tmp/inkcre-webext-simplification-backup.S6gfIG` 恢复。未自动重载，未动日常配置，测试库/容器/profile/转发均清理。未提交发布。Firefox 原生 popup/权限提示与大批私人资料压力等边界仍未验收，详见[实施接续](implementation-state.md)。

## 此前审计与交付记录

当前前沿（2026-10-23）：用户因“修改连接时 JWT 空白”要求全面重新评估，并明确这是产品定位、安全边界理解错误，不只是回填缺陷。本轮评估已完成，结论在[技术审计最新章节](technical-audit.md)：同一 owner 的可信设置页与后台不是前后端权限等级；撤回凭据不可读改、配置必须联网登记才能保存、地址等于信息库身份、每条材料注册续租等错误前提。另实测排除规则不回填会导致添加一条替换旧规则；后台推进依赖 UI 唤醒、普通读取写回、无消费者观察字段和保守网页误拒绝需收窄。保留真实网页/消息/网络边界、原连接待办和普通图合同。审计建议未实施，本轮没有修改源码、测试或交付产物；现有插件仍存在上述问题。仅合成 headless UI 复现，临时 profile 已清理。下文的“已完成”是此前交付事实，不再代表当前整体验收结论。

2026-10-23 重新打开：用户反馈“保存目标”与 Peer 模型不一致，复制 Web 的 URL/secret 后报 PGRST JWT 验签错误。此前工作被其他操作完整保存到主仓 stash@{0}；当前 main 已含其他会话提交，不恢复混合 stash。仅本任务文件已恢复到隔离 worktree /Volumes/WorkSSD/Development/InKCre/worktrees/webext-collection-impl-ts，保留 stash 和主仓源码工作不变。范围：核对认证表示，修复本 Peer 加入/身份重试语义及界面，补认证失败与凭据更新边界。尚未读取真实 secret；仅 headless、只用可销毁数据库，不提交发布。

当前进展：UI 改为“信息库 / 本 Peer / 加入信息库”，已有连接更新保留 connectionId/peerId，失败不覆盖原配置。Helium 真实可销毁数据库回归 9/9（36.6 秒），包含认证拒绝后保留载荷、重试、响应丢失及重启恢复；全仓 pnpm check、SDK 3/3 通过。用户明确要求恢复 ON/OFF，已恢复并保留 xs 紧凑尺寸；之后设置/加入回归 2/2、sfp7 Firefox 156 完整旅程通过，宽屏/窄屏/深色截图已检查。两个已验证产物已同步回原加载路径，未操作浏览器重载；旧产物可从 /tmp/inkcre-webext-build-backup.qw6eyB 恢复。

真实认证问题已关闭：用户确认改用实际明文后可以正常连接。此前隔离 Helium 合成实验表明文本框 Cmd+C 触发 copy，密码框不触发；用户确认当时从隐藏的密码框复制。没有读取日常配置、真实密钥或系统剪贴板，也没有更改共享签名算法或增加密钥格式兼容分支。

当前追加范围已完成：仅 WebExt 升到已发布的 InkUI 2.5.0，使用组件默认密码显隐及公开中文词典。实际截图发现 2.5.0 会重复渲染普通输入值与 ID，已用版本限定的一行 pnpm patch 修复，不改 UI 仓库或其他 Peer。Helium 设置与加入回归 2/2（39.7 秒），包含显示/复制/重新隐藏、不意外提交、唯一字段 ID；宽屏/窄屏/深色截图已检查。sfp7 Firefox 156 的设置、显隐和后台消息验证通过。两种构建、类型、针对性 type-aware lint、workspace/格式检查通过。两个产物同步至原加载目录，未操作浏览器重载；本轮之前产物备份在 /tmp/inkcre-webext-visibility-backup.H01Jm8。

用户进一步明确不得打扰桌面：后续仅 headless 后台浏览器与截图验证，不启动任何 headed/可见浏览器，不调用日常会话或原生桌面操作。之前 headed 测试窗口已结束，已核对没有遗留自有浏览器进程；agent-browser 的自有命名会话也已关闭。

2026-10-22 本轮完成：旧工具全部 hard-cutoff，删除 Explain/Writing Assist/旧侧栏/注入入口及专用设置、依赖和构建权限，只保留历史数据迁移，不删除用户待办。设置页恢复原有方角灰底卡片、白底字段、紧凑按钮与 teal 主动作；Switch 改为无 ON/OFF 文案的 xs 60×24px，键盘切换与刷新持久化通过。Helium headless 实际数据库验收 8/8（29.4 秒）；sfp7 Firefox 156 后台验收设置/紧凑 Switch/旧消息退役及完整采集、SPA、原生导入、PDF、公开 MDN 读回通过。两个构建无旧入口，构建、类型、lint、runtime/package/workspace/格式检查通过。未提交发布；Firefox 原生 popup 和权限提示 UI 仍未验收，所有自有测试资源已清理。

2026-10-22 补验 UI：用户发现实际工具栏弹窗宽度塌缩；之前仅在普通标签页验证了元素，不能作为原生布局证据。隔离 Helium 真实 popup 复现 99px，修复根文档固有宽度后 headed 回归通过：395px、标题单行、按钮 36px、无横向溢出、设置可达。已目视检查同宽内容截图（不是原生窗口截图），按用户 20261021 logo pack 更新了图标和逻辑尺寸。Chrome/Firefox 构建及相关静态检查通过。原生工具按应用名误选日常实例，只读取窗口树、没有操作，已停止并重置；后续仅在隔离实例内验收。Firefox 原生弹窗与深色工具栏仍未验收，细节见[实施接续](implementation-state.md)。下文的数据通路证据独立保留。

- **目标与授权**：WebExt 作为独立 Peer 留存浏览材料，保存选区/附注/PDF，并导入浏览器书签与历史。用户授权连续完成实现、测试和文档，不提交发布，不修改其他会话负责的 Capture、Organization、检索或 sinks。允许协调现有两位 owner；没有 client-web 硬依赖，不要求全部能力本地执行。
- **当前基线**：用户接受[完整技术审计](technical-audit.md)并要求推进。[技术方案](technical-design.md)和[验收计划](acceptance-and-plan.md)已重写；按概率、损失、发现/恢复成本与机制成本判断，不把未知概率当成必须消除的高风险。freeze、网页领域 SQL/RPC、永久回执表、current CAS/修订及默认强事务已撤，不以通用事务框架替代。
- **实现状态**：Python 未发布候选模型/迁移/专属测试已删除，未改共享开发库。TS web-collection 通过现有 Block/Relation CRUD 构图，HTML/text 使用普通 core 内容，PDF 走现有可写 Storage；core 只补精确连接注入。WebExt 保留本机持久待办、原目标绑定、手动优先、暂停/撤权判断和原生导入 checkpoint，修复自动消息封装，允许正常重定向/声明编码，保留旧配置与任务。
- **此前基线**：首期 Helium 实际验收 7/7 通过（29.8 秒）；本轮追加 UI/删除回归后的 8/8 见上方。基线覆盖普通图/Storage、不完整根、原生导入、自动/current 与 fixed 分离、SPA、暂停队列、旧配置/任务及中断迁移、重启与原目标恢复。PDF 403 后原站 410 的用例证实使用原请求完成、不重新抓取。此前全仓 pnpm check、core SDK 3/3、类型感知 lint 和迁移完整性通过，不冒充本轮全仓重跑。证据见[实施接续](implementation-state.md)，不承诺生产故障率或全局 exactly-once。
- **Firefox**：按用户提供的 sfp7 使用已装 Firefox 156，自带 BiDi、隔离 profile，不下载浏览器/驱动、不碰日常配置。设置/后台、自动/current、重载、SPA、稳定手动材料、书签/历史/部分失败/PDF，以及真实公开 MDN 页面采集读回全部通过。实测修复了端口权限模式和 SPA sender URL 误拒绝；原生权限提示 UI 未验收。Chromium 仅用 Helium；其独立复现的新文档导航挂起限制仍单列，不转嫁为产品失败。
- **当前状态**：首期核心实现、测试与文档收口，不提交发布。第三方收藏服务仍待用户选定真实资料源，未实现该连接器；其余未验收边界保留在实施接续。两位 owner 已核对最终普通图合同并撤除领域 RPC/freeze 依赖，仅更新各自文档，未代替消费者联调。自有空库和测试资料目录已清理。

## 证据与所有权

权威实现说明在 docs/30-unit-tdd/webext-collection.md 和 apps/client-webext/README.md；共享 Peer/RPC 原则不变，不改 docs/_shared。

Hister 固定研究版本 f1fff29683c8c8006a35d3387384d9b1e123cebe（2026-10-21），保留 Adam Tauber / asciimoo / 贡献者与 AGPL-3.0-or-later 来源说明；未复制代码或素材。

其他会话的 client-web、共享文档、Capture/Mail 及其迁移/测试等变更只读保留，以当前 git diff 核对，不因列表过时回滚新并行变更。
