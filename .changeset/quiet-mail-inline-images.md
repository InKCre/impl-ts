---
'@inkcre/ext-mail': patch
---

修复普通邮件隔离正文无法显示已下载 CID 图片的问题：将已材化的图片字节转换为正文专用 data URL，清除源邮件自带的 SVG 图像引用，保留禁止脚本与同源访问的 sandbox，以及远程图片阻断；MIME 条目的独立打开继续使用 Blob URL。
