const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- 配置区域 ---
const ZSXQ_AUTHORIZATION = '5DC8432A-6D60-4DDD-B4CC-FC1BF9F6333F_EBEEFFE272079886';
const CONCURRENCY_LIMIT = 5; // 并发下载数量
const DOWNLOAD_DIR = path.resolve(__dirname, 'downloads');

const COMMON_HEADERS = {
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

// --- 核心功能函数 ---

/**
 * 获取文件下载链接，带重试机制
 * @param {string} file_id - 文件ID
 * @param {number} retries - 重试次数
 * @returns {Promise<object>}
 */
async function getDownloadUrl(file_id, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(`https://api.zsxq.com/v2/files/${file_id}/download_url`, { headers: COMMON_HEADERS });
            if (response.data && response.data.succeeded) {
                return response.data;
            }
            console.warn(`获取下载链接失败 (ID: ${file_id})，正在重试... (${i + 1}/${retries})`, response.data.info || '');
        } catch (error) {
            console.error(`请求下载链接出错 (ID: ${file_id})，正在重试... (${i + 1}/${retries})`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒后重试
    }
    return { succeeded: false, error: '获取下载链接失败，已达最大重试次数' };
}

/**
 * 从指定URL下载文件
 * @param {string} url - 下载URL
 * @param {string} filepath - 完整的文件保存路径
 * @returns {Promise<void>}
 */
function downloadFile(url, filepath) {
    return new Promise(async (resolve, reject) => {
        try {
            const writer = fs.createWriteStream(filepath);
            const response = await axios({ url, method: 'GET', responseType: 'stream' });

            response.data.pipe(writer);

            writer.on('finish', resolve);
            writer.on('error', (err) => {
                fs.unlink(filepath, () => { }); // 下载出错时删除不完整的文件
                reject(err);
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * 获取主题列表
 * @returns {Promise<Array>}
 */
async function fetchTopics() {
    try {
        const response = await axios.get('https://api.zsxq.com/v2/hashtags/88842155182122/topics?count=20', {
            headers: {
                ...COMMON_HEADERS,

            }
        });
        // console.log(response.data);
        if (response.data && response.data.succeeded) {
            return response.data.resp_data.topics;
        }
        console.error('获取主题列表失败:', response.data.info);
        return [];
    } catch (error) {
        console.error('请求主题列表时出错:', error.message);
        return [];
    }
}

/**
 * 并发处理下载任务
 * @param {Array<object>} tasks - 任务列表
 * @param {number} limit - 并发限制
 */
async function processDownloads(tasks, limit) {
    const totalTasks = tasks.length;
    let completedTasks = 0;

    console.log(`共发现 ${totalTasks} 个文件，开始以 ${limit} 并发下载...`);

    const taskExecutor = async (task) => {
        const { file_id, fileName } = task;
        const filePath = path.join(DOWNLOAD_DIR, fileName);

        if (fs.existsSync(filePath)) {
            console.log(`文件已存在，跳过: ${fileName}`);
            return { status: 'skipped' };
        }

        console.log(`[开始] 准备下载: ${fileName}`);
        const downloadInfo = await getDownloadUrl(file_id);

        if (!downloadInfo.succeeded) {
            console.error(`[失败] 获取 ${fileName} 的下载链接失败:`, downloadInfo.error || downloadInfo.info);
            return { status: 'failed', reason: '获取链接失败' };
        }

        const downloadUrl = downloadInfo.resp_data.download_url;
        try {
            await downloadFile(downloadUrl, filePath);
            console.log(`[成功] 文件 ${fileName} 下载完成.`);
            return { status: 'fulfilled' };
        } catch (error) {
            console.error(`[失败] 文件 ${fileName} 下载失败:`, error.message);
            return { status: 'failed', reason: error.message };
        }
    };

    const results = [];
    const executing = new Set();
    const taskIterator = tasks[Symbol.iterator]();

    const worker = async () => {
        for (const task of taskIterator) {
            const promise = taskExecutor(task).finally(() => {
                executing.delete(promise);
                completedTasks++;
                console.log(`[进度] ${completedTasks}/${totalTasks}`);
            });
            executing.add(promise);
            results.push(promise);
            if (executing.size >= limit) {
                await Promise.race(executing);
            }
        }
    };

    const workers = Array(limit).fill(null).map(worker);
    await Promise.all(workers);
    await Promise.allSettled(results);

    console.log('所有下载任务已处理完毕。');
}


// --- 主程序入口 ---
async function main() {
    console.log('开始执行任务...');

    // 确保下载目录存在
    if (!fs.existsSync(DOWNLOAD_DIR)) {
        fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        console.log(`创建下载目录: ${DOWNLOAD_DIR}`);
    }

    const topics = await fetchTopics();
    if (!topics.length) {
        console.log('未获取到任何主题，程序退出。');
        return;
    }
    // console.log(topics);
    const downloadTasks = topics.reduce((tasks, topic) => {
        if (topic.talk && topic.talk.files && topic.talk.files.length > 0) {
            const fileInfo = topic.talk.files[0];

            tasks.push({ file_id: fileInfo.file_id, fileName: fileInfo.name }); // 过滤非法文件名字符
        }
        return tasks;
    }, []);

    // console.log(downloadTasks);
    if (downloadTasks.length > 0) {
        await processDownloads(downloadTasks, CONCURRENCY_LIMIT);
    } else {
        console.log('在获取到的主题中未发现任何文件。');
    }

    console.log('所有任务执行完毕。');
}

main().catch(error => {
    console.error('程序发生未捕获的错误:', error);
});
