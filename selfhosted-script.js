import fs from 'fs';
import OpenAI from 'openai';

// ==========================================
// 🔴 配置区域
// ==========================================

// 1. 安全验证
const API_KEY = process.env.VOLC_API_KEY; 
const MODEL_ID = process.env.ENDPOINT_ID || 'ep-m-20251202215624-jz6sj';

// 2. 核心修改：每次运行只生成 200 个新软件，然后停止
const MAX_NEW_APPS = 200;

// 3. 文件路径
const SOURCE_URL = 'https://raw.githubusercontent.com/awesome-selfhosted/awesome-selfhosted/master/README.md';
const SAVE_FILE = 'public/data/selfhosted_tools.json';

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
async function fetchApps() {
    console.log("📡 正在下载 Awesome Self-Hosted 列表...");
    try {
        const response = await fetch(SOURCE_URL);
        const text = await response.text();
        
        const lines = text.split('\n');
        let currentCategory = 'Uncategorized';
        const apps = [];
        const seenNames = new Set();
        
        const blackList = ['license', 'contributing', 'contents', 'analytics', 'sponsors', 'source code', 'demo', 'official'];

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith('##') && !trimmed.toLowerCase().includes('content')) {
                currentCategory = trimmed.replace(/^#+\s+/, '').trim();
                continue;
            }

            const match = trimmed.match(/^-\s+\[([^\]]+)\]\((http[^)]+)\)/);
            if (match) {
                let name = match[1].trim();
                
                if (blackList.some(bad => name.toLowerCase().includes(bad))) continue;
                if (name.length < 2 || name.length > 50) continue;
                
                if (seenNames.has(name.toLowerCase())) continue;
                seenNames.add(name.toLowerCase());
                
                apps.push({ name: name, source_category: currentCategory });
            }
        }
        console.log(`✅ 解析完成！共找到 ${apps.length} 个自托管软件。`);
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
    const appsList = await fetchApps();
    
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
    You are an expert in Self-Hosted Software and System Administration. 
    I will give you a software name and its category. 
    Return a valid JSON object in ENGLISH.

    Structure:
    {
      "name": "App Name",
      "slug": "kebab-case-name",
      "tagline": "Short tagline (e.g. Open-source alternative to Notion)",
      "description": "Description focusing on features and deployment (100 words)",
      "pricing_type": "Free/Open Source/Paid", 
      "category": "String", 
      "collection": "selfhosted", 
      "website_url": "Official URL or GitHub Repo",
      "key_features": ["Feature 1", "Feature 2", "Feature 3"],
      "pros": ["Privacy focused", "No subscription"],
      "cons": ["Requires server", "Technical setup"],
      "alternatives": ["Proprietary App 1", "Proprietary App 2"],
      "faqs": [
        { "question": "Is [App Name] hard to install?", "answer": "Answer about Docker/deployment..." },
        { "question": "Is it a good alternative to [Popular SaaS]?", "answer": "Comparison answer..." },
        { "question": "Is it completely free?", "answer": "Answer..." }
      ]
    }
    `;

    let newCount = 0;
    let skipCount = 0;

    for (const app of appsList) {
        // 🔴 1. 检查上限
        if (newCount >= MAX_NEW_APPS) {
            console.log(`\n🛑 已达到单次运行上限 (${MAX_NEW_APPS} 个)，停止运行以保存进度。`);
            break; // 跳出循环，执行保存
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
            data.collection = 'selfhosted'; 
            database.push(data);
            
            fs.writeFileSync(SAVE_FILE, JSON.stringify(database, null, 2));
            newCount++;
            
        } catch (e) {
            console.log(`❌ 生成失败 (${app.name}): ${e.message}`);
        }
    }

    console.log(`\n🎉 Self-Hosted 数据更新完成！`);
    console.log(`- 跳过已存在: ${skipCount} 个`);
    console.log(`- 本次新增: ${newCount} 个`);
    console.log(`- 最终总数: ${database.length} 个`);
}

generate();