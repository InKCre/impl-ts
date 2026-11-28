# Twitter renderer 阅读验收

本入口使用真实 Twitter renderer、`PreviewRenderer`、`BlockNode` 和 `SolvedContentPopup`，以合成记录替代信息库读取。媒体仍经过实际 `ArchiveMediaResolver` / `HttpStorage`，图片与视频由同一个本地服务提供，不读取凭据、不连接第三方。它用于检查阅读呈现与宿主交互，不能证明采集、数据库持久化或远程扩展加载正确。

从仓库根目录运行：

```sh
pnpm --filter @inkcre/ext-twitter exec vite --config ../../scripts/tests/twitter-rendering/vite.config.ts --host 127.0.0.1 --port 5188 --strictPort
```

手工检查使用 `agent-browser` 的独立命名 Helium 会话打开 `http://127.0.0.1:5188/`，通过样本、视图和主题选择器观察。自动候选检查使用仓库锁定的 Playwright Chromium，结束时关闭隔离浏览器；不连接日常配置，也不加入测试 runner 配置：

```sh
node scripts/tests/twitter-rendering/verify.mjs
```

`TWITTER_UI_BROWSER` 可显式指定本机浏览器可执行文件路径，用于特定浏览器的专项检查。若该浏览器连原生元素的 `requestFullscreen()` 都拒绝，应记录为该浏览器专项的执行限制，不能据此认定 renderer 产品失败；默认 Chromium 仍须通过全屏成功和受控拒绝后的可用性检查。已观察到隔离 Helium 157 在视频正常解码、播放后拒绝全屏，原生 DIV 也会被拒绝。

默认截图写入 `.runtime/twitter-rendering/`，也可用第一个参数指定输出目录。检查涵盖按需加载、单图与多图、原帖链接、新旧格式的图片放大及关闭后的焦点恢复、关闭后的 Blob 释放、引用跳转、完整长文、缺失内容、加载失败重试、视频不自动播放、全屏尺寸与播放状态保留、全屏拒绝后的播放器可用性、零计数、独立媒体 Block、窄屏深色和图谱长文预览尺寸。图片也会从实际内容弹窗放大，检查它覆盖弹窗、适配窄屏，并且 Escape 只关闭大图。视频退出全屏的自动检查使用浏览器 API；原生 Escape 的行为仍需人工检查。人工还需观察字体层级、媒体裁切和浅深主题的整体阅读效果。

图片与两秒无声 MP4 均为本任务生成的合成尺寸样本。MP4 同时供既有 `twitter-info-base.spec.ts` 使用，以实际可解码的视频替代不完整文件头。这些检查保留在 `scripts/tests`，不加入正式测试或默认 CI。
