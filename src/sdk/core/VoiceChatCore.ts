import { CombinedConnectionManager } from '../connection/CombinedConnectionManager';
import { globalLogger as logger } from '../utils/GlobalLogger';
import { ClientBinaryMessage as BinaryMessage, ProtocolId } from '../protocol/ClientProtocol';
import type { SessionConfigPayload } from '../protocol/ClientProtocol';
import { EventEmitter } from '../utils/EventEmitter';

export class VoiceChatCore extends EventEmitter {
  private connectionManager: CombinedConnectionManager;
  private isDestroyed: boolean = false;

  constructor(defaultSessionConfig?: Partial<SessionConfigPayload>) {
    super();
    this.connectionManager = new CombinedConnectionManager(undefined, defaultSessionConfig);

    // 绑定消息处理器的回调
    this.setupMessageHandlerCallbacks();
  }

  /**
   * 设置消息处理器回调
   */
  private setupMessageHandlerCallbacks(): void {
    // 使用onAny监听所有从connectionManager发出的事件并进行转发
    this.connectionManager.onAny((event: string, ...args: any[]) => {
      // 直接转发所有事件
      this.emit(event, ...args);
    });
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
      this.emit('connectionStatusChange', 'connecting', '正在连接...');

      // 连接WebSocket
      await this.connectionManager.connect();

    } catch (error) {
      logger.error(`连接失败: ${error instanceof Error ? error.message : String(error)}`);
      this.emit('connectionStatusChange', 'error', `连接失败: ${error instanceof Error ? error.message : String(error)}`);
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

    this.connectionManager.disconnect();
    this.emit('connectionStatusChange', 'disconnected', '连接已断开');
  }

  /**
   * 销毁实例
   */
  public destroy(): void {
    this.disconnect();
    this.isDestroyed = true;
    this.removeAllListeners();
    this.connectionManager = null as any;
  }

  /**
   * 发送已编码的音频数据
   */
  public sendEncodedAudioData(audioData: Uint8Array): boolean {
    // 检查输入数据是否为空
    if (!audioData || audioData.length === 0) {
      logger.warn('尝试发送空的音频数据，已阻止发送');
      return false;
    }

    // 记录发送的音频数据信息
    logger.debug(`准备发送音频数据: ${audioData.length} 字节`);

    // 验证数据是否符合基本要求
    if (audioData.length < 10) {
      logger.warn('音频数据太短，可能无效，长度:', audioData.length);
      return false;
    }

    if (this.isDestroyed) {
      logger.warn('尝试向已销毁的实例发送音频数据');
      return false;
    }

    if (!this.connectionManager.isConnected) {
      logger.warn('WebSocket未连接，无法发送音频数据');
      return false;
    }

    if (!this.connectionManager.isSessionCreated) {
      logger.warn('会话未创建，无法发送音频数据');
      return false;
    }

    try {
      // 获取会话ID
      const sessionId = this.connectionManager.currentSessionId;
      if (!sessionId) {
        logger.warn('会话ID缺失，无法发送音频数据');
        return false;
      }

      // 创建并发送二进制音频数据消息
      const audioMessage = BinaryMessage.createAudioChunk(sessionId, audioData);
      this.connectionManager.sendBinaryMessage(audioMessage);

      logger.debug(`发送已编码音频数据: ${audioData.length} 字节`);
      return true;
    } catch (error) {
      logger.error(`发送已编码音频数据失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 获取连接状态
   */
  public get isConnected(): boolean {
    return this.connectionManager.isConnected;
  }

  /**
   * 获取会话创建状态
   */
  public get isSessionCreated(): boolean {
    return this.connectionManager.isSessionCreated;
  }

  /**
   * 获取当前会话ID
   */
  public get currentSessionId(): string | null {
    return this.connectionManager.currentSessionId || null;
  }

  /**
   * 设置会话配置
   */
  public setSessionConfig(config: Partial<SessionConfigPayload>): void {
    // 更新 CombinedConnectionManager 的默认配置
    this.connectionManager.setDefaultSessionConfig(config);

    // 如果已经连接，重新创建会话并传递配置
    if (this.isConnected) {
      this.connectionManager.recreateSession(undefined, config);
    }
    // 如果尚未连接，配置将在下次连接时自动使用
  }

  /**
   * 开始新会话
   */
  public startSession(config?: Partial<SessionConfigPayload>): void {
    if (this.isDestroyed) {
      throw new Error('VoiceChatCore instance has been destroyed');
    }

    // 重新创建会话
    this.connectionManager.recreateSession(undefined, config);
  }

  /**
   * 发送图像数据
   * @param imageData 图像二进制数据
   * @param prompt 可选的提示词，如果不提供则使用空字符串
   * @param protocolId 协议ID，默认为All
   */
  public sendImageData(imageData: Uint8Array, prompt?: string, protocolId?: ProtocolId): boolean {
    // 检查输入数据是否为空
    if (!imageData || imageData.length === 0) {
      logger.warn('尝试发送空的图像数据，已阻止发送');
      return false;
    }

    // 记录发送的图像数据信息
    logger.debug(`准备发送图像数据: ${imageData.length} 字节`);

    // 验证图像大小（默认5MB限制）
    const maxImageSize = 5 * 1024 * 1024; // 5MB
    if (imageData.length > maxImageSize) {
      logger.warn(`图像文件过大: ${imageData.length} 字节，最大限制: ${maxImageSize} 字节`);
      return false;
    }

    if (this.isDestroyed) {
      logger.warn('尝试向已销毁的实例发送图像数据');
      return false;
    }

    if (!this.connectionManager.isConnected) {
      logger.warn('WebSocket未连接，无法发送图像数据');
      return false;
    }

    if (!this.connectionManager.isSessionCreated) {
      logger.warn('会话未创建，无法发送图像数据');
      return false;
    }

    try {
      // 获取会话ID
      const sessionId = this.connectionManager.currentSessionId;
      if (!sessionId) {
        logger.warn('会话ID缺失，无法发送图像数据');
        return false;
      }

      // 使用提供的协议ID或默认为All(100)
      const finalProtocolId = protocolId || ProtocolId.All;

      const promptText = prompt || "";
      logger.info(`[IMAGE] 准备发送图像数据 - 会话ID: ${sessionId}, 协议ID: ${finalProtocolId}, 数据大小: ${imageData.length} 字节, 提示词: "${promptText}"`);

      // 创建并发送二进制图像数据消息（新的payload格式）
      const imageMessage = BinaryMessage.createImageData(sessionId, imageData, promptText, finalProtocolId);

      logger.info(`[IMAGE] 二进制消息已创建，头部信息 - 会话ID: ${imageMessage.header.sessionId}, 协议ID: ${imageMessage.header.protocolId}, 命令ID: ${imageMessage.header.commandId}, 总payload大小: ${imageMessage.payload.length} 字节`);

      this.connectionManager.sendBinaryMessage(imageMessage);

      logger.info(`[IMAGE] 图像数据发送完成: 图像${imageData.length}字节 + 提示词${new TextEncoder().encode(promptText).length}字节，协议ID: ${finalProtocolId}`);
      return true;
    } catch (error) {
      logger.error(`[IMAGE] 发送图像数据失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * 获取连接管理器实例 - 用于高精度性能监控
   */
  public getConnectionManager(): CombinedConnectionManager {
    return this.connectionManager;
  }
}