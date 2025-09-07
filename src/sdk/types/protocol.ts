// 二进制消息协议常量
export const BINARY_MESSAGE = {
    NANOID_SIZE: 16,
    PROTOCOL_ID_OFFSET: 16,
    COMMAND_ID_OFFSET: 17,
    BINARY_HEADER_SIZE: 32,

    // 协议ID
    PROTOCOL_ID_ASR: 1,  // ASR协议ID
    PROTOCOL_ID_LLM: 2,  // LLM协议ID
    PROTOCOL_ID_TTS: 3,  // TTS协议ID
    PROTOCOL_ID_CONTROL: 0, // 控制协议ID

    // 命令ID
    CMD_START: 1,        // 开始命令
    CMD_STOP: 2,         // 停止命令
    CMD_AUDIO_CHUNK: 3,  // 音频块命令
    CMD_TEXT_DATA: 4,    // 文本数据命令
    CMD_STOP_INPUT: 5,   // 停止输入命令
    CMD_RESULT: 100,     // 结果命令
    CMD_ERROR: 255       // 错误命令
} as const;

// 音频质量控制参数
export const AUDIO_QUALITY = {
    SAMPLE_RATE: 16000, // 固定采样率
    TARGET_LATENCY_MS: 100, // 低延迟目标
    VOLUME_BOOST: 1.0, // 不额外调整音量，在解码时处理
    FIXED_CHUNK_SIZE: 640, // 40ms的音频块大小（固定为16位单声道）
} as const;

// 配置常量
export const CONFIG = {
    WEBSOCKET_URL: 'wss://bjol.luxhub.top:19443/ws',
    DEBUG_MODE: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_INTERVAL: 3000,
    PLAYBACK_INTERVAL: 40, // 播放间隔（毫秒，减少频率避免卡顿）
    PERFORMANCE_MONITOR_INTERVAL: 5000, // 性能监控间隔（毫秒）
} as const;

// 消息类型定义
export interface TextMessage {
    type: string;
    session_id?: string;
    protocol_id?: number;
    command_id?: number;
    payload?: any;
    response_id?: string;
    item_id?: string;
    delta?: string;
    content_index?: number;
    output_index?: number;
    event_id?: string;
    reason?: string;
    code?: number;
    message?: string;
    id?: number;
    timestamp?: number;
    test?: boolean;
}


// VAD结果接口
export interface VADResult {
    isActive: boolean;
    energy: number;
    zeroCrossingRate: number;
}
