# @inkcre/core

独立程序使用 `@inkcre/core/sdk`。这一入口提供明确绑定连接的 `DatabaseClient`、类型化关系与 RPC 合同、JWT 签名、PostgreSQL 字节存储和 Peer 协议／Resolver 身份。支持有标准 Fetch API 的 Node.js 与浏览器环境，通过已有 PostgREST 数据库协议访问共享状态。

```ts
import { DatabaseClient, signDatabaseToken } from '@inkcre/core/sdk'

const connection = {
  baseUrl: 'https://database.example/rest/v1',
  tokenProvider: () => signDatabaseToken(secret),
}
const blocks = new DatabaseClient('blocks', undefined, connection)
const { data, error } = await blocks.from().select().eq('id', blockId).maybeSingle()
if (error) throw error
```

连接由调用方提供；客户端捕获 URL、认证函数与 Fetch 引用，不读取应用的当前连接。认证函数应绑定自己的凭据来源。构造不发请求、不注册 Peer、不启动 timer；客户端不拥有连接池或后台任务，无需关闭，也不关闭借用的 Fetch 资源。查询的取消使用 PostgREST builder 的 `abortSignal`。创建多个客户端不会共享配置或认证状态。

`PostgreSQLBlobStorage.forConnection(connection)` 提供原有 bytea RPC 和稳定 UUID pointer 的读、创建、更新和删除。返回的字节与 pointer 语义与旧入口一致。它和旧 `PostgreSQLBinaryStorage` 复用同一实现。普通关系访问、写入序列化与错误处理同样只有一份实现；Web/WebExt 的 `DBAPIClient` 在此之上提供 Vue 应用选中配置的兼容行为。

已发布的 `@inkcre/core` 根入口继续保留 Vue/Pinia 模型、应用配置 store、导航、Renderer 与 Extension Host 合同，供现有 App 和 MF 分发兼容使用。这些能力不会经 `/sdk` 重导出。根入口使用者仍需安装 Vue、Pinia、VueUse；独立 SDK 使用者不需要，包的框架 peer dependency 为 optional。两入口采用分开的构建与声明依赖图，避免只隔离 JavaScript 而留下类型声明的 UI 依赖。

这是按实际用途切出的消费边界，不是新的平台适配包。当前独立入口不承诺覆盖根入口所有高层领域 facade 或 Host UI；需要既有 Vue 生命周期的功能继续从兼容入口消费。Core SDK 版本仍由包自身发布，数据库协议与 MF Host ABI 仍按各自原合同判断。

`node --test scripts/tests/core-independent.test.mjs` 从本仓根检查真实 npm tarball：仓库外导入、无 UI 声明编译、并发目标隔离、序列化和二进制请求。测试使用受控传输，不连接真实数据库；构建与本地检查不能替代跨语言端到端验收。
