import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'src': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/key': { target: 'http://localhost:8008', changeOrigin: true },
      '/user': { target: 'http://localhost:8008', changeOrigin: true },
      '/chat': { target: 'http://localhost:8008', changeOrigin: true },
      '/ws': { target: 'http://localhost:8008', ws: true },
      '/prompts': { target: 'http://localhost:8008', changeOrigin: true },
      '/instruction': { target: 'http://localhost:8008', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 按 node_modules 路径匹配分包（函数形式可覆盖子路径导入，如 react-syntax-highlighter/dist/...）
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          // 最重的 markdown 渲染依赖树：仅 Chat 页使用，独立 chunk 后按需加载
          if (
            /react-syntax-highlighter|react-markdown|remark-|rehype-|unified|micromark|hast-|mdast|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character|ccount|character-entities/.test(
              id,
            )
          ) {
            return 'markdown'
          }

          // UI 组件库，长期缓存（先于 react-vendor 判断，避免 @radix-ui/react-* 子路径被"react"关键字截胡）
          if (/radix-ui|@radix-ui|sonner/.test(id)) {
            return 'ui-vendor'
          }

          // React 运行时代码，长期缓存
          if (/react|react-router|scheduler|zustand|use-sync-external-store|next-themes/.test(id)) {
            return 'react-vendor'
          }
        },
      },
    },
  },
})
