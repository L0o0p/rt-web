import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { audioWorkletPlugin } from './vite-audioworklet-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // 修复React 19兼容性问题
      jsxRuntime: 'automatic',
      jsxImportSource: 'react'
    }),
    audioWorkletPlugin()
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
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // 确保 AudioWorklet 处理器不会被打包进主bundle
      external: (id) => {
        return id.includes('audio-processor')
      },
      output: {
        // 确保React被正确打包
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'jotai': ['jotai']
        }
      }
    }
  },
  // 确保 AudioWorklet 模块可以被正确加载
  // 只能包含需要以 asset 方式处理的特定 JS 文件，避免影响 React/Jotai 等依赖解析
  assetsInclude: ['node_modules/@steelbrain/media-ingest-audio/dist/audio-processor.js'],
  worker: {
    // 保持 ES 模块格式
    format: 'es'
  }
})