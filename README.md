# ZSXQ Article to PDF Helper

小工具集合，基于 Puppeteer 把知识星球文章批量或单页保存成 PDF。

## 快速开始
- 安装依赖：`pnpm install`（或 `npm install` / `yarn`)
- 运行批量爬取：`node getContent.js`
  - 会读取 `MAIN_URL`，抓取其中的“文稿”短链，解析真实文章 URL，打印成 PDF 保存到 `pdfs/`。
- 单页下载（无需浏览器实例）：
  ```js
  const { downloadPdf } = require('./getContent');
  downloadPdf('https://example.com/article', 'demo')
    .then(p => console.log('saved:', p))
    .catch(console.error);
  ```

## 关键点
- 依赖 Puppeteer，无头浏览器自动启动；默认加上内置 Cookie，适合受保护的文章。
- PDF 输出目录：
  - 批量脚本：`pdfs/`
  - `downloadPdf` 默认也写入 `pdfs/`，可传第三个参数修改。
- 文件名会做合法化处理（去除非法字符、限制长度），并自动补 `.pdf`。
- 样式调整：隐藏页面二维码容器，放大 `.post` 区域，减少水印干扰。

## 常见问题
- 如果访问 403/需要登录：更新 `headers.Cookie` 里的 token。
- 若生成速度慢：可调低 `sleep` 等等待时间；但过快可能触发风控。
- Chrome 路径：如需自定义，可在 Puppeteer `launch` 里设置 `executablePath`。

## 文件结构
- `getContent.js`：批量抓取与 PDF 打印逻辑，同时导出 `downloadPdf`。
- `zsxq.js`：项目内其他脚本（未改动）。
- `downloads/`、`pdfs/`：输出目录（运行时自动创建）。
