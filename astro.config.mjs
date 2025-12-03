import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap'; // 自动添加的

export default defineConfig({
  // 🔴 务必改成你刚刚绑定的真实域名 (带 https)
  site: 'https://toolstock.net/', 
  
  integrations: [tailwind(), sitemap()],
});