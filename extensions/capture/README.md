# Capture 读取分发

该原生 Module Federation 分发解释 `extensions.capture.capture.v1` 与 `extensions.capture.attachment.v1`，复用 Core 的文本、图片、存储和内容导航。它显示有序原材料、真实出处与单独的用户附注，不执行提交或依赖采集端在线。

Host SDK 要求 `@inkcre/core >=0.4.0 <0.5.0`。通过 Registry 选择并启用本浏览器的 `module_federation` 分发；`initialize` 注册 Resolver，`dispose` 只移除本分发拥有的类。Swift、Python 与 Web 分发按各自能力对等参与同一 Extension。

共享图与提交语义由 [Capture Extension 合同](https://github.com/InKCre/docs/blob/main/20-product-tdd/capture-contract.md) 维护；字段验证在 `src/schema.ts`，顺序和引用校验在 `src/resolver.ts`。缺失材料显示错误，不触发采集端重新抓取。来源 URL 只允许 HTTP(S) 作为可点击链接。

运行 `pnpm --filter @inkcre/ext-capture type-check` 与仓库 `pnpm build`。`dist/client-web` 是可重定位的发布制品，`src/main.ts` 只用于开发说明页。真实验收应安装生产构建，停止原采集者后冷启动打开共享根 Block，检查原文、图片字节、顺序和附注。

Mac 自行通过共享数据库原子写入，不依赖 Python Peer。此 Web 分发只负责读取与呈现，未启用它不影响采集写入。
