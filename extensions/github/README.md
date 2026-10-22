# GitHub MF

本分发为当前浏览器 Peer 注册 GitHub Account、Repository 和 List 的预览及内容渲染能力，读取 info-base 中已持久化的 Block 和 Relation。它不调用 GitHub API，不领取采集 Job，不读取 Source token，也不要求 Python 分发在线。

数据契约来自已发布 `inkcre/github` Python 0.3.2 wheel（SHA-256 `d6de19164af8e6c3ec74d0bea940b9ce8d657b12373028de85bf9e3670a0c5db`）中的 v1 schema/resolver。`src/schema.ts` 负责结构、默认值及可空值的运行时校验；`src/resolver.ts` 保留相应文本投影，并为渲染提供关系上下文。这个来源不建立版本配对，MF 使用独立版本，只声明真实 Host SDK 范围。

账号区分 User 和 Organization。完整内容展示持久化 `stars` 指向的仓库、`owns` 指向的仓库和列表；仓库展示入向 `owns` 的账号。列表的成员只来自当前持久化 `contains` 边，入向 `owns` 提供账号上下文。未采集或已删除的目标不会变成虚构成员；记录结构错误按 Host 的内容读取失败显示。相关条目通过 InfoBaseRouter 导航到原 Block，不生成 GitHub 列表 URL，也不进行采集。

预览保留识别对象所需的标题、摘要与状态，完整渲染不截断正文。外部文字通过 Vue 文本插值显示；链接和头像只接受无嵌入凭据的 HTTP(S) URL，外链隔离 opener，头像不发送 referrer。未知协议保持不可点击，不执行外部内容。

模块导入不注册 resolver；initialize 注册三个精确 class，dispose 仅注销自身 class。Host 在部分 initialize 失败时同样调用 dispose，因此停用后新的 resolver 查找失败，重新启用同一 class 允许复用现有缓存；更换 class 后下一次缓存读取释放旧实例并创建新实例。这不保证物理清空缓存。详情打开与刷新重新读取 Block 并创建 Resolver；关系显式刷新读取当前 edges，不依赖 focal Block 时间戳变化。共享 Block、Relation、Extension config/state 不由这些生命周期操作修改。

本地开发入口是 `src/main.ts`，Host 加载入口是 `src/index.ts`。构建遵循同仓原生 MF 规则，输出可重定位 `dist/client-web` 和 `mf-manifest.json`。初次版本由 minor Changeset 与正常 Version PR 从未发布占位 `0.0.0` 生成 `0.1.0`；占位源码有待消费 Changeset，不能作为生产候选发布。正式发布遵循 [独立 MF 交付流程](../../docs/40-deployment/native-extension-delivery.md)。
