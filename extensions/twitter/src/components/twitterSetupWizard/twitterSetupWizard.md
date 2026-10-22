# TwitterSetupWizard

Twitter 扩展提供四步配置视图，宿主 Extensions dialog 挂载组件并处理 `close` 事件。进度来自当前 Core、OAuth、来源和调度事实，不持久化页面步骤。已走过的步骤提供返回入口，已完成时显示账户、来源与可读的每日采集时间。

用户先选择采集客户端，再配置自己的 X OAuth 应用。已有应用的凭据默认折叠；未保存的修改不能用于创建授权链接。授权在独立标签页完成，当前页只轮询不透明交易引用，显示等待或失败，并在成功后进入来源配置。凭据保存失败保留草稿，Secret 保持掩码。

当所选 Core 的 Twitter setup status 提供 `x_monkey_base_url` 时，准备页另外显示 x-monkey 服务地址和通向同一 Core `/twitter/x-monkey/account` 页的普通链接，保留部署路径前缀。Web 不在此流程中读取密钥或签发 JWT；用户在自己信任的 Core HTTPS 账户页完成连接，再返回脚本检测。连接不依赖 X OAuth，也不要求安装 Web 分发。旧 Core 未提供此字段时不猜测功能版本，也不展示连接操作。

来源选择、创建和每日调度围绕当前对象显示。保存完成后进入确认，只有明确激活 Start collecting bookmarks 才启用调度并触发首次采集。普通进度保持中性色，错误直接显示；请求等待期间禁止重复动作与组件内 Close，关闭或卸载会停止授权轮询。宿主 dialog 自身的关闭策略仍由宿主负责。
