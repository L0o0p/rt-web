import { CONFIG } from '../types/protocol';
import { globalLogger as logger } from '../utils/GlobalLogger';
import { ClientBinaryMessage as BinaryMessage, CommandId, ProtocolId } from '../protocol/ClientProtocol';
import type { WebSocketMessage, SessionConfigPayload, TextDataPayload } from '../protocol/ClientProtocol';
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

  // 性能测试相关属性
  private isPerformanceTesting: boolean = false;
  private testResults: Array<{
    testId: string;
    testType: 'ping' | 'text' | 'audio';
    startTime: number;
    endTime?: number;
    latency?: number;
    success: boolean;
    error?: string;
  }> = [];
  private performanceTestConfig = {
    pingCount: 100,        // Ping测试次数
    textTestCount: 50,     // 文本消息测试次数
    audioTestCount: 30,    // 音频消息测试次数
    concurrency: 5,        // 并发连接数
    interval: 10,          // 测试间隔(ms)
  };

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
        logger.debug(`发送二进制消息: 大小=${bytes.length}字节, 消息类型=${message.header.commandId}`);
        this.websocket.send(bytes);
      } catch (error) {
        logger.error(`发送二进制消息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.error('WebSocket未连接，无法发送二进制消息');
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

  /**
   * 启动高性能服务器响应速度测试
   */
  async startPerformanceTest(options?: {
    pingCount?: number;
    textTestCount?: number;
    audioTestCount?: number;
    concurrency?: number;
    interval?: number;
  }): Promise<PerformanceTestResult> {
    if (this.isPerformanceTesting) {
      throw new Error('性能测试已在进行中');
    }

    // 更新测试配置
    if (options) {
      this.performanceTestConfig = { ...this.performanceTestConfig, ...options };
    }

    this.isPerformanceTesting = true;
    this.testResults = [];

    console.log('[PERF TEST] 开始性能测试...', this.performanceTestConfig);

    try {
      // 1. Ping延迟测试 (最高优先级，测试基础连接性能)
      await this.runPingLatencyTest();

      // 2. 文本消息响应测试
      await this.runTextResponseTest();

      // 3. 音频消息吞吐量测试
      await this.runAudioThroughputTest();

      // 4. 并发连接测试
      await this.runConcurrencyTest();

      return this.calculateTestResults();
    } finally {
      this.isPerformanceTesting = false;
    }
  }

  /**
   * Ping延迟测试 - 测试基础网络延迟
   */
  private async runPingLatencyTest(): Promise<void> {
    console.log('[PERF TEST] 开始Ping延迟测试...');

    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.performanceTestConfig.pingCount; i++) {
      const promise = new Promise<void>((resolve) => {
        const testId = `ping_${i}_${Date.now()}`;
        const startTime = performance.now();

        this.testResults.push({
          testId,
          testType: 'ping',
          startTime,
          success: false
        });

        // 发送Ping消息
        if (this.websocket?.readyState === WebSocket.OPEN) {
          const pingMessage = BinaryMessage.createPing(this.sessionId!);

          // 监听响应 (通过现有的心跳响应机制)
          const timeoutId = setTimeout(() => {
            const result = this.testResults.find(r => r.testId === testId);
            if (result && !result.endTime) {
              result.success = false;
              result.error = 'Timeout';
              result.endTime = performance.now();
            }
            resolve();
          }, 5000);

          // 假设服务器会响应ping，这里模拟响应处理
          const originalPingLength = this.pingTimestamps.length;

          this.sendBinaryMessage(pingMessage);

          // 检查响应
          const checkResponse = () => {
            if (this.pingTimestamps.length > originalPingLength) {
              clearTimeout(timeoutId);
              const endTime = performance.now();
              const result = this.testResults.find(r => r.testId === testId);
              if (result) {
                result.endTime = endTime;
                result.latency = endTime - startTime;
                result.success = true;
              }
              resolve();
            } else {
              setTimeout(checkResponse, 1);
            }
          };

          setTimeout(checkResponse, 1);
        } else {
          const result = this.testResults.find(r => r.testId === testId);
          if (result) {
            result.success = false;
            result.error = 'WebSocket not connected';
            result.endTime = performance.now();
          }
          resolve();
        }
      });

      promises.push(promise);

      // 控制发送频率
      if (i < this.performanceTestConfig.pingCount - 1) {
        await new Promise(resolve => setTimeout(resolve, this.performanceTestConfig.interval));
      }
    }

    await Promise.all(promises);
    console.log('[PERF TEST] Ping延迟测试完成');
  }

  /**
   * 文本消息响应测试 - 测试文本消息的处理速度
   */
  private async runTextResponseTest(): Promise<void> {
    console.log('[PERF TEST] 开始文本消息响应测试...');

    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.performanceTestConfig.textTestCount; i++) {
      const promise = new Promise<void>((resolve) => {
        const testId = `text_${i}_${Date.now()}`;
        const startTime = performance.now();

        this.testResults.push({
          testId,
          testType: 'text',
          startTime,
          success: false
        });

        // 发送测试文本消息
        const testMessage = {
          type: "text_data",
          text: `性能测试消息 #${i} - ${new Date().toISOString()}`
        } as TextDataPayload;

        // 监听响应
        const responseHandler = () => {
          const endTime = performance.now();
          const result = this.testResults.find(r => r.testId === testId);
          if (result) {
            result.endTime = endTime;
            result.latency = endTime - startTime;
            result.success = true;
          }
          this.off('response.text.delta', responseHandler);
          this.off('response.text.done', responseHandler);
          resolve();
        };

        setTimeout(() => {
          const result = this.testResults.find(r => r.testId === testId);
          if (result && !result.endTime) {
            result.success = false;
            result.error = 'Timeout';
            result.endTime = performance.now();
          }
          this.off('response.text.delta', responseHandler);
          this.off('response.text.done', responseHandler);
          resolve();
        }, 10000);

        this.on('response.text.delta', responseHandler);
        this.on('response.text.done', responseHandler);

        this.sendTextMessage(testMessage, CommandId.TextData);
      });

      promises.push(promise);

      // 控制发送频率
      if (i < this.performanceTestConfig.textTestCount - 1) {
        await new Promise(resolve => setTimeout(resolve, this.performanceTestConfig.interval * 2));
      }
    }

    await Promise.all(promises);
    console.log('[PERF TEST] 文本消息响应测试完成');
  }

  /**
   * 音频消息吞吐量测试 - 测试音频处理能力
   */
  private async runAudioThroughputTest(): Promise<void> {
    console.log('[PERF TEST] 开始音频消息吞吐量测试...');

    // 生成测试音频数据 (模拟20ms的16kHz单声道音频)
    const sampleRate = 16000;
    const duration = 0.02; // 20ms
    const samples = Math.floor(sampleRate * duration);
    const testAudioData = new Uint8Array(samples * 2); // 16-bit audio

    // 填充测试数据
    for (let i = 0; i < testAudioData.length; i++) {
      testAudioData[i] = Math.floor(Math.random() * 256);
    }

    const promises: Promise<void>[] = [];

    for (let i = 0; i < this.performanceTestConfig.audioTestCount; i++) {
      const promise = new Promise<void>((resolve) => {
        const testId = `audio_${i}_${Date.now()}`;
        const startTime = performance.now();

        this.testResults.push({
          testId,
          testType: 'audio',
          startTime,
          success: false
        });

        // 监听音频响应
        const responseHandler = () => {
          const endTime = performance.now();
          const result = this.testResults.find(r => r.testId === testId);
          if (result) {
            result.endTime = endTime;
            result.latency = endTime - startTime;
            result.success = true;
          }
          this.off('response.audio.delta', responseHandler);
          resolve();
        };

        setTimeout(() => {
          const result = this.testResults.find(r => r.testId === testId);
          if (result && !result.endTime) {
            result.success = false;
            result.error = 'Timeout';
            result.endTime = performance.now();
          }
          this.off('response.audio.delta', responseHandler);
          resolve();
        }, 15000);

        this.on('response.audio.delta', responseHandler);

        // 发送音频数据
        const audioMessage = BinaryMessage.createAudioChunk(this.sessionId!, testAudioData);
        this.sendBinaryMessage(audioMessage);
      });

      promises.push(promise);

      // 控制发送频率
      if (i < this.performanceTestConfig.audioTestCount - 1) {
        await new Promise(resolve => setTimeout(resolve, this.performanceTestConfig.interval));
      }
    }

    await Promise.all(promises);
    console.log('[PERF TEST] 音频消息吞吐量测试完成');
  }

  /**
   * 并发连接测试 - 测试服务器并发处理能力
   */
  private async runConcurrencyTest(): Promise<void> {
    console.log('[PERF TEST] 开始并发连接测试...');

    // 注意：这里只是发送并发消息，而不是创建多个连接
    // 因为在实际应用中，通常是单个连接的并发消息处理
    const concurrentPromises: Promise<void>[] = [];

    for (let i = 0; i < this.performanceTestConfig.concurrency; i++) {
      const promise = new Promise<void>(async (resolve) => {
        const testId = `concurrent_${i}_${Date.now()}`;
        const startTime = performance.now();

        this.testResults.push({
          testId,
          testType: 'ping',
          startTime,
          success: false
        });

        // 发送并发消息
        if (this.websocket?.readyState === WebSocket.OPEN) {
          const pingMessage = BinaryMessage.createPing(this.sessionId!);
          this.sendBinaryMessage(pingMessage);

          // 简单的成功检测
          setTimeout(() => {
            const result = this.testResults.find(r => r.testId === testId);
            if (result) {
              result.endTime = performance.now();
              result.latency = result.endTime - startTime;
              result.success = true;
            }
            resolve();
          }, 100);
        } else {
          const result = this.testResults.find(r => r.testId === testId);
          if (result) {
            result.success = false;
            result.error = 'WebSocket not connected';
            result.endTime = performance.now();
          }
          resolve();
        }
      });

      concurrentPromises.push(promise);
    }

    await Promise.all(concurrentPromises);
    console.log('[PERF TEST] 并发连接测试完成');
  }

  /**
   * 计算测试结果
   */
  private calculateTestResults(): PerformanceTestResult {
    const pingResults = this.testResults.filter(r => r.testType === 'ping');
    const textResults = this.testResults.filter(r => r.testType === 'text');
    const audioResults = this.testResults.filter(r => r.testType === 'audio');

    const calculateStats = (results: typeof this.testResults) => {
      const successful = results.filter(r => r.success && r.latency);
      const latencies = successful.map(r => r.latency!);

      if (latencies.length === 0) {
        return {
          count: results.length,
          successRate: 0,
          averageLatency: 0,
          minLatency: 0,
          maxLatency: 0,
          p50: 0,
          p95: 0,
          p99: 0
        };
      }

      latencies.sort((a, b) => a - b);

      return {
        count: results.length,
        successRate: (successful.length / results.length) * 100,
        averageLatency: latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
        minLatency: latencies[0],
        maxLatency: latencies[latencies.length - 1],
        p50: latencies[Math.floor(latencies.length * 0.5)],
        p95: latencies[Math.floor(latencies.length * 0.95)],
        p99: latencies[Math.floor(latencies.length * 0.99)]
      };
    };

    const result: PerformanceTestResult = {
      summary: {
        totalTests: this.testResults.length,
        totalSuccessful: this.testResults.filter(r => r.success).length,
        overallSuccessRate: (this.testResults.filter(r => r.success).length / this.testResults.length) * 100,
        testDuration: Math.max(...this.testResults.map(r => r.endTime || r.startTime)) - Math.min(...this.testResults.map(r => r.startTime))
      },
      ping: calculateStats(pingResults),
      text: calculateStats(textResults),
      audio: calculateStats(audioResults),
      rawResults: this.testResults
    };

    console.log('[PERF TEST] 测试结果:', result);
    return result;
  }

  /**
   * 获取性能测试状态
   */
  get isTestingPerformance(): boolean {
    return this.isPerformanceTesting;
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