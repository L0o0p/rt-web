/// <reference types="../../@types/env" />

/**
 * 配置常量
 * 
 * 设计目的：
 * - 从环境变量读取配置，便于不同环境（开发/生产）使用不同配置
 * - 提供默认值作为后备，确保配置始终有效
 * 
 * 原理：
 * - Vite 在构建时会将 import.meta.env.VITE_* 替换为实际值
 * - 使用类型断言确保配置值的类型正确（如将字符串转为布尔值和数字）
 */
export const CONFIG = {
    // WebSocket 服务器地址，从环境变量读取
    WEBSOCKET_URL: import.meta.env.VITE_WEBSOCKET_URL || 'ws://agent-zh-test.vkcto.com:32028/ws',

    // 调试模式开关
    DEBUG_MODE: import.meta.env.VITE_DEBUG_MODE === 'true' || true,

    // 最大重连尝试次数
    MAX_RECONNECT_ATTEMPTS: Number(import.meta.env.VITE_MAX_RECONNECT_ATTEMPTS) || 5,

    // 重连间隔时间（毫秒）
    RECONNECT_INTERVAL: Number(import.meta.env.VITE_RECONNECT_INTERVAL) || 3000,
} as const;