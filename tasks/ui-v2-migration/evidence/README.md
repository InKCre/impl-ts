# UI 2.0 消费验收

Web、mail、twitter 和 ext-dev-utils 均锁定 GitHub Packages 的 `@inkcre/ui-web@2.0.1`；这些检查没有启用源码映射或 `file:` 依赖。截图使用隔离数据，不含用户业务内容或真实凭据。

当前 2.0.1 复验见文末；此前各阶段截图与产物哈希保留其历史版本身份。

## 通过的边界

完整 `pnpm check` 覆盖格式、lint、类型、Core/Web/WXT/两个扩展构建与产物契约。另通过源码联调类型检查、TS7、两个扩展的原生 manifest 检查、Intent load 和 Chromium 扩展 popup E2E。PR #104 的 [首轮完整 CI](https://github.com/InKCre/client-web/actions/runs/34739437023) 使用真实 core 服务与隔离数据库，通过五个 Web 旅程，包括新增的 Peer JSON 保存。后续 MF 与布局修改继续由 PR 当前提交的 checks 验证。

实际构建的 Web 页面验证了 JSON 语法／schema 无效时禁用保存、保存后的草稿回显、中英文切换和深浅主题。375px 下 Peer dialog 位于视口内，未发生运行时异常。持久化失败、pending 禁止关闭、禁用编辑与重试成功由真实数据库 E2E 证明。

[扩展验收脚本](https://github.com/InKCre/impl-ts/blob/ec5dd1e3877db30bf51b5780b1a6bc7d31e3ba01/tasks/ui-v2-migration/evidence/browser-host.mjs) 从真实 Web 构建进入 Extensions，按原生 manifest 加载本次构建的 mail 和 twitter，网络边界使用隔离 Registry／Peer／Block 数据。它验证中文 Host 的小时／分钟、取消／确认文案传入 Twitter；取消保留原时间，确认提交 07:30；再进入 Info-Base 的 Mail renderer，验证 HTML 隔离显示、附件下载 pending、受控 HTTP 500 后错误显示与按钮恢复。最终未出现 pageerror；控制台的 500 属于主动失败注入。它不证明真实 OAuth 或 Mail 服务集成，这些操作没有执行。

## 复跑

在历史提交 `ec5dd1e387` 的工作区根目录完成 `pnpm install --frozen-lockfile` 和 `pnpm check`，随后分别运行：

```sh
pnpm --filter @inkcre/client-web preview --host 127.0.0.1 --port 47931 --strictPort
node tasks/ui-v2-migration/evidence/browser-host.mjs http://127.0.0.1:47931
```

脚本依赖仓库已有 Playwright 和 Chromium，输出截图到忽略的 `.runtime/ui-migration-evidence/`。它是这次验收的重放夹具，没有建立第二套发布或测试框架。数据库验证仍运行根级 `pnpm test:e2e:web`；本机 SSH provider 当次不可达，该项使用 PR 的既有隔离数据库 CI。

## 代表截图

- [Peer 深色窄屏配置](peer-config-narrow.png)：有效草稿可以保存，界面留在视口内。
- [Twitter 继承 Host 中文](twitter-time-picker.png)：真实 MF remote 使用共享 UI 的日期文案。
- [Mail 窄屏附件和失败反馈](mail-host-dark-narrow.png)：附件行换行，下载按钮保持完整。

以下为首次视觉复审后的构建，取代首轮产物哈希；后续 I1 的变化见文末。构建目录按相对路径排序，依次拼接「路径、NUL、文件内容、NUL」计算 SHA-256，包含 source maps：

| 产物                    | 文件数 | SHA-256                                                            |
| ----------------------- | ------ | ------------------------------------------------------------------ |
| Web dist                | 11     | `dbebfdbc2c6a93cbcf342e7d432fa58950af61a305595f77f25f680bb8670904` |
| mail dist/client-web    | 44     | `e8b1f1a71c313e3ab12995d7c85b991fb83c5280d43557988d2337f69542ccc3` |
| twitter dist/client-web | 47     | `b611416d626f44bdc13f99e65787df55acad16713b95c96881965389988f6891` |

## 视觉复审补验

首轮验收证明 API 与交互可用，未覆盖完整设计迁移。本次重放脚本增加以下观察边界，并逐张复查截图：

| 页面或边界                | 实际检查                                                                                          | 证据                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Mail 正文与附件           | 保留 iframe 隔离；长附件名换行；直角附件容器；下载 pending 和失败恢复，错误使用反馈前景           | [窄屏 Mail](mail-host-dark-narrow.png)                                |
| Text／HTML 文本／Tweet    | 打开后能够读到完整正文末尾；覆盖 body-md 字号为 21px 后跟随变化；Tweet 根节点接收宿主的间距与滚动 | [窄屏 Tweet](tweet-host-dark-narrow.png)                              |
| 搜索                      | 真实 Host 调用隔离检索响应，结果标题、正文和元数据按角色显示，结果按钮与输入使用直角              | [窄屏结果](search-dark-narrow.png)                                    |
| Sources／Source 详情      | 1280px 并排、375px 换行；长名称、配置及操作没有横向裁剪；Enter 激活详情链接；配置弹层位于视口内   | [宽屏](sources-1280.png)、[窄屏](sources-375.png)                     |
| Job／Logs                 | 元数据和日志按容器换行；Enter 展开原生日志按钮并更新 aria-expanded，结构化属性可局部滚动          | [窄屏日志](job-375.png)                                               |
| Extensions／Twitter setup | 安装与扩展列表可换行；Host 与 MF remote 的中文时间草稿交互继续通过                                | [窄屏扩展](extensions-375.png)、[时间选择器](twitter-time-picker.png) |

复审后的 `pnpm check` 和浏览器重放均通过，pageerror 为零。Settings、Peer、Mail 事实与 MIME 局部视图、ext-dev-utils 开发页的字体／形状调整经过源码核对及完整构建；本轮没有为每个局部视图另造浏览器页面。旧 Peer 截图仅保留首轮保存交互的证据，不作为更新后视觉样式的截图。

本阶段步骤编号仍保留圆形，生产者当时尚未确认直角默认和例外；这一历史边界已由文末 I1 更新。Mail iframe 的白色底属于外部邮件文档边界。浏览器扩展 client-webext 使用自有主题而非 UI 依赖，本轮没有迁移该独立主题。

Recall 浮层同样补验了 375px 下的检索结果、Escape 关闭与容器宽度，见 [窄屏 Recall](recall-dark-narrow.png)。Job 状态 JSON 的等宽字体也通过实际 computed style 验证。

## I1 已确认风格的实现对齐

2026-09-13，按与用户确认后的共同轮廓，Twitter 步骤编号改为直角；窄屏复核同时修复了向导宽度未受宿主内容区约束、关闭按钮被裁剪的问题。新的 [375px 向导](twitter-steps-375.png) 展示完整的关闭按钮、两列步骤和可换行的配置内容。

最终完整 `pnpm check` 与上述浏览器重放通过。夹具新增四个步骤、唯一当前状态、直角编号、375px 容器无横向裁剪和关闭按钮完整可见的检查；时间草稿取消／确认及其余已有旅程继续通过，pageerror 为零。本地采用 Chromium 149.0.7827.55，未进行真实 OAuth、扩展发布或生产部署。

Web 与 Mail 产物和上表一致；Twitter 构建仍为 47 个文件，新的 SHA-256 为 `7a1156f93e543a8a4be79e2c80a4cfa437a72d6cab00d795578018981d01e3bb`。UI 依赖仍是 registry 2.0.0，没有启用源码映射；这些检查验证消费者局部修正，不宣称已安装生产者分支中尚未发布的字体和文档更新。

## I3 来源页面的内容与状态

本轮对应 `6a61637` 之后尚未提交的 I3 改动，Web、Core 与 Twitter 实现已完成。完整 `pnpm check`、TS7 和 Changeset 状态检查通过；实际构建的 Host／Twitter／Mail 重放通过，pageerror 为零。UI 依赖仍是正式 registry 2.0.0；截图不包含生产者 `284ade6` 尚未发布的 I2 配色，也未启用源码联调。

来源列表保留名称、类型、ID 和采集入口，完整配置在详情读取与修改。创建和调度表单通过明确动作打开；来源、计划和任务分别显示实际状态。回到列表时定位并聚焦对应来源，失败与尺寸变化保留原始草稿。Host 同时补上 `presetInk()` 注册，语义错误色类现在实际生成；没有新增颜色覆盖或依赖。

沿用上方重放命令；命令中的 `node` 可通过 `pnpm exec node` 使用仓库声明的 Node 22.22.3。[来源旅程](https://github.com/InKCre/impl-ts/blob/ec5dd1e3877db30bf51b5780b1a6bc7d31e3ba01/tasks/ui-v2-migration/evidence/sources.mjs) 由既有 [Host 脚本](https://github.com/InKCre/impl-ts/blob/ec5dd1e3877db30bf51b5780b1a6bc7d31e3ba01/tasks/ui-v2-migration/evidence/browser-host.mjs) 调用，使用原有 Playwright 和 Chromium，未新增发布门禁或测试框架。

| 边界             | 验证内容                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表与导航       | 三个来源、无昵称、活动任务入口、空结果、加载、读取拒绝与重试；名称 Enter 导航和返回锚点；1280px／375px 不横向裁剪                           |
| 配置             | JSON 语法／schema 无效时禁用保存；类型读取失败与重试保留草稿；保存延迟与 HTTP 503 拒绝；昵称、原始多行 JSON、窄宽切换、手动重试与保存回显   |
| 来源与任务上下文 | 源详情／任务／计划读取分别失败与重试；过期来源响应不能覆盖新路由；未保存的类型修改不能改变已保存来源的采集 schema；不支持回补时没有对应选项 |
| 创建与删除       | 来源创建及计划创建失败／pending／成功；关闭确认保留输入；来源和计划删除等待／403 拒绝／重试；仅确认成功后移除条目或离开                     |
| 采集             | 带配置的新任务与列表立即采集的 pending、失败与重试；实际请求使用对应 Source ID 和配置，不自动重发写入                                       |
| 关联消费         | Twitter 来源读取失败保留旧选择和 07:30 时间草稿，重新选择成功；Host 中文时间取消／确认、Mail 下载失败、全文阅读和既有窄屏旅程继续通过       |

[运行输出](i3-browser.txt)、[隔离读写结果](i3-verification.json) 与[产物身份](i3-artifacts.json)共同记录本次边界。浏览器中 403／503 和 Mail 的 500 是主动注入；检查明确要求最终 pageerror 为零。仅验证前端状态、请求与 UI 集成，不宣称数据库持久化、真实 OAuth 或 Mail 服务已验收。

代表截图已逐张查看：

- [宽屏列表](i3-sources-1280.png)、[窄屏列表](i3-sources-375.png)：识别信息与操作保留，列表不再常驻编辑器。
- [宽屏详情](i3-source-1280.png)、[窄屏保存失败](i3-source-save-failed-375.png)：对象身份、配置与近期任务分组，错误接近相关操作。
- [窄屏创建](i3-source-create-375.png)、[删除拒绝](i3-source-delete-failed-375.png)：弹层宽度、可恢复草稿和带对象上下文的确认。
- [Twitter 读取拒绝](i3-twitter-selection-failed.png)：选择与时间草稿保持一致。

构建身份采用上文相同的目录 SHA-256 算法，包含 source maps：Web 为 `fb30b72d2ab988f2d31046a419c026d7fa73c124b103436eb5c2de1b701b1cd9`；Core、Mail、Twitter 的文件数与哈希见产物 JSON。Mail 的源码本轮未修改，其构建引用了更新后的共享 Core。

真实数据库 `pnpm test:e2e:web` 本次仍在 SSH provider 握手时被连接重置，未进入浏览器，不能拿历史 PR CI 证明当前 I3。额外 `pnpm lint:type-aware` 仍报告基线中的 11 项：数据库生成投影 9 项，Extension model 与分发检查脚本各 1 项；这些位置的相关代码没有修改。常规 lint、完整 check 与 TS7 通过。`client-webext` 的独立主题与 Firefox 原生 200% 文字放大不属于此切片。

## PR preview 远端验收

[PR #104](https://github.com/InKCre/client-web/pull/104) 的 I3 源码提交为 `9af7a17`。该提交的 [CI](https://github.com/InKCre/client-web/actions/runs/34759273081) 与 [Pages 交付](https://github.com/InKCre/client-web/actions/runs/34759272059) 全部成功。实际浏览器进入 [preview](https://preview-client-web-pr-104.inkcre-client-web.pages.dev)，Host、同源静态 Registry、Mail／Twitter MF 资源均由远端提供；全部既有来源与扩展旅程通过，pageerror 为零。

```sh
pnpm exec node tasks/ui-v2-migration/evidence/browser-host.mjs https://preview-client-web-pr-104.inkcre-client-web.pages.dev --deployed-extensions
```

[交付身份](preview/delivery.json) 与[运行输出](preview/browser.txt)记录已验证的源提交和不可变部署地址。业务数据和失败响应仍为隔离夹具；真实数据库集成由独立 E2E 证明，不将静态 preview 说成完整后端环境。原有本地 tarball／dist 哈希不能当作远端产物哈希。

本机 SSH 已恢复；首轮冷启动暴露 PostgreSQL 的 socket 健康探测早于 TCP 就绪，已在独立 `cfd7b12` 修正。随后完整 `pnpm test:e2e:web` 退出 0，五个真实数据库旅程通过，隔离实例清理完成；最终 `pnpm check` 通过。该提交未改变前端源码，其 [CI](https://github.com/InKCre/client-web/actions/runs/34759512696) 和 [preview](https://github.com/InKCre/client-web/actions/runs/34759511768) 单独记录，不把较早的前端证据写成新提交重放。

## 正式 UI 2.0.1 升级

[UI 发布](https://github.com/InKCre/ui/releases/tag/%40inkcre/ui-web%402.0.1) 来自 main `85453b50eee3a8e1db21cdedaca05ba0b6051dd6`。四个直接消费者均安装精确 2.0.1，见 [registry 与实际安装身份](ui-2.0.1/installed.json)。完整 `pnpm check` 与本地真实构建重放通过，pageerror 为零。业务失败仍由隔离网络夹具注入。

新增 Header 验证覆盖浅深主题和 375／1280px：装饰图标为 24×24，mask 与可见 currentColor 填色存在；按钮自身没有 mask，点击图形、Enter 和 Space 正确切换侧栏，键盘焦点轮廓完整。侧栏宽度包含内边距与边框；移动断点内覆盖主内容，打开前后主内容宽度不变。窄屏容纳检查与截图复核通过。来源、Mail、Twitter 原有全旅程均通过，新版字体与配色随正式包生效。

正式远端复验通过：[部署身份](ui-2.0.1/delivery.json) 对应源码 `d027230`、[preview run](https://github.com/InKCre/client-web/actions/runs/34799553542) 与部署 `52f3ec3f`。使用 `--deployed-extensions` 加载实际 Host、同源 Registry 和两个 MF 产物，全旅程退出 0，pageerror 为零，见 [日志](ui-2.0.1/browser-output.txt)。截图：[浅色窄屏菜单](ui-2.0.1/released-header-light-375.png)、[深色窄屏菜单](ui-2.0.1/released-header-dark-375.png)、[来源列表](ui-2.0.1/i3-sources-1280.png)、[Mail 失败反馈](ui-2.0.1/mail-host-dark-narrow.png)、[Twitter 时间选择](ui-2.0.1/twitter-time-picker.png)。菜单截图中的轮廓为键盘焦点，普通状态没有边框。

最终功能提交 `d027230` 的 [完整 CI](https://github.com/InKCre/client-web/actions/runs/34799554488) 全部通过，包括 Web 真实数据库旅程、浏览器扩展 E2E 与工作区契约检查。后续文档归档提交没有改变运行时代码。

## I4：Twitter、Mail 与 Graph

本轮以正式包 DESIGN.md 的内容取舍、视觉语言及页面组合为比较依据。Twitter 保留当前步骤与完成摘要，应用凭据按需展开，保存与授权分开；Mail 让邮件内容优先，附件按行组织，信头、内嵌内容与相关邮件可展开，事实摘要不罗列底层字段；Graph 保留场景上下文，选项按需打开，节点可通过键盘聚焦与查看，方向弱化保留可读内容。

完整 check 与原有浏览器旅程通过。扩展的 [I4 重放](https://github.com/InKCre/impl-ts/blob/ec5dd1e3877db30bf51b5780b1a6bc7d31e3ba01/tasks/ui-v2-migration/evidence/i4.mjs) 使用真实构建的 Host 与 MF 产物，验证首次使用、草稿、等待、失败重试、已配置、展开详情、下载、图检索和返回。通过既有 Storage 读取隔离字节并产生真实 Blob 链接；邮件 iframe 不允许脚本、同源访问或外部追踪图像，仅应用清理后注入的固定排印。Graph 验证方向切换不增加数据库读取，拖拽位置在选项变化后保留，读取失败、缺失、空结果、已找到／未找到路径与超出边界分别呈现。

375px 的 Graph 默认聚焦当前对象，使用平移和缩放访问邻域；不要求所有节点同时挤入视口。截图禁用过渡动画并等待相机定位，避免将途中帧作为最终布局。单独重放本轮可在原命令后加 `--i4-only`；远端加 `--deployed-extensions`。详细日志和代表截图位于 [I4 证据目录](i4/)。实际 OAuth 与真实邮箱未执行，数据库 E2E 由同一 PR 的独立 CI 检查。
