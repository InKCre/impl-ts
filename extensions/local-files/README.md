# 本地文件读取分发

解释 `inkcre/local-files` 的文件资料与 `body` 正文，展示 Peer 位置和原件状态。原件位置仅为文字，不将自定义 scheme 交给浏览器或远程取文件。目录监视与扫描 Job 由具备本机文件访问能力的分发执行；此包只注册 Resolver。

共享合同见 InKCre/docs 的 `20-product-tdd/local-files-contract.md`。使用 `pnpm --filter @inkcre/ext-local-files build` 构建可重定位的 Module Federation 分发。
