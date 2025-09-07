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
    MIN_BUFFER_SIZE: 1, // 最小缓冲区，减少延迟
    MAX_BUFFER_SIZE: 4, // 小缓冲区，保持实时性
    TARGET_LATENCY_MS: 100, // 低延迟目标
    VOLUME_BOOST: 1.0, // 不额外调整音量，在解码时处理
    NOISE_GATE_THRESHOLD: 0.001, // 低噪声门限，保留更多细节
    FIXED_CHUNK_SIZE: 2048, // 固定分片大小（增大到约128ms音频）
    MERGE_BUFFER_SIZE: 8192, // 音频合并缓冲区大小（增大到约512ms音频）
    MERGE_BUFFER_MIN_SAMPLES: 2048, // 最小合并样本数（增大减少触发频率）
    MERGE_BUFFER_TIMEOUT_MS: 150 // 缓冲区超时时间（适当增加）
} as const;

// 配置常量
export const CONFIG = {
    WEBSOCKET_URL: 'wss://bjol.luxhub.top:9443/ws',
    DEBUG_MODE: true,
    MAX_RECONNECT_ATTEMPTS: 5,
    RECONNECT_INTERVAL: 3000,
    TRANSMISSION_INTERVAL: 40, // 20毫秒传输间隔
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

// 音频数据块接口
export interface AudioChunk {
    data: Float32Array | Uint8Array;
    timestamp: number;
    processed?: boolean;
    vadActive?: boolean;
    energy?: number;
    responseId?: string;
    itemId?: string;
}

// 网络质量指标接口
export interface QualityMetrics {
    latency?: number;
    packetLoss?: number;
    bandwidth?: number;
    jitter?: number;
}

// VAD结果接口
export interface VADResult {
    isActive: boolean;
    energy: number;
    zeroCrossingRate: number;
}

// 录音切片接口
export interface RecordingChunk {
    audioData: Uint8Array;
    sampleCount: number;
    timestamp: number;
}
