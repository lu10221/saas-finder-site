import fs from 'fs';
import OpenAI from 'openai';

// ==========================================
// 🔴 配置区域
// ==========================================

// 1. 安全验证：只从环境变量读取 Key
const API_KEY = process.env.VOLC_API_KEY; 
const MODEL_ID = process.env.ENDPOINT_ID || 'ep-m-20251202215624-jz6sj'; // Endpoint ID

// 2. 核心修改：每次运行只生成 200 个新软件，然后停止
const MAX_NEW_APPS = 200; 

// 3. 文件路径
const SOURCE_URL = 'https://raw.githubusercontent.com/jaywcjlove/awesome-mac/master/README.md';
const SAVE_FILE = 'public/data/mac_tools.json';

// ==========================================
// 🛡️ 安全检查
// ==========================================
if (!API_KEY) {
    console.error("\n❌ 错误：未找到 API Key！");
    process.exit(1);
}

const client = new OpenAI({
    apiKey: API_KEY, 
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
});

// ==========================================
// 1. 抓取名单函数
// ==========================================
async function fetchMacApps() {
    console.log("📡 正在下载并解析 Awesome Mac 列表...");
    try {
        const response = await fetch(SOURCE_URL);
        const text = await response.text();
        
        const lines = text.split('\n');
        let currentCategory = 'Uncategorized';
        const apps = [];
        const seenNames = new Set();
        const blackList = ['contributing', 'awesome', 'license', 'contents', 'sponsors', 'guide', 'back to top'];

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('##') && !trimmed.includes('Contents')) {
                currentCategory = trimmed.replace(/^#+\s+/, '').trim();
                continue;
            }

            const match = trimmed.match(/^[\-\*]\s+\[([^\]]+)\]\((http[^)]+)\)/);
            if (match) {
                let name = match[1].trim();
                
                if (blackList.some(bad => name.toLowerCase().includes(bad))) continue;
                if (name.length < 2 || name.length > 40) continue;
                if (match[2].includes('/issues') || match[2].includes('/pulls')) continue;
                if (name.includes('![')) continue;

                if (seenNames.has(name.toLowerCase())) continue;
                seenNames.add(name.toLowerCase());
                
                apps.push({ name: name, source_category: currentCategory });
            }
        }
        console.log(`✅ 解析完成！源列表共包含 ${apps.length} 个软件。`);
        return apps; 

    } catch (error) {
        console.error("❌ 下载列表失败:", error);
        return [];
    }
}

// ==========================================
// 2. AI 生成内容函数
// ==========================================
async function generate() {
    const appsList = await fetchMacApps();
    
    if (!appsList || appsList.length === 0) {
        console.log("⚠️ 未获取到软件列表，终止运行。");
        return;
    }

    let database = [];
    if (fs.existsSync(SAVE_FILE)) {
        try {
            const content = fs.readFileSync(SAVE_FILE, 'utf8');
            if (content.trim()) database = JSON.parse(content);
        } catch (e) { database = []; }
    }
    console.log(`📂 本地已有数据: ${database.length} 条`);

    const SYSTEM_PROMPT = `
    You are a Mac Software expert. 
    I will give you an app name and its source category. 
    Return a valid JSON object in ENGLISH.

    Structure:
    {
      "name": "App Name",
      "slug": "kebab-case-name",
      "tagline": "Short tagline",
      "description": "Description (100 words)",
      "pricing_type": "Free/Freemium/Paid",
      "category": "String", 
      "collection": "mac", 
      "website_url": "Official URL",
      "key_features": ["Feature 1", "Feature 2"],
      "pros": ["Pro 1"],
      "cons": ["Con 1"],
      "alternatives": ["Alt 1"],
      "faqs": [
        { "question": "Is [App Name] completely free?", "answer": "Detailed answer..." },
        { "question": "Is [App Name] safe to use on Mac?", "answer": "Detailed answer..." },
        { "question": "What is the best alternative to [App Name]?", "answer": "Detailed answer..." }
      ]
    }
    `;

    let newCount = 0;
    let skipCount = 0;

    for (const app of appsList) {
        // 🔴 1. 检查是否达到单次上限 (比如 200 个)
        if (newCount >= MAX_NEW_APPS) {
            console.log(`\n🛑 已达到单次运行上限 (${MAX_NEW_APPS} 个)，停止运行以保存进度。`);
            break; // 跳出循环，自动去执行下面的 finish log
        }

        // 2. 去重
        if (database.find(t => t.name.toLowerCase() === app.name.toLowerCase())) {
            skipCount++;
            if (skipCount % 100 === 0) process.stdout.write(`.`); 
            continue;
        }

        // 3. 生成
        try {
            const currentTotal = skipCount + newCount + 1;
            console.log(`\n[进度 ${currentTotal}/${appsList.length}] 正在生成: ${app.name} (${app.source_category})...`);
            
            const completion = await client.chat.completions.create({
                model: MODEL_ID,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: `App Name: ${app.name}\nSource Category: ${app.source_category}` }
                ],
                temperature: 0.1,
            });
            
            let content = completion.choices[0].message.content.trim();
            content = content.replace(/^```json/, '').replace(/```$/, '');
            
            const data = JSON.parse(content);
            data.collection = 'mac'; 
            database.push(data);
            
            fs.writeFileSync(SAVE_FILE, JSON.stringify(database, null, 2));
            newCount++;
            
        } catch (e) {
            console.log(`❌ 生成失败 (${app.name}): ${e.message}`);
        }
    }

    console.log(`\n🎉 本次批次任务完成！`);
    console.log(`- 跳过已存在: ${skipCount} 个`);
    console.log(`- 本次新增: ${newCount} 个`);
    console.log(`- 最终总数: ${database.length} 个`);
}

generate();