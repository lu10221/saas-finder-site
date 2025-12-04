const fs = require('fs');

// 使用更标准的 awesome-ai 列表源，或者你之前用的源
const URL = 'https://raw.githubusercontent.com/mahseema/awesome-ai-tools/refs/heads/main/README.md';

async function fetchNames() {
    console.log("正在下载列表...");
    const response = await fetch(URL);
    const text = await response.text();

    // 1. 剔除图片: ![xxx](url)
    // 2. 匹配链接: [Name](URL)
    const regex = /\[([^\]]+)\]\((http[^)]+)\)/g;
    
    let match;
    const tools = new Set();
    
    // 黑名单关键词 (如果名字里包含这些，直接扔掉)
    const blackList = [
        'link', 'website', 'here', 'image', 'video', 'subscribe', 
        'youtube', 'twitter', 'discord', 'telegram', 'sponsor', 
        'advertisement', 'newsletter', 'community', 'follow us'
    ];

    while ((match = regex.exec(text)) !== null) {
        // match[0] 是完整字符串, match[1] 是名字, match[2] 是链接
        let name = match[1].trim();
        const rawString = match[0];

        // 过滤逻辑：
        // 1. 如果原始字符串以 ! 开头，说明是图片，跳过
        if (rawString.startsWith('!')) continue;

        // 2. 去除名字里的特殊符号（有时候名字里会有图标 🚀 Jasper）
        name = name.replace(/[^\w\s\.\-]/gi, '').trim();

        // 3. 长度限制：名字太短(少于3字符)或太长(超过40字符)通常不是软件名
        if (name.length < 3 || name.length > 40) continue;

        // 4. 黑名单检查
        if (blackList.some(badWord => name.toLowerCase().includes(badWord))) continue;

        // 5. 必须包含字母 (防止全是数字或符号)
        if (!/[a-zA-Z]/.test(name)) continue;

        tools.add(name);
    }

    const toolList = Array.from(tools);
    fs.writeFileSync('raw_names.json', JSON.stringify(toolList, null, 2));
    console.log(`清洗完成！提取了 ${toolList.length} 个有效的软件名。`);
    console.log(`预览前5个:`, toolList.slice(0, 5));
}

fetchNames();