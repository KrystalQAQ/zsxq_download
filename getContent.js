const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// ==================== 配置 ====================

const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    'Accept': 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    'origin': 'https://wx.zsxq.com',
    'priority': 'u=1, i',
    'referer': 'https://wx.zsxq.com/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'x-aduid': '7c16b6eae-3d6b-4f4f-8eaf-7d7100f0bf3',
    'x-request-id': 'bfbeb9b4e-6d35-8bf4-60d2-3d3493bc934',
    'x-signature': 'e663d06067c083813ffa373a1cbf5f211d9209cc',
    'x-timestamp': '1769588269',
    'x-version': '2.88.0',
    'Cookie': 'sensorsdata2015jssdkcross=%7B%22distinct_id%22%3A%221966bb65a794af-05ab826c4cb1d48-26011c51-2359296-1966bb65a7a4bb%22%2C%22first_id%22%3A%22%22%2C%22props%22%3A%7B%22%24latest_traffic_source_type%22%3A%22%E7%9B%B4%E6%8E%A5%E6%B5%81%E9%87%8F%22%2C%22%24latest_search_keyword%22%3A%22%E6%9C%AA%E5%8F%96%E5%88%B0%E5%80%BC_%E7%9B%B4%E6%8E%A5%E6%89%93%E5%BC%80%22%2C%22%24latest_referrer%22%3A%22%22%7D%2C%22identities%22%3A%22eyIkaWRlbnRpdHlfY29va2llX2lkIjoiMTk2NmJiNjVhNzk0YWYtMDVhYjgyNmM0Y2IxZDQ4LTI2MDExYzUxLTIzNTkyOTYtMTk2NmJiNjVhN2E0YmIifQ%3D%3D%22%2C%22history_login_id%22%3A%7B%22name%22%3A%22%22%2C%22value%22%3A%22%22%7D%2C%22%24device_id%22%3A%221966bb65a794af-05ab826c4cb1d48-26011c51-2359296-1966bb65a7a4bb%22%7D; abtest_env=product; zsxq_access_token=388FB36B-3F51-4614-9F81-044EE93D1740_EBEEFFE272079886'
  }

const MAIN_URL = 'https://articles.zsxq.com/id_w0623chi6x4k.html';
const OUTPUT_FILE = 'article_urls.json';
const PDF_OUTPUT_DIR = 'pdfs'; // PDF 文件输出目录

// ==================== 工具函数 ====================

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 清理文件名，移除非法字符
function sanitizeFilename(filename) {
    // 移除或替换 Windows 文件名中的非法字符
    return filename
        .replace(/[<>:"/\\|?*]/g, '_') // 替换非法字符为下划线
        .replace(/\s+/g, '_') // 将空格替换为下划线
        .substring(0, 100); // 限制长度
}

// 基础请求函数
async function fetchPage(url) {
    try {
        const config = {
            method: 'GET',
            url: url,
            headers: headers,
            maxRedirects: 5
        };
        const response = await axios.request(config);
        const finalUrl = response.request.res.responseUrl || url;

        return {
            data: response.data,
            finalUrl: finalUrl,
            originalUrl: url
        };
    } catch (error) {
        console.error(`请求失败 ${url}:`, error.message);
        return null;
    }
}

// 带重试的请求函数
async function fetchWithRetry(url, maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (maxRetries > 1) {
            console.log(`  尝试 ${attempt}/${maxRetries}...`);
        }

        const response = await fetchPage(url);

        if (response) {
            return response;
        }

        if (attempt < maxRetries) {
            console.log(`  请求失败，${retryDelay / 1000} 秒后重试...`);
            await sleep(retryDelay);
        }
    }

    console.error(`  请求失败，已重试 ${maxRetries} 次`);
    return null;
}

// ==================== 核心业务函数 ====================

// 从主页面提取所有"文稿"链接和标题
function extractDocumentLinks(html) {
    const $ = cheerio.load(html);
    const links = [];

    $('.content.ql-editor a').each((i, aElement) => {
        const $link = $(aElement);
        const linkText = $link.text().trim();

        if (linkText === '文稿') {
            const linkHref = $link.attr('href');
            if (linkHref) {
                // 获取同级的 span 标签内容作为标题
                const $parent = $link.parent();
                const $span = $parent.find('span').first();
                const title = $span.text().trim().split("（")[0] || `未命名文章_${i + 1}`;
                console.log(title)
                links.push({
                    url: linkHref,
                    title: title
                });
            }
        }
    });

    return links;
}

// 从 URL 中提取 topic_id
function extractTopicId(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('topic_id');
    } catch (error) {
        console.error('  URL 解析失败:', error.message);
        return null;
    }
}

// 从 API 获取文章 URL
async function getArticleUrl(topicId) {
    const apiUrl = `https://api.zsxq.com/v2/topics/${topicId}/info`;

    const apiResponse = await fetchWithRetry(apiUrl, 3, 2000);

    if (!apiResponse) {
        return null;
    }

    try {
        const apiData = apiResponse.data;

        if (apiData?.succeeded) {
            return apiData.resp_data.topic.talk.article.article_url;
        } else {
            console.warn('  API 返回失败状态');
            return null;
        }
    } catch (error) {
        console.error('  解析 API 响应失败:', error.message);
        return null;
    }
}

// 将网页保存为 PDF
async function saveToPDF(url, filename, browser) {
    try {
        const page = await browser.newPage();

        // 设置视口大小
        await page.setViewport({
            width: 1920,
            height: 1080
        });

        // 设置 Cookie (从 headers 中提取)
        const cookieString = headers.Cookie;
        if (cookieString) {
            const cookies = cookieString.split(';').map(cookie => {
                const [name, ...valueParts] = cookie.trim().split('=');
                return {
                    name: name,
                    value: valueParts.join('='),
                    domain: '.zsxq.com',
                    path: '/'
                };
            });
            await page.setCookie(...cookies);
            console.log(`    ✓ 已设置 ${cookies.length} 个 Cookie`);
        }

        // 访问页面
        console.log(`    正在加载页面...`);
        await page.goto(url, {
            waitUntil: 'networkidle0', // 等待网络空闲
            timeout: 60000 // 60秒超时
        });

        // 等待页面完全加载
        await sleep(2000);

        // 注入自定义样式，只显示 .post 容器
        await page.addStyleTag({
            content: `
                .qrcode-container{
                    position: inherit !important;
                display:none !important;
                }

                .post {
                   width: 100% !important;
                }

            `
        });

        // 等待样式生效
        await sleep(500);

        // 保存为 PDF
        const pdfPath = path.join(PDF_OUTPUT_DIR, filename);
        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });

        await page.close();
        console.log(`    ✓ PDF 已保存: ${pdfPath}`);
        return pdfPath;
    } catch (error) {
        console.error(`    ✗ 保存 PDF 失败:`, error.message);
        return null;
    }
}

// 保存结果到文件
function saveResults(results) {
    const output = {
        timestamp: new Date().toISOString(),
        total: results.length,
        success: results.filter(r => r.articleUrl).length,
        failed: results.filter(r => !r.articleUrl).length,
        data: results
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`\n结果已保存到: ${OUTPUT_FILE}`);
}

// ==================== 主流程 ====================

async function main() {
    console.log('==================== 开始爬取 ====================\n');

    // 创建 PDF 输出目录
    if (!fs.existsSync(PDF_OUTPUT_DIR)) {
        fs.mkdirSync(PDF_OUTPUT_DIR, { recursive: true });
        console.log(`创建 PDF 输出目录: ${PDF_OUTPUT_DIR}\n`);
    }

    // 启动浏览器
    console.log('启动浏览器...');
    const browser = await puppeteer.launch({
        // headless: true, // 无头模式
        // executablePath: "C:\\Users\\cqsczl\\AppData\\Local\\Google\\Chrome\\Application",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('✓ 浏览器启动成功\n');

    // 步骤1: 获取主页面
    console.log('【步骤 1/4】获取主页面...');
    const mainPageResponse = await fetchPage(MAIN_URL);

    if (!mainPageResponse) {
        console.error('无法获取主页面，程序终止');
        return;
    }

    console.log(`✓ 主页面获取成功\n`);

    // 步骤2: 提取所有"文稿"链接
    console.log('【步骤 2/4】提取文稿链接...');
    const documentLinks = extractDocumentLinks(mainPageResponse.data);
    console.log(`✓ 找到 ${documentLinks.length} 个文稿链接\n`);

    if (documentLinks.length === 0) {
        console.log('没有找到文稿链接，程序终止');
        await browser.close();
        return;
    }

    // 步骤3: 处理每个链接，获取文章 URL
    console.log('【步骤 3/4】获取文章 URL 并保存 PDF...\n');
    const results = [];

    for (let i = 0; i < documentLinks.length; i++) {
        const linkItem = documentLinks[i];
        const shortUrl = linkItem.url;
        const title = linkItem.title;

        console.log(`[${i + 1}/${documentLinks.length}] 处理中...`);
        console.log(`  标题: ${title}`);
        console.log(`  短链接: ${shortUrl}`);

        const result = {
            index: i + 1,
            title: title,
            shortUrl: shortUrl,
            finalUrl: null,
            topicId: null,
            articleUrl: null,
            pdfPath: null,
            success: false
        };

        // 3.1 访问短链接，获取重定向后的 URL
        const redirectResponse = await fetchPage(shortUrl);

        if (!redirectResponse) {
            console.log(`  ✗ 无法访问短链接\n`);
            results.push(result);
            continue;
        }

        result.finalUrl = redirectResponse.finalUrl;
        console.log(`  最终 URL: ${result.finalUrl}`);

        // 3.2 提取 topic_id
        const topicId = extractTopicId(redirectResponse.finalUrl);

        if (!topicId) {
            console.log(`  未找到 topic_id，将最终 URL 作为文章 URL`);

            // 直接使用 finalUrl 作为文章 URL
            result.articleUrl = redirectResponse.finalUrl;
            console.log(`  ✓ 文章 URL: ${result.articleUrl}`);

            // 保存为 PDF
            console.log(`  开始保存 PDF...`);
            const cleanTitle = sanitizeFilename(title);
            const pdfFilename = `${cleanTitle}.pdf`;
            const pdfPath = await saveToPDF(result.articleUrl, pdfFilename, browser);

            if (pdfPath) {
                result.pdfPath = pdfPath;
                result.success = true;
            } else {
                console.log(`  ✗ PDF 保存失败，但 URL 已获取`);
            }

            results.push(result);

            // 延迟，避免请求过快
            if (i < documentLinks.length - 1) {
                console.log(`  等待 1 秒...\n`);
                await sleep(1000);
            } else {
                console.log('');
            }

            continue;
        }

        result.topicId = topicId;
        console.log(`  Topic ID: ${topicId}`);

        // 3.3 通过 API 获取文章 URL（多次重试）
        let articleUrl = null;
        const maxApiRetries = 5; // API 层面最多重试5次

        for (let apiAttempt = 1; apiAttempt <= maxApiRetries; apiAttempt++) {
            if (apiAttempt > 1) {
                console.log(`  API 重试 ${apiAttempt}/${maxApiRetries}...`);
                await sleep(3000); // 重试前等待3秒
            }

            articleUrl = await getArticleUrl(topicId);

            if (articleUrl) {
                result.articleUrl = articleUrl;
                console.log(`  ✓ 文章 URL: ${articleUrl}`);

                // 保存为 PDF
                console.log(`  开始保存 PDF...`);
                const cleanTitle = sanitizeFilename(title);
                const pdfFilename = `${cleanTitle}.pdf`;
                const pdfPath = await saveToPDF(articleUrl, pdfFilename, browser);

                if (pdfPath) {
                    result.pdfPath = pdfPath;
                    result.success = true;
                } else {
                    console.log(`  ✗ PDF 保存失败，但 URL 已获取`);
                }

                break;
            }
        }

        if (!articleUrl) {
            console.log(`  ✗ 获取文章 URL 失败（已重试 ${maxApiRetries} 次）`);
        }

        results.push(result);

        // 延迟，避免请求过快
        if (i < documentLinks.length - 1) {
            console.log(`  等待 1 秒...\n`);
            await sleep(1000);
        } else {
            console.log('');
        }
    }

    // 关闭浏览器
    console.log('\n关闭浏览器...');
    await browser.close();
    console.log('✓ 浏览器已关闭\n');

    // 步骤4: 保存结果
    console.log('==================== 处理完成 ====================\n');
    console.log(`总计: ${results.length} 个链接`);
    console.log(`成功: ${results.filter(r => r.success).length} 个`);
    console.log(`失败: ${results.filter(r => !r.success).length} 个`);

    saveResults(results);

    // 显示所有成功获取的文章
    const successResults = results.filter(r => r.success);
    if (successResults.length > 0) {
        console.log('\n成功保存的文章:');
        successResults.forEach(r => {
            console.log(`  [${r.index}]`);
            console.log(`    URL: ${r.articleUrl}`);
            console.log(`    PDF: ${r.pdfPath}`);
        });
    }
}

// 执行主函数
main().catch(error => {
    console.error('程序出错:', error);
});
