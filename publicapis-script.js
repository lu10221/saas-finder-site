import fs from 'fs';
import OpenAI from 'openai';

// ==========================================
// 🔴 配置区域
// ==========================================

const API_KEY = process.env.VOLC_API_KEY; 
const MODEL_ID = process.env.ENDPOINT_ID || 'ep-m-20251202215624-jz6sj';

// 限制：单次运行只生成 200 个 (这个列表非常大，有 1000+ 条)
const MAX_NEW_APPS = 200;

// 源：Public APIs (表格格式)
const SOURCE_URL = 'https://raw.githubusercontent.com/public-apis/public-apis/refs/heads/master/README.md';
const SAVE_FILE = 'public/data/publicapis_tools.json';

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
// 1. 抓取函数 (针对表格格式重写)
// ==========================================
async function fetchApps() {
    console.log("📡 正在下载 Public APIs 列表...");
    try {
        const response = await fetch(SOURCE_URL);
        const text = await response.text();
        
        const lines = text.split('\n');
        let currentCategory = 'Uncategorized';
        const apps = [];
        const seenNames = new Set();
        
        // 排除表头分隔符
        const ignorePatterns = ['|---|', 'API | Description'];

        for (const line of lines) {
            const trimmed = line.trim();

            // 1. 识别分类标题 (###)
            if (trimmed.startsWith('###') && !trimmed.includes('Index')) {
                currentCategory = trimmed.replace(/^#+\s+/, '').trim();
                continue;
            }

            // 2. 识别表格行: | [Name](Link) | Description | ...
            if (trimmed.startsWith('|') && trimmed.includes('](')) {
                if (ignorePatterns.some(p => trimmed.includes(p))) continue;

                // 正则提取：第一列的链接和名字，第二列的描述
                // 格式：| [Name](Link) | Description | Auth | ...
                const match = trimmed.match(/\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]+)\s*\|/);
                
                if (match) {
                    let name = match[1].trim();
                    let url = match[2].trim();
                    let descFromTable = match[3].trim(); // 表格里自带的简单描述

                    if (name.length < 2 || seenNames.has(name.toLowerCase())) continue;
                    seenNames.add(name.toLowerCase());
                    
                    apps.push({
                        name: name,
                        source_category: currentCategory,
                        raw_desc: descFromTable, // 把表格里的描述传给AI参考
                        original_url: url
                    });
                }
            }
        }

        console.log(`✅ 解析完成！共找到 ${apps.length} 个 API。`);
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
    
    if (!appsList || appsList.length === 0) return;

    let database = [];
    if (fs.existsSync(SAVE_FILE)) {
        try {
            const content = fs.readFileSync(SAVE_FILE, 'utf8');
            if (content.trim()) database = JSON.parse(content);
        } catch (e) { database = []; }
    }
    console.log(`📂 本地已有数据: ${database.length} 条`);

    // 🔴 核心 Prompt：API 专家
    const SYSTEM_PROMPT = `
    You are an API Integration Expert.
    I will give you an API name, its category, and a brief description.
    Return a valid JSON object in ENGLISH.

    Structure:
    {
      "name": "API Name",
      "slug": "kebab-case-name",
      "tagline": "Short tagline (e.g. Free JSON API for weather data)",
      "description": "Technical description focusing on endpoints, data format (JSON/XML), and use cases (100 words).",
      "pricing_type": "Free", // Most public APIs are free or freemium
      "category": "String", 
      "collection": "publicapis", // 🔴 固定为 publicapis
      "website_url": "Official URL",
      "key_features": ["RESTful", "JSON support", "No Auth required"],
      "pros": ["Easy to integrate", "Open source data"],
      "cons": ["Rate limited", "No SLA"],
      "alternatives": ["Alt 1"],
      "faqs": [
        { "question": "Is [API Name] free to use?", "answer": "Answer..." },
        { "question": "Does it require an API Key?", "answer": "Answer..." },
        { "question": "What is the response format?", "answer": "Usually JSON..." }
      ]
    }
    `;

    let newCount = 0;
    let skipCount = 0;

    for (const app of appsList) {
        if (newCount >= MAX_NEW_APPS) {
            console.log(`\n🛑 已达到单次运行上限 (${MAX_NEW_APPS} 个)，停止。`);
            break;
        }

        if (database.find(t => t.name.toLowerCase() === app.name.toLowerCase())) {
            skipCount++;
            if (skipCount % 100 === 0) process.stdout.write(`.`); 
            continue;
        }

        try {
            const currentTotal = skipCount + newCount + 1;
            console.log(`\n[进度 ${currentTotal}/${appsList.length}] 生成: ${app.name} (${app.source_category})...`);
            
            const completion = await client.chat.completions.create({
                model: MODEL_ID,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    // 把表格里的原始描述喂给 AI，提高准确度
                    { role: "user", content: `Name: ${app.name}\nCategory: ${app.source_category}\nBrief: ${app.raw_desc}\nURL: ${app.original_url}` }
                ],
                temperature: 0.1,
            });
            
            let content = completion.choices[0].message.content.trim();
            content = content.replace(/^```json/, '').replace(/```$/, '');
            
            const data = JSON.parse(content);
            data.collection = 'publicapis'; 
            data.website_url = app.original_url; // 确保 URL 准确
            
            database.push(data);
            
            fs.writeFileSync(SAVE_FILE, JSON.stringify(database, null, 2));
            newCount++;
            
        } catch (e) {
            console.log(`❌ 生成失败 (${app.name}): ${e.message}`);
        }
    }

    console.log(`\n🎉 Public APIs 数据更新完成！`);
    console.log(`- 本次新增: ${newCount} 个`);
}

generate();