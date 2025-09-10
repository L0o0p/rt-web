import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// HTTP版本的Vite配置（备用方案）
// 如果HTTPS WebSocket有问题，可以使用这个配置
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
        // 使用HTTP而不是HTTPS
        // 注意：这可能会影响某些Web API的功能
        port: 5173,
        host: 'localhost',
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
        fs: {
            // 允许访问上级目录，确保 AudioWorklet 模块可以被正确加载
            allow: ['..']
        },
        // WebSocket配置
        hmr: {
            port: 5173,
            host: 'localhost',
            protocol: 'ws'
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
