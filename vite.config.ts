import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // 修复React 19兼容性问题
      jsxRuntime: 'automatic',
      jsxImportSource: 'react'
    })
  ],
  optimizeDeps: {
    // 避免优化包含 WASM 文件的依赖以及 AudioWorklet 处理器
    exclude: [
      'onnxruntime-web',
      '@steelbrain/media-speech-detection-web',
      '@steelbrain/media-ingest-audio',
    ],
    // 确保在预构建时保留 import.meta.url
    esbuildOptions: {
      keepNames: true,
    }
  },
  server: {
    https: {
      // 使用自签名证书
      key: './localhost-key.pem',
      cert: './localhost.pem'
    },
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      // 允许访问上级目录，确保 AudioWorklet 模块可以被正确加载
      allow: ['..']
    },
    // 修复WebSocket连接问题
    hmr: {
      port: 5173,
      host: '192.168.3.62',
      protocol: 'wss',
      // 添加客户端配置
      clientPort: 5173
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // 确保React被正确打包
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'jotai': ['jotai']
        }
      }
    }
  },
  worker: {
    // 保持 ES 模块格式
    format: 'es'
  }
})