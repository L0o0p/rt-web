import { CONFIG } from '../types/protocol';
import { globalLogger as logger } from '../utils/GlobalLogger';
import { ClientBinaryMessage as BinaryMessage, CommandId, ProtocolId } from '../protocol/ClientProtocol';
import type { WebSocketMessage, SessionConfigPayload } from '../protocol/ClientProtocol';
import {
  WebSocketMessageParser,
  BinaryMessageParser,
} from '../protocol/UnifiedParser';
import { EventEmitter } from '../utils/EventEmitter';
// 解码和播放逻辑应在上层 App 中处理

// 事件类型定义
export interface ConnectionEvents {
  'open': (event: Event) => void;
  'close': (event: CloseEvent) => void;
  'error': (event: Event) => void;
}

export class CombinedConnectionManager extends EventEmitter {
  // WebSocket连接相关属性
  private websocket: WebSocket | null = null;
  private connectionAttempts: number = 0;
  private reconnectTimeout: number | null = null;
  private heartbeatInterval: number | null = null;

  // 会话相关属性
  private sessionId: string | undefined = undefined;
  private pingTimestamps: Array<{ id: number; timestamp: number }> = [];
  private defaultSessionConfig?: Partial<SessionConfigPayload>;

  // 消息解析器
  private webSocketParser: WebSocketMessageParser;
  private binaryParser: BinaryMessageParser;

  // ========== 高精度性能监控 ==========
  private performanceTimers = new Map<string, number>(); // 存储各种事件的开始时间
  private latencyMetrics: Array<{
    type: string;
    startTime: number;
    endTime: number;
    latency: number;
    timestamp: number;
  }> = [];
  private maxMetricsHistory = 100; // 保留最近100次测量


  constructor(sessionId?: string, defaultSessionConfig?: Partial<SessionConfigPayload>) {
    super();
    this.webSocketParser = new WebSocketMessageParser();
    this.binaryParser = new BinaryMessageParser();
    this.defaultSessionConfig = defaultSessionConfig;
    if (sessionId) {
      this.sessionId = sessionId;
    }
    else {
      // 16字的随机字符串
      this.sessionId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    }
  }

  /**
   * 连接到WebSocket服务器
   */
  async connect(): Promise<void> {
    try {
      if (!window.WebSocket) {
        throw new Error('当前浏览器不支持WebSocket');
      }

      this.websocket = new WebSocket(CONFIG.WEBSOCKET_URL);

      this.websocket.onopen = (event: Event): void => {
        this.handleOpen(event);
        this.emit('open', event);
      };

      this.websocket.onmessage = (event: MessageEvent): void => {
        this.handleMessage(event);
      };

      this.websocket.onclose = (event: CloseEvent): void => {
        this.handleClose(event);
        this.emit('close', event);
      };

      this.websocket.onerror = (event: Event): void => {
        this.emit('error', event);
      };
    } catch (_error) {
      throw new Error("连接失败");
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.websocket) {
      const currentState = this.websocket.readyState;
      if (currentState === WebSocket.OPEN || currentState === WebSocket.CONNECTING) {
        this.websocket.close(1000, 'Client requested disconnection');
      }
    }

    this.cleanup();
  }

  /**
   * 发送文本消息
   */
  sendTextMessage(message: WebSocketMessage['payload'], commandID: CommandId): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const fullMessage = {
        protocol_id: ProtocolId.All,
        command_id: commandID,
        session_id: this.sessionId!,
        payload: message
      } satisfies WebSocketMessage;

      const messageStr = JSON.stringify(fullMessage);

      // 添加详细的发送日志
      if (message && typeof message === 'object' && 'type' in message && message.type === 'session_config') {
        const sessionConfig = message as SessionConfigPayload;
        logger.info(`[CLIENT] Sending WebSocket message with asr_language: ${sessionConfig.asr_language}`);
        logger.info(`[CLIENT] Full WebSocket message:`, JSON.stringify(fullMessage, null, 2));
      }

      try {
        this.websocket.send(messageStr);
        logger.info(`[CLIENT] Message sent successfully`);
      } catch (error) {
        logger.error(`发送文本消息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.error('WebSocket未连接，无法发送消息');
    }
  }

  /**
   * 发送二进制消息
   */
  sendBinaryMessage(message: BinaryMessage): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      try {
        const bytes = message.toBytes();
        logger.info(`[BINARY] 发送二进制消息 - 会话ID: ${message.header.sessionId}, 协议ID: ${message.header.protocolId}, 命令ID: ${message.header.commandId}, 总大小: ${bytes.length}字节`);

        // 如果是图像数据，记录更多信息
        if (message.header.commandId === 6) { // ImageData command
          // 解析新的payload格式信息
          if (message.payload.length >= 4) {
            const promptLengthView = new DataView(message.payload.buffer, message.payload.byteOffset, 4);
            const promptLength = promptLengthView.getUint32(0, true); // 小端序
            const imageDataLength = message.payload.length - 4 - promptLength;
            logger.info(`[BINARY] 图像数据详情 - 头部: 32字节, 载荷: ${message.payload.length}字节 (提示词长度: ${promptLength}字节, 图像数据: ${imageDataLength}字节)`);
          } else {
            logger.info(`[BINARY] 图像数据详情 - 头部: 32字节, 载荷: ${message.payload.length}字节 (格式异常: payload太短)`);
          }
        }

        this.websocket.send(bytes);
        logger.info(`[BINARY] 二进制消息发送成功`);
      } catch (error) {
        logger.error(`[BINARY] 发送二进制消息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.error('[BINARY] WebSocket未连接，无法发送二进制消息');
    }
  }

  /**
   * 设置消息事件回调 - 为了保持向后兼容性
   */

  // === 以下是从原WebSocketManager迁移的方法 ===

  private handleOpen(_event: Event): void {
    this.connectionAttempts = 0;
    // 如果没有提供 sessionID，则生成一个新的
    if (!this.sessionId) {
      this.sessionId = this.generateSessionId();
    }
    this.createSession();
    this.startHeartbeat();
  }

  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat();

    if (!event.wasClean && this.connectionAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
      this.connectionAttempts++;
      this.reconnectTimeout = window.setTimeout(() => {
        // 重新连接逻辑
      }, CONFIG.RECONNECT_INTERVAL);
    }
  }

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2);
    const combined = timestamp + random;
    return combined.substr(0, 16).padEnd(16, '0');
  }
  /**
   * 重新创建会话
   */
  recreateSession(sessionId?: string, config?: Partial<SessionConfigPayload>): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      // 使用提供的 sessionID 或者保持现有的 sessionID
      if (sessionId) {
        this.sessionId = sessionId;
      }
      // 创建会话
      this.createSession(config);
    }
  }

  private createSession(config?: Partial<SessionConfigPayload>): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.sessionId) {
      const sessionConfigPayload: SessionConfigPayload = {
        type: "session_config",
        mode: "vad",
        system_prompt: `你是Squady realTime，一个由TeamSquady研发的智能语音助手。你具备以下特征和能力：

身份定位
你是用户的贴心语音伙伴，能够通过自然对话帮助用户解决各种问题。你性格友善、耐心，善于倾听并提供有价值的帮助。

核心能力

实时语音对话，支持自然流畅的多轮交流
广泛的知识储备，涵盖生活、工作、学习等各个领域
智能理解用户意图，提供精准的信息和建议
支持任务协助，如日程管理、信息查询、内容创作等
交互原则

保持简洁明了的回答，避免冗长的解释
用温暖、自然的语调与用户交流
主动询问细节以更好地理解用户需求
承认不确定性，诚实表达能力边界
价值观

始终以用户的最佳利益为出发点
尊重用户隐私，保护个人信息安全
提供客观、平衡的观点，避免偏见
鼓励用户独立思考和学习成长`,
        mcp_server_config: [{
          "name": "mcp_server",
          "endpoint": "https://test-ai-howear.iwhop.cn/gateway/machine/functionCall/mcp"
        }
        ],
        enable_search: true,
        signal_only: false,
        asr_language: "zh",
        timezone: "Asia/Shanghai",
        location: "中国",
        initial_burst_count: 10,
        initial_burst_delay_ms: 5,
        send_rate_multiplier: 1.0,
        output_audio_config: {
          format: "opus",
          slice_ms: 20,
          sample_rate: 16000,
          channels: 1,
          bitrate: 32000,
          application: "voip"
        },
        input_audio_config: {
          format: "opus",
          sample_rate: 16000,
          channels: 1,
          bitrate: 32000,
          application: "voip"
        },
        text_done_signal_only: false,
        ...this.defaultSessionConfig,
        ...config
      };

      // 添加调试日志
      logger.info(`[CLIENT] Creating session with asr_language: ${sessionConfigPayload.asr_language}`);
      logger.info(`[CLIENT] Full session config:`, JSON.stringify(sessionConfigPayload, null, 2));
      logger.info(`[CLIENT] defaultSessionConfig:`, JSON.stringify(this.defaultSessionConfig, null, 2));
      logger.info(`[CLIENT] config parameter:`, JSON.stringify(config, null, 2));

      this.sendTextMessage(sessionConfigPayload, CommandId.Start);
    }
  }


  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatInterval = window.setInterval(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.sessionId) {
        const pingId = Date.now();
        this.pingTimestamps.push({ id: pingId, timestamp: performance.now() });

        if (this.pingTimestamps.length > 10) {
          this.pingTimestamps.shift();
        }

        const pingMessage = BinaryMessage.createPing(this.sessionId);
        this.sendBinaryMessage(pingMessage);
      }
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private cleanup(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeat();
    this.pingTimestamps = [];
  }

  // Getters
  get isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  get isSessionCreated(): boolean {
    // 通过检查sessionId是否存在来判断会话是否已创建
    return !!this.sessionId;
  }

  /**
   * 更新默认会话配置
   */
  setDefaultSessionConfig(config: Partial<SessionConfigPayload>): void {
    this.defaultSessionConfig = config;
  }

  // === 以下是从原SDKMessageHandler迁移的方法 ===

  private handleMessage(event: MessageEvent): void {
    try {
      if (typeof event.data === 'string') {
        const parsedMessage = this.webSocketParser.parse(event.data);
        logger.info(`[SDK] 收到服务器文本消息: ${JSON.stringify(parsedMessage.rawData)}`);

        try {
          const rawData = parsedMessage.rawData;
          let actualMessage = rawData;
          let messageType = rawData.type;
          if (!messageType && rawData.payload && rawData.payload.type) {
            actualMessage = rawData.payload;
            messageType = rawData.payload.type;
            actualMessage.session_id = rawData.session_id;
          }

          // ========== 高精度性能监控 - WebSocket层立即停止计时 ==========
          // 在消息解析完成后立即停止对应的计时器
          if (messageType) {
            const latency = this.stopHighPrecisionTimer(messageType);
            if (latency !== null) {
              logger.info(`[PERF] High-precision latency for ${messageType}: ${latency.toFixed(3)}ms`);
            }
          }

          // 针对 response.audio.delta 进行解码（Base64 -> Opus -> PCM16）
          // response.audio.delta 的解码播放交由 App 层处理

          // 直接emit事件，事件类型就是messageType
          this.emit(messageType, actualMessage);
        } catch (error) {
          logger.error(`[SDK] 处理文本消息时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        try {
          const parsedMessage = this.binaryParser.parse(event.data);
          logger.info(`[SDK] 收到服务器二进制消息，长度: ${event.data.byteLength} 字节`);
          // 对于二进制消息，我们也采用同样的方式，直接emit事件
          if (parsedMessage.payload && parsedMessage.payload.type) {
            // 如果有载荷类型，直接使用载荷类型作为事件类型
            this.emit(parsedMessage.payload.type, parsedMessage.payload);
          } else {
            // 如果没有载荷类型，使用一个通用的事件类型
            this.emit('binaryMessage', parsedMessage);
          }
        } catch (_error) {
          logger.error(`[SDK] 解析二进制消息时出错: ${_error instanceof Error ? _error.message : String(_error)}`);
        }
      }
    } catch (_error) {
      logger.error(`[SDK] 处理WebSocket消息时出错: ${_error instanceof Error ? _error.message : String(_error)}`);
      logger.error(`[SDK] 原始消息数据: ${event.data}`);
    }
  }

  // Base64 编解码工具改用 AudioUtils 中的实现

  // ========== 高精度性能监控方法 ==========

  /**
   * 开始计时 - 1ms精度
   */
  public startHighPrecisionTimer(eventType: string): void {
    const now = performance.now();
    this.performanceTimers.set(eventType, now);

    // 立即发出计时开始事件
    this.emit('performance:timer:start', {
      type: eventType,
      timestamp: now
    });
  }

  /**
   * 停止计时并记录延迟 - 1ms精度
   */
  public stopHighPrecisionTimer(eventType: string): number | null {
    const endTime = performance.now();
    const startTime = this.performanceTimers.get(eventType);

    if (startTime === undefined) {
      return null;
    }

    const latency = endTime - startTime;

    // 记录到历史记录
    const metric = {
      type: eventType,
      startTime,
      endTime,
      latency,
      timestamp: Date.now()
    };

    this.latencyMetrics.push(metric);

    // 限制历史记录大小
    if (this.latencyMetrics.length > this.maxMetricsHistory) {
      this.latencyMetrics.shift();
    }

    // 清除计时器
    this.performanceTimers.delete(eventType);

    // 立即发出延迟测量完成事件
    this.emit('performance:latency:measured', metric);

    return latency;
  }

  /**
   * 获取性能指标
   */
  public getPerformanceMetrics(): {
    latest: HighPrecisionMetric | null;
    average: number;
    min: number;
    max: number;
    count: number;
    history: HighPrecisionMetric[];
  } {
    if (this.latencyMetrics.length === 0) {
      return {
        latest: null,
        average: 0,
        min: 0,
        max: 0,
        count: 0,
        history: []
      };
    }

    const latencies = this.latencyMetrics.map(m => m.latency);
    const latest = this.latencyMetrics[this.latencyMetrics.length - 1];
    const average = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);

    return {
      latest,
      average,
      min,
      max,
      count: this.latencyMetrics.length,
      history: [...this.latencyMetrics]
    };
  }

  /**
   * 清除性能历史记录
   */
  public clearPerformanceMetrics(): void {
    this.latencyMetrics = [];
    this.performanceTimers.clear();
  }


}

// 性能测试结果接口
export interface PerformanceTestResult {
  summary: {
    totalTests: number;
    totalSuccessful: number;
    overallSuccessRate: number;
    testDuration: number;
  };
  ping: {
    count: number;
    successRate: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    p50: number;
    p95: number;
    p99: number;
  };
  text: {
    count: number;
    successRate: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    p50: number;
    p95: number;
    p99: number;
  };
  audio: {
    count: number;
    successRate: number;
    averageLatency: number;
    minLatency: number;
    maxLatency: number;
    p50: number;
    p95: number;
    p99: number;
  };
  rawResults: Array<{
    testId: string;
    testType: 'ping' | 'text' | 'audio';
    startTime: number;
    endTime?: number;
    latency?: number;
    success: boolean;
    error?: string;
  }>;
}

// ========== 高精度性能监控接口 ==========
export interface HighPrecisionMetric {
  type: string;
  startTime: number;
  endTime: number;
  latency: number;
  timestamp: number;
}

// 在 CombinedConnectionManager 类中添加高精度性能监控方法
declare module './CombinedConnectionManager' {
  interface CombinedConnectionManager {
    startHighPrecisionTimer(eventType: string): void;
    stopHighPrecisionTimer(eventType: string): number | null;
    getPerformanceMetrics(): {
      latest: HighPrecisionMetric | null;
      average: number;
      min: number;
      max: number;
      count: number;
      history: HighPrecisionMetric[];
    };
    clearPerformanceMetrics(): void;
  }
}