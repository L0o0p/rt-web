import { WebSocketManager } from '../connection/WebSocketManager';
import { Logger } from '../audio/Logger';
import { BinaryMessage } from '../protocol/BinaryMessage';
import { SDKMessageHandler } from './SDKMessageHandler';

interface VoiceChatCoreEvents {
  onSessionCreated?: (sessionId: string) => void;
  onSessionCreateFailed?: (reason: string) => void;
  onConnectionStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error', message?: string) => void;
  onAudioDataReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
}

export class VoiceChatCore {
  private websocketManager: WebSocketManager;
  private logger: Logger;
  private messageHandler: SDKMessageHandler;
  private events: VoiceChatCoreEvents = {};
  private isDestroyed: boolean = false;

  constructor(logger: Logger) {
    this.logger = logger;
    this.websocketManager = new WebSocketManager(logger);
    
    // 使用SDK专用的消息处理器
    this.messageHandler = new SDKMessageHandler(logger);
    
    // 绑定消息处理器的回调
    this.setupMessageHandlerCallbacks();
  }

  /**
   * 设置消息处理器回调
   */
  private setupMessageHandlerCallbacks(): void {
    this.messageHandler.setCallbacks({
      onSessionCreated: (sessionId: string) => {
        this.websocketManager.setSessionCreated(true);
        this.logger.info(`[SDK] 会话创建成功: ${sessionId}`);
        // 触发外部回调
        this.events.onSessionCreated?.(sessionId);
      },
      onSessionCreateFailed: (reason: string) => {
        this.websocketManager.setSessionCreated(false);
        this.logger.error(`[SDK] 会话创建失败: ${reason}`);
        // 触发外部回调
        this.events.onSessionCreateFailed?.(reason);
      },
      onAudioDataReceived: (audioData: ArrayBuffer) => {
        this.events.onAudioDataReceived?.(audioData);
      },
      onTextReceived: (text: string) => {
        this.events.onTextReceived?.(text);
      },
      onPongReceived: (latency: number, jitter: number) => {
        // 这里可以触发外部的pong回调，如果需要的话
        this.logger.debug(`[SDK] 收到pong响应 - 延迟: ${latency}ms, 抖动: ${jitter}ms`);
      }
    });
  }

  /**
   * 设置事件回调
   */
  public setEventCallbacks(events: VoiceChatCoreEvents): void {
    this.events = events;
  }

  /**
   * 连接到服务器
   */
  public async connect(): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('VoiceChatCore instance has been destroyed');
    }

    try {
      // 通知连接状态变化
      this.events.onConnectionStatusChange?.('connecting', '正在连接...');

      // 连接WebSocket
      await this.websocketManager.connect({
        onOpen: () => this.handleWebSocketOpen(),
        onMessage: (event) => this.handleWebSocketMessage(event),
        onClose: () => this.handleWebSocketClose(),
        onError: (error) => this.handleWebSocketError(error)
      });

    } catch (error) {
      this.logger.error(`连接失败: ${error instanceof Error ? error.message : String(error)}`);
      this.events.onConnectionStatusChange?.('error', `连接失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * 断开连接
   */
  public disconnect(): void {
    if (this.isDestroyed) {
      return;
    }

    this.websocketManager.disconnect();
    this.events.onConnectionStatusChange?.('disconnected', '连接已断开');
  }

  /**
   * 销毁实例
   */
  public destroy(): void {
    this.disconnect();
    this.isDestroyed = true;
  }

  /**
   * 发送音频数据
   */
  public sendAudioData(audioData: Float32Array): boolean {
    if (this.isDestroyed) {
      this.logger.warn('尝试向已销毁的实例发送音频数据');
      return false;
    }

    if (!this.websocketManager.isConnected) {
      this.logger.warn('WebSocket未连接，无法发送音频数据');
      return false;
    }

    if (!this.websocketManager.isSessionCreated) {
      this.logger.warn('会话未创建，无法发送音频数据');
      // 尝试重新创建会话
      this.websocketManager.recreateSession();
      return false;
    }

    try {
      // 获取会话ID
      const sessionId = this.websocketManager.currentSessionId;
      if (!sessionId) {
        this.logger.warn('会话ID缺失，无法发送音频数据');
        return false;
      }

      // 将浮点数数组转换为S16LE格式的字节数组
      const audioDataBytes = new Uint8Array(audioData.length * 2);
      for (let i = 0; i < audioData.length; i++) {
        const int16Value = Math.max(-32768, Math.min(32767, Math.round(audioData[i] * 32768)));
        audioDataBytes[i * 2] = int16Value & 0xFF;         // 低字节
        audioDataBytes[i * 2 + 1] = (int16Value >> 8) & 0xFF; // 高字节
      }

      // 创建并发送二进制音频数据消息
      const audioMessage = BinaryMessage.createAudioChunk(sessionId, audioDataBytes);
      this.websocketManager.sendBinaryMessage(audioMessage);
      
      this.logger.debug(`发送音频数据: ${audioDataBytes.length} 字节 (${audioData.length} 样本)`);
      return true;
    } catch (error) {
      this.logger.error(`发送音频数据失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 处理WebSocket打开事件
   */
  private handleWebSocketOpen(): void {
    this.logger.info('WebSocket连接已建立');
    this.events.onConnectionStatusChange?.('connected', 'WebSocket连接已建立');
  }

  /**
   * 处理WebSocket消息事件
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    // 直接委托给SDKMessageHandler处理
    this.messageHandler.handleMessage(event);
  }

  /**
   * 处理WebSocket关闭事件
   */
  private handleWebSocketClose(): void {
    this.logger.info('WebSocket连接已关闭');
    this.events.onConnectionStatusChange?.('disconnected', 'WebSocket连接已关闭');
  }

  /**
   * 处理WebSocket错误事件
   */
  private handleWebSocketError(error: Event | unknown): void {
    this.logger.error(`WebSocket错误: ${error instanceof Error ? error.message : String(error)}`);
    this.events.onConnectionStatusChange?.('error', `WebSocket错误: ${error instanceof Error ? error.message : String(error)}`);
  }

  /**
   * 处理文本消息
   */
  /**
   * 获取连接状态
   */
  public get isConnected(): boolean {
    return this.websocketManager.isConnected;
  }

  /**
   * 获取会话创建状态
   */
  public get isSessionCreated(): boolean {
    return this.websocketManager.isSessionCreated;
  }

  /**
   * 获取当前会话ID
   */
  public get currentSessionId(): string | null {
    return this.websocketManager.currentSessionId;
  }
}