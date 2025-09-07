import type { Plugin } from 'vite'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export function audioWorkletPlugin(): Plugin {
    return {
        name: 'audioworklet-plugin',
        configureServer(server) {
            // 添加中间件来处理 AudioWorklet 模块请求
            server.middlewares.use('/audio-processor.js', (req, res) => {
                try {
                    // 从 node_modules 读取 AudioWorklet 处理器文件
                    const processorPath = resolve(
                        process.cwd(),
                        'node_modules/@steelbrain/media-ingest-audio/dist/audio-processor.js'
                    );
                    const processorCode = readFileSync(processorPath, 'utf-8');

                    res.setHeader('Content-Type', 'application/javascript');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.end(processorCode);
                } catch (error) {
                    console.error('Failed to serve AudioWorklet processor:', error);
                    res.statusCode = 404;
                    res.end('AudioWorklet processor not found');
                }
            });
        }
    }
}
