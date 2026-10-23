# WebExt 实施接续

2026-10-22，用户接受 ROI/Peer 全面审计并授权继续完成实现验证。当前不是待审批方案，也不是旧 RPC 候选。目标和边界见 [packet](packet.md)，实现基线见 [technical-design](technical-design.md)。

## 2026-10-23 Draft PR 冲突处理

PR #161 重放到 main `e3d2f3c`，保留 main 的预览交付和测试精简变更，以及 client-web、twitter、ext-dev-utils 升级 InkUI 2.5.0 的版本选择。release-age 允许列表取双方并集；锁文件统一所有 2.5.0 消费者的既有输入框补丁，移除自动合并残留的未修补解析。补丁只纠正重复值和 ID 的渲染条件，不改其他消费者源码、UI 样式或 API，也不升级仍使用 2.3.0 的扩展。此次操作仅更新隔离分支及草稿，不操作日常浏览器、主仓或混合 stash。

冲突处理后，离线 frozen-lockfile 安装、全仓 `pnpm check`、Firefox 构建、TS7、针对性 type-aware lint、core SDK 3/3、预览测试 1/1 均通过。四个消费者实际安装的 InkInput 普通、只读、行内及密码初始渲染共 16 项通过，字段 ID 和值没有重复。Helium headless 真实数据库旅程 10/10（1.4 分钟），sfp7 Firefox 156 的完整配置、采集、导入及公开 MDN 读回通过；本轮宽屏、390px 和深色截图已检查，测试库、容器、profile 和转发已清理。

额外全仓 type-aware lint 未通过：本任务兼容测试的三个 Promise 标记已修正并重验，剩余 50 项诊断分布于 18 个与 main 完全一致的文件，本轮未修改这些文件，不把常规 `pnpm check` 通过等同于该检查通过。未重跑 client-web 或 twitter 的完整业务浏览器旅程；Firefox 原生 popup/权限提示及私人资料压力边界仍未验收。

## 2026-10-23 精简实施

用户明确要求“开始精简”，本节取代下文历史记录中的“认证成功才保存、已有地址不可改、编辑密钥为空”等行为。设置页直接读取同源完整 Connection，密钥默认遮罩并复用 InkUI 显隐；只改名称或 PDF 存储不再请求主机权限或网络登记。配置输入有效即可本机保存，新地址或密钥不能工作时由 owner 再次修改，不引入凭据版本库。同库地址修正保留 connectionId/peerId 和旧待办，另建连接仍不接管旧项。排除规则打开时回填，状态刷新不覆盖编辑草稿。

逐材料注册/续租已经移除。Peer 参与信息在启动、新配置/地址/密钥变化以及 alarm 中独立更新，复用当前后台的 WebPeerRuntime；不阻塞本机初始化或材料 CRUD，错误显示在对应连接下。工作循环每批三条并推进一个导入阶段，有进展继续、无进展退出，本轮已尝试项不立即热重试。UI 不再唤醒工作。设置初始化后的读取使用 readonly，删除了没有消费者的 capture observation UUID 和 visible 字段；真正用于 pending 合并的 observationKey 保留。公开正文不因附带 password 控件被整页拒绝，真实登录短页及空正文仍报补采。

第一轮真实回归揭示了原来被登记前置掩盖的错误传递：普通图调用直接抛出 PostgREST error 时丢了 HTTP status。领域客户端统一保留 status/code 到已有 APIError，使认证拒绝仍进入需要处理状态并保留载荷；不修改共享 core 或重签算法。测试同时排除了底层库 503 自动重试导致的请求计数误判，自动观察检查允许既有 30 秒周期，不改变产品周期。Firefox 首轮新增脚本有变量重名和无返回值错误，均已修复后重跑；随后实际编辑暴露冗余权限请求，已从纯本机改名路径移除，不以增加测试授权绕过。

当前验证：Helium 完整 10/10 通过（最终 1.8 分钟，此前一轮 52.6 秒），包含关闭设置页后仍完成导入、登记失败不阻断材料、登记悬挂时本机改名、前三项失败而第四项完成、地址修正后旧待办恢复。sfp7 Firefox 156 headless 已通过设置、既有密钥遮罩回填、无需重输的改名、身份保留、排除回填，以及自动/current、重载、SPA、稳定手动保存、书签/历史/隐藏登录控件正文、部分失败、PDF 字节和真实公开 MDN 页面读回。Helium 的宽屏、390px 窄屏、深色截图已检查；灰底方角卡片、字段、teal 主动作和 xs ON/OFF 保留。

全仓 format、lint、workspace/runtime/database/locale 合同、类型、build/package 合同及 core SDK 3/3 已通过；最后两处简化后又通过 WebExt 类型、type-aware lint 与 Chromium/Firefox 构建。没有新增依赖或权限系统；InkUI 2.5.0 的已知一行补丁保留到上游修复，白底字段局部适配保留，未修改 UI 仓库。Firefox 原生 popup/权限提示、私人资料大规模压力与 Firefox 独立重启故障仍未验收，未将后台测试称为这些边界的证明。未提交发布，不操作日常浏览器。

前版两个加载目录已逐文件备份至 `/tmp/inkcre-webext-simplification-backup.S6gfIG`。最终构建已同步至主仓 `apps/client-webext/.output/chrome-mv3` 和 `firefox-mv3` 并逐文件核对一致；仅替换生成产物，未恢复混合 stash 或覆盖主仓源码。所有测试库、容器、SSH 转发、Firefox 临时副本/profile 和 Helium 测试 profile 均已清理。没有自动重载用户扩展。

## 2026-10-23 信息库加入与认证排查

设置不再把共享系统称为“保存目标”。PostgREST 是数据库协议传输，不是接收材料的另一 Peer。UI 显示当前信息库和本 WebExt 的 Peer ID；修改当前加入配置保留本地连接 ID 与 Peer ID，认证成功后才替换凭据，失败保留旧配置。换地址使用另一个连接，不推测部署别名。PDF 存储折叠在加入表单中，不参与身份解释。

共享 WebPeerRuntime 原错误把上游认证拒绝包装为 status 0；WebExt 现在将 PGRST301 归类为 401，使待办明确阻塞并保留原载荷，而不是持续显示发送中。只修正此确定错误，不增加重签算法或密钥解析回退。Helium 完整可销毁数据库回归 9/9（36.6 秒），覆盖 Web 与 WebExt 使用同组合成配置分别加入、凭据更新保留身份、失败不覆盖旧连接，以及认证拒绝后重试原载荷、响应丢失和重启恢复。全仓 pnpm check 与 core SDK 3/3 通过。

用户明确要求恢复 Switch 的 ON/OFF，之前隐藏文字是代理自行作出的不当取舍。现已恢复组件默认文字并保留 xs 尺寸；默认字体下宽度不超过 64px、高度不超过 24px。文字状态、稳定名称、键盘切换和持久化回归 2/2，宽屏/窄屏/深色截图已检查；sfp7 Firefox 156 的同一设置与完整采集/导入旅程再次通过。没有启动可见浏览器。两个构建已同步到原加载目录，旧构建备份在 /tmp/inkcre-webext-build-backup.qw6eyB；不会自动重载用户扩展。

真实认证问题已由用户重试成功关闭。Pages workflow 与运行记录自行给出 production 地址 https://app.inkcre.dev，不应要求用户再次提供。公开线上 sourcemap、已交付插件和当前构建中的 signDatabaseToken 一致，HS256、issuer、audience 和 role 一致。隔离 Helium 合成实验表明密码框选中内容后 Cmd+C 不触发 copy，普通文本框触发；用户确认当时确实从 Web 密码框直接复制，随后使用实际明文连接成功。未读取用户配置、密钥或系统剪贴板，没有为复制问题改变签名协议。

源码仅恢复到 /Volumes/WorkSSD/Development/InKCre/worktrees/webext-collection-impl-ts：主仓 stash@{0} 混有其他会话工作，不 apply/pop，也不覆盖 main 新提交。主仓只更新本任务原先交付的 .output/chrome-mv3 与 .output/firefox-mv3。

## InkUI 密码显隐接入

用户确认真实认证成功后，要求接入新版 InkUI 已有的显隐能力。仅 WebExt 固定升级到已发布的 2.5.0；现有 `native-type="password"` 即可启用，不增加本地显隐状态或独立按钮。设置入口通过公开 `INK_I18N_KEY` 和 `zhCN` 词典提供中文名称，原有灰卡片、白字段、teal 主动作和紧凑 ON/OFF 保持。

实际截图暴露了 2.5.0 新增按钮打断条件链的回归：普通可编辑字段同时渲染 input 和只读 span，显示两次值并重复 ID。版本限定的 pnpm patch 将 span 的条件收敛为只在不可编辑时渲染，仅修改发布包运行入口的一行。未修改 UI 仓库、其他 Peer 的包版本或引入本地组件分叉；升级上游修复版时移除此补丁。隔离渲染自检覆盖普通、只读、行内三种形态，每项只出现一个字段 ID 和值。

Helium headless 设置/加入回归 2/2（39.7 秒），覆盖唯一字段、默认隐藏、键盘显示、明文复制事件、重新隐藏、值不变、不意外提交，以及已有连接认证与身份保留。复制实验用合成值并取消事件默认动作，不读写系统剪贴板。宽屏、390px 窄屏、深色与明文显示截图已目视检查，位于 `test-results/playwright/browser-extension-settings-bcfcc-top-narrow-and-dark-layouts-browser-extension/`。sfp7 Firefox 156 headless 设置、显隐、唯一字段、无意外提交和后台消息通过；本轮未重跑 Firefox 完整材料旅程或原生权限 UI。

Chrome/Firefox 构建、WebExt 类型检查、针对性 type-aware lint、workspace 合同、格式和 diff 空白检查通过。可销毁数据库、容器、转发、远端 Firefox profile 和测试副本已清理。验证过的两个产物同步至原加载路径并逐文件核对；前版备份在 `/tmp/inkcre-webext-visibility-backup.H01Jm8`。未操作日常浏览器或自动重载扩展，未提交发布。

## 旧工具 hard-cutoff 与 UI 风格恢复

用户追加授权删除旧工具，并要求保留原来的 UI 风格；随后明确禁止打扰桌面。Explain/Writing Assist、旧选区浮栏、侧栏图编辑器、模型提供商与指令/停用词设置、旧 storage/composable/message bridge 全部删除，不保留开关或备用入口。依赖清除对应 AI SDK、bridge、Markdown、VueUse 和旧 Uno 工具链；共享 core 不因 WebExt 删功能而裁剪。产物从 13.5MB 降至 6.97MB（构建报告值，含 inline sourcemap）。Chrome/Firefox 均核对没有旧页面、脚本、消息字符串和 sidebar 权限。包产物检查改为要求新 collection 脚本及 popup/options 页面。

历史连接与未完成摘录只保留数据迁移；原模型凭据仍封存在扩展私有 IDB，不再读入执行或编辑。移除了可写/订阅旧配置的适配器，只保留实际 key 的迁移读取。不清空用户数据。删除的受版本管理源码仍可从 Git 找回。

残留的旧 `.output/firefox-mv2` 构建已移出加载目录，临时恢复位置为 `/tmp/inkcre-retired-build.9wftbO/firefox-mv2`，没有清除该备份或用户 profile。当前 `.output` 只交付 Chrome/Firefox MV3。

设置页恢复原有 palette、灰底方角卡片、白底字段、紧凑的局部按钮及 32px optical logo。沿用 `@inkcre/ui-web` 控件并用公开系统 token 对接原 palette，未改 UI 包源码。Switch 从 100×36px 改用 xs 60×24px，隐藏 ON/OFF；稳定名称、aria-checked、空格键切换、刷新后持久化均已验证。1280px、390px、系统深色截图已检查，无横向溢出。截图在 Playwright 的 settings preserve 用例目录；popup 内容截图仍只作外观补充。

本轮完整 Helium headless 实际数据库验收 8/8 通过（29.4 秒），覆盖原有数据旅程及新增原生 popup/旧入口消失、设置页样式与键盘行为；自有库、容器、tunnel 已清理。Chrome/Firefox 构建、WebExt typecheck、针对性 type-aware lint、runtime/package/格式检查通过。迁移夹具先等待后台初始化，避免测试自己用无 version 的 indexedDB.open 抢建空库；不改产品存储版本。

sfp7 Firefox 156 headless 重验也通过：独立设置/后台、60×24px 有名称的 Switch、旧消息无处理器、自动/current、重载、SPA、稳定手动留存、书签/历史/部分失败/PDF 和公开 MDN 采集读回。第一次运行因验收脚本仍断言旧页面标题而停止，已更新设置页断言，没有放宽数据行为判据。远端 profile/副本、数据库、容器与转发已清理；Firefox 原生 toolbar popup 和权限 UI 仍未运行。

曾再次误用 headed 验收，用户指出干扰后已停止；该批窗口已结束并核对没有遗留自有浏览器进程。agent-browser 自有命名会话扩展导航被拦截，已关闭，不把空白截图计为 UI 证据。后续全部使用现有测试夹具的 headless 实例与文件截图，不接日常会话、不使用原生桌面工具、不启动可见窗口。下方早期 headed 证据只属于当时运行，不是后续许可。

## 工具栏弹窗与 Logo 补验

用户实机截图暴露了之前的验收缺口：原 popup 测试在普通标签页检查元素，没有验证原生工具栏弹窗。隔离 Helium 155 的 `action.openPopup()` 复现为 99×600px；子元素的 `max-width: 100vw` 受弹窗初始窄视口约束，根文档又没有明确固有宽度，形成了尺寸反馈。修复为仅 popup 的 html 根节点声明 380px 宽度，移除子元素的视口上限，不改变独立设置页宽度。

更新后的 headed 原生弹窗回归通过：视口 395px（含纵向滚动条），标题高 23.39px，保存按钮高 36px，无横向溢出，保存按钮首屏可见，设置按钮可滚动到达。测试从同扩展设置页的 `chrome.extension.getViews({type: 'popup'})` 读取真实 popup window，而非普通页模拟。布局 JSON 附在 Playwright 结果；`popup-content-at-native-size.png` 是按真实宽度补拍的普通页内容截图，已目视检查，不冒充浏览器原生窗口截图。

原生操作工具曾按 Helium 应用名错误选中日常实例，读取了两次窗口树，没有点击或修改；已停止并重置该工具。独立测试 profile 均由自己的 Playwright context 关闭清理，不操作日常实例，不启动 Chrome for Testing。后续本次验证仅在隔离实例内进行；Firefox 原生弹窗外观和深色工具栏辨识效果仍未验收。

Logo 改用用户的 `InKCre-logo-pack-20261021.zip`。工具栏 16/32/48 物理像素分别取原色透明 16px 的 1×/2×/3×，全部使用 optical 几何；扩展管理 48/96/128 使用 standard 几何。旧工具 SVG 换为 optical-32 母版。9 个源素材与原包逐字节核对，PNG 尺寸正确，两个构建的 PNG 与原包一致，manifest 明确区分 toolbar 和管理图标。没有重新绘制或调用素材构建脚本。Chrome/Firefox 构建、WebExt typecheck、针对性 type-aware lint 和格式检查通过；本次未重跑数据库资料旅程，之前的数据通路证据独立保留。

## 实现

未发布的 Python web_material schema、72e008f0fb8b_add_web_material_protocol.py、专属 migration 测试已删除；协议列表和 constants 不再含网页 RPC/回执表。候选未登记完整性清单、未部署共享开发库；pdm run check:migrations 通过。保留并行 Capture/Mail 等变更。

packages/web-collection/src/material.ts 用连接绑定的现有 DBAPIClient 读写普通 Block/Relation。HTML/text 内联 core 语义块，PDF 调现有 WritableStorage；PostgreSQLBinaryStorage 窄构造参数绑定请求/token/blob client，不切全局配置。普通根存 lookup key/request_id/source/material，查询后核对身份；fixed 仅复用同 request，current 复用 profile + 确切 URL + 方法。根可见不代表完成，恢复补齐已知关系/内容，不建 receipt ledger。响应丢失/并发可留下重复或孤立项，不承诺全图事务/同快照/绝对去重。resolvers.ts 供现有消费者按 exact resolver 接入，不强制 client-web 新依赖。

自动消息正确解析后台封装；enqueue 合并同 observation 尚未发送项；dispatcher 手动优先，派发前复查暂停/排除/真实 host 权限，held 项不占批次。网络在本机锁外，已派发不能保证取消。错误保留载荷与原目标。原生导入一个本地 owner、checkpoint/停止继续/部分失败，无跨执行者 CAS。公开取材跟随 redirect、使用最终 URL/声明编码，不带数据库认证或浏览器凭据；PDF 保留字节。protected 旧配置迁移 IDB，其余偏好留 browser.storage.local，候选已迁移项继续可读。

## 验证与运行

从 impl-py/PDM 运行 task helper；显式环境变量 INKCRE_CHROMIUM_BINARY=/Applications/Helium.app/Contents/MacOS/Helium。当前脚本路径 /Volumes/WorkSSD/Development/InKCre/worktrees/webext-collection-impl-ts/tasks/webext-browser-collection-import/verify_browser.py，--runtime /Volumes/WorkSSD/Development/InKCre/impl-py/.runtime/database/0ec9cf3c08ae5096，可选 --grep。只运行默认 headless，不使用 Playwright 默认缓存、不碰日常 Helium。

最终 Helium 7/7 通过（29.8 秒），覆盖普通图/Storage 与不完整根、独立 UI、原生导入/部分失败/重跑、自动 current 与 fixed/附注、SPA、旧配置/任务、暂停自动队列仍能手动、完整重启与切换连接后的原目标恢复。原生导入增加 PDF 已入队后403、原站改410、重试同一载荷成功且只抓取一次的检查。中断迁移夹具覆盖 IDB 已复制但 storage.local 旧 key 尚在；启动清理与精确保留数据均通过。core TextResolver 解释正文、原站无数据库认证、reader 不执行脚本、草稿/密码/编辑内容排除均通过。测试预授予合成 localhost/bookmarks/history，不代表原生权限 UX；生产 manifest optional 权限另有断言。

Helium 启动延迟后新文档导航可能挂起，无扩展裸浏览器也复现，Node HTTP 正常，headed 同样发生。没有安装替代浏览器或碰日常 profile。验收先打开来源页再配置，覆盖已有页面/真实 visibility 更新与 SPA；扩展注册后打开新文档的 Chromium 路径仍受该环境限制。Firefox 的注册后新文档和重载路径已实际通过。

最终 pnpm check（全仓格式、lint、workspace/runtime/database contract、类型、构建、package contract）通过，Chromium/Firefox build 通过。SDK compatibility 3/3（含 binary CRUD 精确连接）、针对性 type-aware lint、pdm run check:migrations 通过。没有为此运行 client-web 全量浏览器 E2E；共享 core 默认调用通过兼容测试和全仓构建/typecheck 检查。

## Firefox 与自有资源

用户不允许下载 Firefox，随后指出 sfp7 已安装。SSH sfp7-ws.localhost（Fedora）使用 /usr/bin/firefox 156.0、Node22.23.4。verify_firefox.mjs 通过内置 BiDi、临时加载与临时 profile 验证了设置/后台、自动 current、重载、SPA、稳定手动材料/附注、原生书签/历史/HTML解析/部分失败/PDF，并实际采集读回公开 MDN Match Patterns 页面。权限只在测试 profile 预授予 localhost 和 MDN，未验收原生提示 UI。修复 Firefox 不匹配带端口权限模式，以及 SPA 后 sender.url 保持初始地址造成的误拒绝；自动材料仍核对实际完整 URL。每次 profile/库/容器/tunnel 已清理，初始探测目录 HQwrAd 也已删除。不下载浏览器/驱动、不改日常配置。

verify_browser.py 只创建 UUID 数据库、自己 PostgREST 容器和 SSH forward，finally 清理，不改 cluster roles；最新运行资源已清理。--firefox-ssh sfp7-ws.localhost 运行远端 Firefox；SSH forward 必须 -S none，避免已有 multiplex master 接管生命周期。旧 autogenerate 库 inkcre_webext_rewrite_20261022 已核对所有业务表0行、无活动连接后删除，不触碰共享库。不打印凭据/trace 中测试 token。

## 余项与边界

首期核心实现与验证完成，没有提交发布。没有第三方真实资料源，不虚构连接器；未跑真实私人资料库大批量/配额压力、旧 Explain/Writing Assist 外部服务端到端，也未跑 Firefox 的原生权限提示和独立完整重启故障用例。不要用 Chromium 的通过覆盖这些未运行项。小批真实公开页面与合成原生资料已运行。

不提交发布，不改其他会话的领域源码。两位 owner 已读最终合同，更新各自职责/技术文档，确认普通图/Resolver 消费、无专属 RPC/WebExt 在线/读取前固定或同快照要求；没有消费者联调。Hub 原则不变；具体 Extension 文档归 TS owner。Hister 署名已保留，未复制代码/素材。
