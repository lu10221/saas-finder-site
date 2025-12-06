import fs from 'fs';
import OpenAI from 'openai';

// ==========================================
// 🔴 配置区域
// ==========================================

// 1. 安全验证：只从环境变量读取 Key
const API_KEY = process.env.VOLC_API_KEY; 
const MODEL_ID = process.env.ENDPOINT_ID || 'ep-m-20251202215624-jz6sj'; // Endpoint ID

// 2. 文件路径
const SOURCE_URL = 'https://raw.githubusercontent.com/jaywcjlove/awesome-mac/master/README.md';
const SAVE_FILE = 'public/data/mac_tools.json';

// ==========================================
// 🛡️ 安全检查
// ==========================================
if (!API_KEY) {
    console.error("\n❌ 错误：未找到 API Key！");
    console.error("------------------------------------------------");
    console.error("请不要在代码里直接写 Key。请使用环境变量运行：");
    console.error("👉 Windows (PowerShell):");
    console.error('   $env:VOLC_API_KEY="你的真实Key"; node mac-script.js');
    console.error("\n👉 Mac / Linux:");
    console.error('   VOLC_API_KEY=你的真实Key node mac-script.js');
    console.error("------------------------------------------------\n");
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

            // 识别分类标题
            if (trimmed.startsWith('##') && !trimmed.includes('Contents')) {
                currentCategory = trimmed.replace(/^#+\s+/, '').trim();
                continue;
            }

            // 识别软件列表项
            const match = trimmed.match(/^[\-\*]\s+\[([^\]]+)\]\((http[^)]+)\)/);
            if (match) {
                let name = match[1].trim();
                const link = match[2];

                if (blackList.some(bad => name.toLowerCase().includes(bad))) continue;
                if (name.length < 2 || name.length > 40) continue;
                if (link.includes('/issues') || link.includes('/pulls')) continue;
                if (name.includes('![')) continue;

                if (seenNames.has(name.toLowerCase())) continue;
                seenNames.add(name.toLowerCase());
                
                apps.push({
                    name: name,
                    source_category: currentCategory
                });
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

    // 读取本地已有的数据
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
      // 🔴 新增：FAQ 数组
      "faqs": [
        { "question": "Is [App Name] completely free?", "answer": "Detailed answer..." },
        { "question": "Is [App Name] safe to use on Mac?", "answer": "Detailed answer..." },
        { "question": "What is the best alternative to [App Name]?", "answer": "Detailed answer..." }
      ]
    }
    `;

    let newCount = 0;
    let skipCount = 0;

    // 遍历所有抓到的软件
    for (const app of appsList) {
        // 1. 检查数据库是否已存在 (去重)
        if (database.find(t => t.name.toLowerCase() === app.name.toLowerCase())) {
            skipCount++;
            // 每跳过 100 个打印一次日志，避免刷屏太快
            if (skipCount % 100 === 0) process.stdout.write(`.`); 
            continue;
        }

        // 2. 开始生成新数据 (无限制，一直跑到底)
        try {
            // 计算当前总进度
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
            
            // 实时保存，跑一个存一个，断电也不怕
            fs.writeFileSync(SAVE_FILE, JSON.stringify(database, null, 2));
            newCount++;
            
        } catch (e) {
            console.log(`❌ 生成失败 (${app.name}): ${e.message}`);
        }
    }

    console.log(`\n🎉 所有任务全部完成！`);
    console.log(`- 本次新增: ${newCount} 个`);
    console.log(`- 最终总数: ${database.length} 个`);
}

generate();