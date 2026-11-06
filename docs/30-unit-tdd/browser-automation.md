# Web Source 的本机浏览器能力

当 Web 中运行的 extension Source 需要借用用户浏览器的登录态、页面交互或页面网络响应时，使用本 Unit。Source 继续由普通 MF Distribution 交付，Web Peer 通过共享 Job 协议领取任务；Web-ext 承担本机标签页和调试会话执行。站点业务逻辑与数据模型不进入 SDK 或 Web-ext。

## 资格与配置

`SourceImplementation.canCollect(source, config)` 与 `canBackfill` 是可选的业务资格钩子。普通 Source 没有钩子时沿用已注册实现的判断。浏览器 Source 可调用 `BrowserAccess.hasBinding(provider)` 检查本 Web Peer 是否已明确配置该兼容 Provider；不得用实时连接、权限或登录检查使任务无声停留 pending。命令配置不合法时仍进入执行验证并失败。

Provider 是 Web-ext 加入所选信息库时配置的确切 Peer UUID。浏览器实例另有保存在扩展本机 storage 的随机 `instance`；运行中的 service worker 再提供短期 `epoch`。绑定同时固定 Provider 和 instance，不根据另一个在线实例替换浏览器或账号。

Web 绑定保存在本机 localStorage，以当前 Web Peer UUID 和数据库地址分隔。`bindings()` 和 `hasBinding()` 只读这份配置；它们不声称浏览器当前在线。未配置时 Source 不领取；已有绑定但桥断开、授权撤销或账号失效时，已领取的执行明确失败。

## 原生授权和通信

1. 用户在 Web-ext 设置中为当前信息库授权可信的 InKCre Web 地址。
2. 原生 host 权限通过明确的用户操作请求，扩展只为授权的站点注册打包内的 bridge content script。
3. Web 调用 `BrowserAccess.discover()`，用户明确选择后 `bind(binding)`；选择结果不是自动授予扩展端权限。
4. Web 页面通过同 origin 的 `window.postMessage` 与 content script 通信，再由 `runtime.Port` 到 background。background 对每次请求检查真实 sender、顶层 frame、完整 origin、当前原生授权及精确 Provider/instance。

浏览器的 host 权限模式不区分端口；扩展端的完整 origin 授权会区分。允许一个 localhost 端口不会使另一端口获得自动化权限。消息的名称、UUID 和 namespace 都不替代授权；同一已授权 origin 的页面脚本处于同一个信任范围。

动态授权适用于自托管地址，不需要将用户域名写入 manifest，也不需要云端或 HTTP 中继。撤销授权释放该 origin 的会话并移除后续脚本注册。已有页面上的 bridge 不能绕过 background 的实时检查。

## Source 接口

```ts
await BrowserAccess.withPage(
  { provider: configuredProvider, target: { kind: 'new' }, signal },
  async (page) => {
    await page.goto(sourceUrl)
    await page.waitForSelector('[data-ready]')
    return page.evaluate(() => document.title)
  }
)
```

`BrowserPage` 是 Puppeteer 的真实 `Page` 类型。`tabs(provider, signal?)` 返回当前可借用的 HTTP(S) 标签页短期引用；`target: {kind: 'existing', tab}` 必须使用当前枚举结果。引用绑定调用页面、Provider、实例、service-worker epoch 和单次 reference UUID，枚举刷新或一次使用后失效；不能把裸 tabId 当成可长期持有的权限。

新建标签页正常结束时关闭；借用标签页解除调试并保留。开始控制时将目标设为其浏览器窗口的活动标签页，保证浏览器渲染和原生点击可执行；这会改变该窗口的活动标签页，不声称恢复用户原来的浏览位置。相同标签页的控制互斥，旧 Page 不能在结束后继续发命令。网页已发生的变化不会回滚，Source 自己负责账号确认、站点身份、分页、预算、增量进度和业务写入。

Abort 会中断 Page 连接、请求后台释放，并等待 Source callback 退出与原生清理；不会通过 Promise.race 提前把仍执行中的 callback 算作结束。bridge 断连向请求与 Page 传播失败。已经派发的效果可能未知，不自动重放命令或替换 Provider。打开动作的会话 ID 由调用方预先产生，打开响应丢失后仍能向原目标请求清理。

## Puppeteer 适配边界

依赖固定为 `puppeteer-core@25.16.0`，两端使用同一版本。Web-ext 复用官方实验性 `ExtensionTransport`，由 `chrome.debugger` 执行；每个连接对应一个标签页，标签页创建和释放由 Web-ext 完成。

25.16 的 public browser entry 在构建图中仍引入 Node-only 的 channel 连接分支。SDK 使用该固定版本的窄 CDP connector，等同于官方 connect 在给定 transport 后选择的 CDP 路径，避免要求每个 Host/MF producer 设置 Node externals。它是明确的内部入口维护点；升级依赖时需重新检查与实测。Page、Connection 和自动化命令仍来自 Puppeteer，不是自实现的兼容层。background 静态导入窄 ExtensionTransport 模块，避免 service worker 执行动态 import。

该版本的 `ExtensionTransport.close()` 原本丢弃 native detach Promise。本仓库仅补丁修改其返回值及声明，使外层可以等待原生 detach 完成；补丁行为测试验证等待和事件监听清理。外层另监听原生 `debugger.onDetach`，处理目标关闭、DevTools 抢占等会话中断。上游提供等价保证时移除该补丁。

Chromium 构建声明必选 `debugger` 权限，最低 Chrome 125，覆盖 flat child sessions；该权限不能作为 optional 权限运行时申请。Firefox 构建保留既有材料采集，但不暴露这条 debugger 自动化能力。不能从一次 Page 操作通过推定完整 Puppeteer API 兼容，也不承诺关闭 Web 或浏览器后继续 Job。

协议 DTO 由 `@inkcre/core/browser-automation/protocol` 独立入口交付，content script 只导入这个轻量入口，避免运行 Core root 的 Job 注册等副作用。

## 验证入口

`pnpm exec node --test scripts/tests/browser-automation-transport.test.mjs` 检查限定版本补丁的 native Promise 行为。`pnpm exec node scripts/verify-browser-automation.mjs` 使用生产扩展构建、真实 SDK 和隔离 Chromium profile 运行合成登录站点；测试进程不连接远程 CDP，因此不会占用被测标签页的调试连接。它检查实际导航、登录态、点击和后续批次、响应体、标签页清理、借用页保留、旧引用、Abort、精确 Provider 与同 host 不同 origin 的授权边界。这些检查也接入 `pnpm test:e2e:webext`，位于既有材料采集回归之前。

同 origin 的多个 Provider 共用 Port。撤销 A 只释放 A 的会话；B 仍获授权时不能断开共用 Port。隔离验收在 B 的真实 Page 会话活跃时撤销 A，检查 B 仍可执行。`scripts/tests/job-cancellation.test.mjs` 检查已取消 pending Job 及 claim 期间收到取消时不启动业务 handler；普通不合格任务继续 pending。

合成站点的测试副本只为合成 host 预授予权限，不能替代原生授权 UI 或真实 B 站登录态的业务验收。用户实际业务数据的验收由相应扩展与任务证据维护。

依据：[Puppeteer 扩展指南](https://pptr.dev/guides/running-puppeteer-in-extensions)、[Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)。
