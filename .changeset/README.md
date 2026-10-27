# Changesets

用户可见的 MF Extension 或 WebExt 变更携带一个 Changeset，声明对应包和 SemVer 影响；运行 `pnpm changeset` 创建。工作区 Version PR 消费这些文件并更新版本与 changelog，本身不发布。

WebExt 是独立 Peer，不通过 MF Extension Registry 分发。其浏览器包和 GitHub Release 流程见[WebExt 版本与分发](../docs/40-deployment/webext-delivery.md)。
