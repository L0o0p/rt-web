import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { audioWorkletPlugin } from './vite-audioworklet-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), audioWorkletPlugin()],
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
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // 确保 AudioWorklet 处理器不会被打包进主bundle
      external: (id) => {
        return id.includes('audio-processor')
      }
    }
  },
  // 确保 AudioWorklet 模块可以被正确加载
  assetsInclude: ['**/*.js'],
  worker: {
    // 保持 ES 模块格式
    format: 'es'
  }
})