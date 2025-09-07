import { Logger } from '../utils/logger.js';
import { BINARY_MESSAGE } from '../types/protocol.js';

interface SDKMessageHandlerEvents {
  onSessionCreated?: (sessionId: string) => void;
  onSessionCreateFailed?: (reason: string) => void;
  onAudioDataReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onPongReceived?: (latency: number, jitter: number) => void;
}

export class SDKMessageHandler {
  private logger: Logger;
  private events: SDKMessageHandlerEvents = {};

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 设置事件回调
   */
  public setCallbacks(events: SDKMessageHandlerEvents): void {
    this.events = events;
  }

  /**
   * 处理WebSocket消息
   */
  public handleMessage(event: MessageEvent): void {
    try {
      // 检查消息类型（文本或二进制）
      if (typeof event.data === 'string') {
        // 文本消息
        const message = JSON.parse(event.data);
        this.logger.info(`[SDK] 收到服务器文本消息: ${JSON.stringify(message)}`);
        this.handleTextMessage(message);
      } else {
        // 二进制消息
        this.logger.info(`[SDK] 收到服务器二进制消息，长度: ${event.data.byteLength} 字节`);
        this.handleBinaryMessage(event.data);
      }
    } catch (error) {
      this.logger.error(`[SDK] 处理WebSocket消息时出错: ${error instanceof Error ? error.message : String(error)}`);
      this.logger.error(`[SDK] 原始消息数据: ${event.data}`);
    }
  }

  /**
   * 处理文本消息
   */
  private handleTextMessage(message: any): void {
    try {
      // 打印完整的原始消息到前端日志
      this.logger.info(`[SDK] 📨 收到完整消息: ${JSON.stringify(message, null, 2)}`);

      // 详细解析消息结构
      this.logger.debug(`[SDK] 🔍 消息结构分析:`);
      this.logger.debug(`  ├─ Protocol ID: ${message.protocol_id || 'N/A'}`);
      this.logger.debug(`  ├─ Command ID: ${message.command_id || 'N/A'}`);
      this.logger.debug(`  ├─ Session ID: ${message.session_id || 'N/A'}`);
      this.logger.debug(`  └─ Payload: ${message.payload ? 'Yes' : 'No'}`);

      // 检查消息格式，支持两种格式：
      // 1. 直接格式：{ "type": "...", ... }
      // 2. 嵌套格式：{ "payload": { "type": "...", ... }, ... }

      let actualMessage = message;
      let messageType = message.type;

      // 如果顶级没有type字段，检查payload内部
      if (!messageType && message.payload && message.payload.type) {
        actualMessage = message.payload;
        messageType = message.payload.type;
        actualMessage.session_id = message.session_id; // 保持会话ID

        this.logger.debug(`[SDK] 📦 检测到嵌套格式消息，提取payload:`);
        this.logger.debug(`  ├─ Type: ${actualMessage.type}`);
        this.logger.debug(`  ├─ Event ID: ${actualMessage.event_id || 'N/A'}`);
        this.logger.debug(`  ├─ Response ID: ${actualMessage.response_id || 'N/A'}`);
        this.logger.debug(`  ├─ Item ID: ${actualMessage.item_id || 'N/A'}`);
        this.logger.debug(`  ├─ Output Index: ${actualMessage.output_index || 'N/A'}`);
        this.logger.debug(`  └─ Content Index: ${actualMessage.content_index || 'N/A'}`);
      }

      this.logger.info(`[SDK] 🔍 解析结果 - messageType: "${messageType}"`);

      // 如果还是没有type字段，但有其他有用信息，也要记录
      if (!messageType) {
        this.logger.warning(`[SDK] ❌ 收到没有type字段的消息，但记录其他信息:`);
        this.logger.warning(`  ├─ Protocol ID: ${message.protocol_id}`);
        this.logger.warning(`  ├─ Command ID: ${message.command_id}`);
        this.logger.warning(`  └─ 完整消息: ${JSON.stringify(message)}`);
        return;
      }

      this.logger.info(`[SDK] ✅ 处理消息类型: ${messageType}`);

      // 根据消息类型处理
      switch (messageType) {
        case 'session.created':
        case 'session_created':
          this.handleSessionCreated(actualMessage);
          break;
        case 'session.create.failed':
        case 'session_create_failed':
          this.handleSessionCreateFailed(actualMessage);
          break;
        case 'response.text.delta':
          this.handleStreamingText(actualMessage);
          break;
        case 'response.text.done':
          this.handleTextComplete();
          break;
        case 'response.audio.delta':
          this.handleStreamingAudio(actualMessage);
          break;
        case 'audio_data':
          this.handleAudioData(actualMessage);
          break;
        case 'pong':
          this.handlePongResponse(actualMessage);
          break;
        case 'error.event':
        case 'error':
          this.handleErrorMessage(actualMessage);
          break;
        default:
          this.logger.warning(`[SDK] ❓ 未知消息类型: "${messageType}"`);
          this.logger.warning(`[SDK] 📄 完整消息内容: ${JSON.stringify(actualMessage, null, 2)}`);
      }
    } catch (error) {
      this.logger.error(`[SDK] 处理文本消息时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 处理二进制消息
   */
  private handleBinaryMessage(data: ArrayBuffer): void {
    try {
      // 解析二进制消息头部
      const headerBytes = new Uint8Array(data, 0, BINARY_MESSAGE.BINARY_HEADER_SIZE);

      // 解析会话ID
      const sessionIdBytes = headerBytes.slice(0, BINARY_MESSAGE.NANOID_SIZE);
      const receivedSessionId = new TextDecoder().decode(sessionIdBytes).replace(/\0+$/, '');

      // 解析协议ID和命令ID
      const protocolId = headerBytes[BINARY_MESSAGE.PROTOCOL_ID_OFFSET];
      const commandId = headerBytes[BINARY_MESSAGE.COMMAND_ID_OFFSET];

      this.logger.info(`[SDK] 收到二进制消息 - 会话ID: ${receivedSessionId}, 协议ID: ${protocolId}, 命令ID: ${commandId}`);

      // 根据协议ID和命令ID处理消息
      if (protocolId === BINARY_MESSAGE.PROTOCOL_ID_TTS && commandId === BINARY_MESSAGE.CMD_AUDIO_CHUNK) {
        // TTS音频数据
        const payloadBytes = new Uint8Array(data, BINARY_MESSAGE.BINARY_HEADER_SIZE);
        this.events.onAudioDataReceived?.(payloadBytes.buffer.slice(0));
      } else if (protocolId === BINARY_MESSAGE.PROTOCOL_ID_CONTROL && commandId === BINARY_MESSAGE.CMD_RESULT) {
        // 控制消息响应
        this.logger.info('[SDK] 收到控制消息响应');
      } else {
        this.logger.warning(`[SDK] 未处理的二进制消息类型 - 协议ID: ${protocolId}, 命令ID: ${commandId}`);
      }
    } catch (error) {
      this.logger.error(`[SDK] 处理二进制消息时出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 处理会话创建成功
   */
  private handleSessionCreated(message: any): void {
    this.logger.debug(`[SDK] 🔍 检查会话创建响应:`);
    this.logger.debug(`[SDK]    ├─ 收到session_id: ${message.session_id}`);

    if (message.session_id) {
      this.logger.info(`[SDK] ✅ 会话创建成功: ${message.session_id}`);
      
      if (this.events.onSessionCreated) {
        this.events.onSessionCreated(message.session_id);
      }
    } else {
      this.logger.warning(`[SDK] ❌ 收到会话创建响应但没有session_id`);
    }
  }

  /**
   * 处理会话创建失败
   */
  private handleSessionCreateFailed(message: any): void {
    this.logger.error(`[SDK] 会话创建失败: ${message.reason}`);
    
    if (this.events.onSessionCreateFailed) {
      this.events.onSessionCreateFailed(message.reason);
    }
  }

  /**
   * 处理流式文本
   */
  private handleStreamingText(message: any): void {
    if (message.delta) {
      this.logger.info(`[SDK] 💬 AI流式文本: "${message.delta}"`);
      this.logger.debug(`[SDK]    📍 位置信息 - Response ID: ${message.response_id}, Content Index: ${message.content_index}`);

      // 触发文本接收事件
      if (this.events.onTextReceived) {
        this.events.onTextReceived(message.delta);
      }
    }
  }

  /**
   * 处理文本完成
   */
  private handleTextComplete(): void {
    this.logger.info(`[SDK] 📝 AI文本输出完成`);
  }

  /**
   * 处理流式音频
   */
  private handleStreamingAudio(message: any): void {
    if (message.delta) {
      this.logger.info(`[SDK] 🎵 AI流式音频数据: ${message.delta.length} 字符 (base64)`);
      this.logger.debug(`[SDK]    📍 音频信息 - Response ID: ${message.response_id}, Item ID: ${message.item_id}`);

      if (message.delta.length === 0) {
        this.logger.warning('[SDK] ❗️ 收到空的音频数据');
      }
    }
  }

  /**
   * 处理音频数据
   */
  private handleAudioData(message: any): void {
    // 处理传统音频数据格式
    if (message.payload && message.payload.data) {
      // 如果需要处理这种格式的音频数据，可以在这里添加
    }
  }

  /**
   * 处理pong响应
   */
  private handlePongResponse(message: any): void {
    if (message.id && this.events.onPongReceived) {
      // 这里需要从WebSocketManager获取ping时间戳来计算延迟
      // 实际的延迟计算在WebSocketManager中进行
      this.logger.debug('[SDK] 收到pong响应');
    }
  }

  /**
   * 处理错误消息
   */
  private handleErrorMessage(message: any): void {
    const errorCode = message.code || 'unknown';
    const errorMessage = message.message || '未知错误';

    this.logger.error(`[SDK] 🚨 服务器错误 [${errorCode}]: ${errorMessage}`);

    // 根据错误代码进行特定处理
    switch (errorCode) {
      case 1001:
        this.logger.warning('[SDK] 💡 建议: 请尝试更大声说话或检查麦克风设置');
        break;
      case 1002:
        this.logger.warning('[SDK] 💡 建议: 会话可能已过期，请重新创建会话');
        break;
      default:
        this.logger.warning(`[SDK] 💡 请检查系统状态或联系技术支持`);
    }
  }
}