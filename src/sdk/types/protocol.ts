// 配置常量
export const CONFIG = {
    WEBSOCKET_URL: 'wss://bjol.luxhub.top:19443/ws',
    DEBUG_MODE: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_INTERVAL: 3000,
    PLAYBACK_INTERVAL: 40, // 播放间隔（毫秒，减少频率避免卡顿）
    PERFORMANCE_MONITOR_INTERVAL: 5000, // 性能监控间隔（毫秒）
} as const;
