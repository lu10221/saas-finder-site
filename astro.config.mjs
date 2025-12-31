import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 你的主域名
  site: 'https://toolstock.net/', 

  // 🔴 核心修复 1：强制 URL 结尾带斜杠 (例如 /tool/fhem/)
  // 这能解决 Google 遇到的 "Page with redirect" 错误
  trailingSlash: 'always',

  // 🔴 核心修复 2：构建为目录格式
  // Astro 会生成 /tool/fhem/index.html，而不是 /tool/fhem.html
  // 这对 Cloudflare Pages 最友好
  build: {
    format: 'directory'
  },
  
  integrations: [tailwind(), sitemap()],
});