import { CONFIG, getWebSocketUrl } from '../types/protocol';
import { globalLogger as logger } from '../utils/GlobalLogger';
import { CommandId, ProtocolId } from '../protocol/ClientProtocol';
import type { WebSocketMessage, SessionConfigPayload, ClientBinaryMessage as BinaryMessage, ConversationItemCreatePayload } from '../protocol/ClientProtocol';
import {
  WebSocketMessageParser,
  BinaryMessageParser,
} from '../protocol/UnifiedParser';
import { EventEmitter } from '../utils/EventEmitter';

import {
  decodeResponseAudioDeltaMessage
} from '../protocol/BinaryAudioDecoder';

import type {
  BinaryAudioProtocolConfig,
  DecodingResult,
  DecodedAudioDeltaMessage
} from '../protocol/BinaryAudioTypes';


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

  // 会话相关属性
  private sessionId: string | undefined = undefined;
  private sessionCreated: boolean = false; // 服务端确认的会话创建状态（由 session.created 驱动）
  private defaultSessionConfig?: Partial<SessionConfigPayload>;

  // 消息解析器
  private webSocketParser: WebSocketMessageParser;
  private binaryParser: BinaryMessageParser;

  // ========== 高精度性能监控 ==========
  // 支持二进制协议优先的延迟计算：binary_audio_delta 事件优先于 response.audio.delta
  // 延迟计算方式已从 response.audio.delta 改为 binary_audio_delta
  private performanceTimers = new Map<string, number>(); // 存储各种事件的开始时间
  private latencyMetrics: Array<{
    type: string;
    startTime: number;
    endTime: number;
    latency: number;
    timestamp: number;
  }> = [];
  private maxMetricsHistory = 100; // 保留最近100次测量


  constructor(
    sessionId?: string,
    defaultSessionConfig?: Partial<SessionConfigPayload>,
    binaryAudioConfig?: Partial<BinaryAudioProtocolConfig>
  ) {
    super();
    this.webSocketParser = new WebSocketMessageParser();
    this.binaryParser = new BinaryMessageParser(binaryAudioConfig);
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

      this.websocket = new WebSocket(getWebSocketUrl());

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

      // 性能优化：减少详细日志输出
      if (message && typeof message === 'object' && 'type' in message && message.type === 'session_config') {
        const sessionConfig = message as SessionConfigPayload;
        logger.info(`[CLIENT] Sending WebSocket message with asr_language: ${sessionConfig.asr_language}`);
        // 移除详细的完整消息日志
      }

      try {
        this.websocket.send(messageStr);
        // 移除频繁的成功发送日志
      } catch (error) {
        logger.error(`发送文本消息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.error('WebSocket未连接，无法发送消息');
    }
  }

  /**
   * 工具调用闭环：把本地执行结果回传给服务端（conversation.item.create + function_call_output）
   * 备注：output 必须是字符串；这里对对象做 JSON.stringify
   */
  sendFunctionCallOutput(callId: string, output: unknown): void {
    if (!callId) {
      logger.error('[ToolCall] callId 为空，无法回传 function_call_output');
      return;
    }

    const payload: ConversationItemCreatePayload = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: typeof output === 'string' ? output : JSON.stringify(output ?? {}),
      }
    };

    this.sendTextMessage(payload, CommandId.Result);
  }

  /**
   * 发送二进制消息
   */
  sendBinaryMessage(message: BinaryMessage): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      try {
        const bytes = message.toBytes();

        // 性能优化：减少二进制消息的详细日志
        if (message.header.commandId === 6) { // ImageData command - 仅图像数据记录详情
          logger.info(`[BINARY] 发送图像数据 - 会话ID: ${message.header.sessionId}, 大小: ${bytes.length}字节`);
        }

        this.websocket.send(bytes);
        // 移除频繁的成功发送日志
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
    this.sessionCreated = false;
    this.createSession();
  }

  private handleClose(event: CloseEvent): void {
    this.sessionCreated = false;
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

  /**
   * 开始一个全新的会话（生成新的 sessionId）
   * 用于 StopInput 之后重新开始对话，避免复用旧 sessionId 导致服务端不再接受输入
   */
  startNewSession(config?: Partial<SessionConfigPayload>): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sessionId = this.generateSessionId();
      this.sessionCreated = false;
      this.createSession(config);
    }
  }

  private createSession(config?: Partial<SessionConfigPayload>): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.sessionId) {
      const sessionConfigPayload: SessionConfigPayload = {
        type: "session_config",
        mode: "vad",
        // 提示词
        //         system_prompt: `你是Squady realTime，一个由TeamSquady研发的智能语音助手。你具备以下特征和能力：

        // 身份定位
        // 你是用户的贴心语音伙伴，能够通过自然对话帮助用户解决各种问题。你性格友善、耐心，善于倾听并提供有价值的帮助。

        // 核心能力

        // 实时语音对话，支持自然流畅的多轮交流
        // 广泛的知识储备，涵盖生活、工作、学习等各个领域
        // 智能理解用户意图，提供精准的信息和建议
        // 支持任务协助，如日程管理、信息查询、内容创作等
        // 交互原则

        // 保持简洁明了的回答，避免冗长的解释
        // 用温暖、自然的语调与用户交流
        // 主动询问细节以更好地理解用户需求
        // 承认不确定性，诚实表达能力边界
        // 价值观

        // 始终以用户的最佳利益为出发点
        // 尊重用户隐私，保护个人信息安全
        // 提供客观、平衡的观点，避免偏见
        // 鼓励用户独立思考和学习成长`,
        system_prompt: "<assistantProfile><role><n>「好朋友」</n><description>「好朋友」是「好朋友」 Glasses的多语言语音AI助手,由squady和微克科技联合开发。</description><personality>友好高效,语音优化,多语言支持</personality></role><Requirements><requirement>始终使用用户输入语言回复</requirement><requirement>需要工具时立即调用,无需解释或确认</requirement><requirement>口语化表达:单位符号转文字(g→克),时间自然表述(10:00→十点整),温度单位保持工具返回值</requirement><requirement>数学符号转文字(+→加,-→减,*→乘,/→除以,=→等于),数字和变量不变</requirement><requirement>纯文本输出,禁用markdown,(如:#标题、**粗体**、*斜体*)</requirement><requirement>知识/教程类问题:先简答(2-3句),问'需要详细说明吗?',确认后再展开</requirement></Requirements><capabilitiesAndLimits><capability>默认对话回答,仅用户明确请求时调用工具,每轮一次</capability><capability>只用系统定义的工具,禁调不存在的工具(如日程提醒)</capability><capability>可接受用户指定的新名字、角色、性格</capability><capability>无法完成的请求需明确说明</capability><limit>未启用同声传译时不可声称已进入;用户仅说'同声传译'未指定语言对时,询问'请问哪两种语言互译?'</limit><limit>禁止生成视觉内容(棋盘布局,树状图,图表等)。回复:'抱歉,我是语音助手,无法生成视觉内容,我可以用语言描述相关概念或规则。'</limit><limit>台湾问题:禁止主权判断,仅述客观事实,末尾加声明。示例:'台湾位于东亚,主要语言中文,经济以电子半导体服务业为主。涉及主权问题我无法给出倾向结论。'</limit></capabilitiesAndLimits><conversationExit><ONLYwhen condition='用户说'退下'/'退一下'/'Exit please''>友好告别,会话结束</ONLYwhen><when condition='其他告别语(再见/拜拜/bye等)'>提醒用户需说'退下'才能退出</when></conversationExit></assistantProfile>",
        // mcp_server_config: [
        //   {
        //   "name": "mcp_server",
        //   "endpoint": "https://test-ai-howear.iwhop.cn/gateway/machine/functionCall/mcp"
        // }
        // ],
        "mcp_server_config": [
          {
            "endpoint": "https://test-ai-howear.iwhop.cn/gateway/machine/functionCall/mcp?deviceCode=7894&isTools=true&languageId=175&serviceTools=false&requestParam=%7B%22temperatureUnit%22:%22centigrade%22%7D",
            "timeout_secs": 30,
            "authorization": null
          }
        ],
        // "tools_endpoint":"https://test-ai-howear.iwhop.cn/gateway/machine/functionCall/tools?deviceCode=7211",  
        "tools": [
          {
            "type": "function",
            "function": {
              "name": "get_visual_QA",
              "description": "拍照识图工具.仅在用户使用指示词(这/那/这个/那个/这些/那些/前面/手里/手上/眼前/面前)询问当前视野中的物体时调用.不调用场景:知识问答,翻译任务,生活建议咨询.拍照不等于要拍照识图.",
              "parameters": {
                "type": "object",
                "properties": {
                  "question": {
                    "type": "string",
                    "description": "用户的拍照识图请求"
                  }
                },
                "required": [
                  "question"
                ]
              }
            }
          },
          {
            "type": "function",
            "function": {
              "name": "reminder",
              "description": "设置用户的提醒或日程.仅在用户明确表达提醒意图时调用(如'提醒我','设置闹钟','记得'等词汇).讨论时间或日程不等于要设置提醒.",
              "parameters": {
                "type": "object",
                "properties": {
                  "reminderType": {
                    "type": "string",
                    "description": "操作类型,当前仅支持 set",
                    "enum": [
                      "set"
                    ]
                  },
                  "content": {
                    "type": "string",
                    "description": "提醒内容,必须明确具体"
                  },
                  "startAt": {
                    "type": "string",
                    "description": "提醒触发时间,格式:YYYY-MM-DD HH:MM:SS.对于'X分钟后'类倒计时,直接计算最终时间;对于'X点到Y点的会议'类事件,使用开始时间."
                  }
                },
                "required": [
                  "reminderType",
                  "content",
                  "startAt"
                ]
              }
            }
          },
          {
            "type": "function",
            "function": {
              "name": "start_navigation",
              "description": "导航工具.仅在用户明确表示前往意图并给出目的地时调用.询问路线或交通信息不等于要导航.",
              "parameters": {
                "type": "object",
                "properties": {
                  "destination": {
                    "type": "string",
                    "description": "目的地,该字段必须以中文输出"
                  }
                },
                "required": [
                  "destination"
                ]
              }
            }
          },
          {
            "type": "function",
            "function": {
              "name": "get_weather",
              "description": "天气查询工具.仅在用户明确询问天气,温度,降水,空气质量时调用.注意:提到地点不等于询问天气,查询交通信息不要调用此工具.",
              "parameters": {
                "type": "object",
                "properties": {
                  "location": {
                    "type": "string",
                    "description": "查询地点,未指定则用户所在地"
                  },
                  "fromDate": {
                    "type": "string",
                    "description": "开始日期,格式 yyyy-MM-dd"
                  },
                  "toDate": {
                    "type": "string",
                    "description": "结束日期,格式 yyyy-MM-dd"
                  },
                  "language": {
                    "type": "string",
                    "description": "返回语言,必须匹配输入语种",
                    "enum": [
                      "zh",
                      "en",
                      "ja",
                      "ko"
                    ]
                  }
                },
                "required": [
                  "location"
                ]
              }
            }
          },
          {
            "type": "function",
            "function": {
              "name": "device_control",
              "description": "电量查询工具.仅在用户询问助手剩余电量时调用(如'还有多少电','电量多少','需要充电吗').不调用场景:询问建议(如'电量不够用怎么办').",
              "parameters": {
                "type": "object",
                "properties": {
                  "target": {
                    "type": "string",
                    "description": "查询对象,固定为 battery",
                    "enum": [
                      "battery"
                    ]
                  },
                  "actionMode": {
                    "type": "string",
                    "description": "操作模式,固定为 query",
                    "enum": [
                      "query"
                    ]
                  }
                },
                "required": [
                  "target",
                  "actionMode"
                ]
              }
            }
          },
          {
            "type": "function",
            "function": {
              "name": "take_photo",
              "description": "拍照工具.仅在用户明确要求拍照时调用(如'拍照','拍张照片','帮我拍下来'等).注意:单纯拍照不等于拍照识图,如果用户询问视野中的物体(如'前面是什么','这是什么'),应使用get_visual_QA工具而非此工具.",
              "parameters": {
                "type": "object",
                "properties": {
                  "action": {
                    "type": "string",
                    "description": "拍照操作,固定为 capture",
                    "enum": [
                      "capture"
                    ]
                  }
                },
                "required": [
                  "action"
                ]
              }
            }
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


  private cleanup(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // 清理 websocket 引用，避免内存泄漏
    this.websocket = null;
    this.sessionCreated = false;
  }

  // Getters
  get isConnected(): boolean {
    return this.websocket?.readyState === WebSocket.OPEN;
  }

  get currentSessionId(): string | undefined {
    return this.sessionId;
  }

  get isSessionCreated(): boolean {
    // 以服务端下发 session.created 为准（sessionId 只是客户端本地标识）
    return this.sessionCreated;
  }

  /**
   * 更新默认会话配置
   */
  setDefaultSessionConfig(config: Partial<SessionConfigPayload>): void {
    // 合并更新：避免调用方只传一个字段（如 voice_setting）就把默认的 asr/timezone/location 等覆盖掉
    this.defaultSessionConfig = {
      ...(this.defaultSessionConfig ?? {}),
      ...(config ?? {}),
    };
  }

  // === 以下是从原SDKMessageHandler迁移的方法 ===

  private handleMessage(event: MessageEvent): void {
    try {
      if (typeof event.data === 'string') {
        // 处理JSON消息（包括控制事件）
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

          // 🔧 修复：检查是否收到正确的音频缓冲区信令事件
          if (messageType && [
            'output_audio_buffer.started',
            'output_audio_buffer.stopped',
            'response.cancel',
            'output_audio_buffer.cleared',
            'conversation.item.truncated'
          ].includes(messageType)) {

            if (['output_audio_buffer.started', 'output_audio_buffer.stopped'].includes(messageType)) {
              console.log(`[SDK] 🟢 收到正确的音频缓冲区信令: ${messageType}`);
              console.log(`[SDK] 🟢 信令详情:`, actualMessage);
              console.log(`[SDK] 🟢 信令时间戳:`, new Date().toISOString());
            } else {
              console.log(`[SDK] 📝 收到其他控制事件: ${messageType}`);
              console.log(`[SDK] 📝 事件详情:`, actualMessage);
            }

            console.log(`[SDK] 📤 即将emit事件: ${messageType}`);
            this.emit(messageType, actualMessage);
            console.log(`[SDK] ✅ 事件已emit，等待App层处理`);
            // 移除return语句，确保正常消息处理流程继续
          }

          // ========== 高精度性能监控 - WebSocket层立即停止计时 ==========
          // 在消息解析完成后立即停止对应的计时器
          // 优先处理 binary_audio_delta 事件，response.audio.delta 作为备用方案
          if (messageType) {
            const latency = this.stopHighPrecisionTimer(messageType);
            if (latency !== null) {
              logger.info(`[PERF] High-precision latency for ${messageType}: ${latency.toFixed(3)}ms`);
            }
          }

          // 针对 response.audio.delta 进行解码（Base64 -> Opus -> PCM16）
          // response.audio.delta 的解码播放交由 App 层处理

          // 直接emit事件，事件类型就是messageType
          if (messageType === 'session.created') {
            this.sessionCreated = true;
          }
          this.emit(messageType, actualMessage);
        } catch (error) {
          logger.error(`[SDK] 处理文本消息时出错: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // 处理二进制消息（可能是混合协议）
        const dataSize = event.data instanceof ArrayBuffer ? event.data.byteLength :
          event.data instanceof Blob ? event.data.size : 0;

        if (dataSize === 0) {
          logger.warn(`[SDK] 收到空的二进制消息，跳过解析`);
          return;
        }

        console.log(`[SDK] 🔍 收到二进制消息，长度: ${dataSize} 字节 - 开始混合协议处理`);

        // 🔧 修复：支持混合协议处理
        // 尝试解析是否为混合协议消息（包含控制事件 + 二进制音频数据）
        this.handleMixedProtocolMessage(event.data).catch(error => {
          logger.error(`[SDK] 混合协议处理失败，回退到纯二进制音频处理:`, error);

          // 回退到原有的二进制音频处理
          this.handleBinaryAudioMessage(event.data).catch(fallbackError => {
            logger.error(`[SDK] 回退处理二进制音频消息时出错:`, fallbackError);
          });
        });
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
   * @param eventType 事件类型，支持 'binary_audio_delta'（二进制协议优先）和 'response.audio.delta'（JSON协议备用）
   * 延迟计算方式已优化为优先使用 binary_audio_delta 事件
   */
  public startHighPrecisionTimer(eventType: string): void {
    const now = performance.now();
    this.performanceTimers.set(eventType, now);
    // 性能优化：移除频繁的调试日志

    // 立即发出计时开始事件
    this.emit('performance:timer:start', {
      type: eventType,
      timestamp: now
    });
  }

  /**
   * 停止计时并记录延迟 - 1ms精度
   * @param eventType 事件类型，支持 'binary_audio_delta'（二进制协议优先）和 'response.audio.delta'（JSON协议备用）
   * @returns 延迟时间（毫秒），如果未找到对应的计时器则返回 null
   * 注意：binary_audio_delta 事件提供更精确的延迟计算
   */
  public stopHighPrecisionTimer(eventType: string): number | null {
    const endTime = performance.now();
    const startTime = this.performanceTimers.get(eventType);
    // 性能优化：移除频繁的调试日志

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
   * 更新二进制音频协议配置
   * @param config 新的配置选项
   */
  public updateBinaryAudioConfig(config: Partial<BinaryAudioProtocolConfig>): void {
    this.binaryParser.updateBinaryAudioConfig(config);
    logger.info('[ConnectionManager] 二进制音频配置已更新:', config);
  }

  /**
   * 直接解析二进制音频消息
   * @param buffer 二进制缓冲区
   * @returns 解码结果
   */
  public parseBinaryAudioMessage(buffer: ArrayBuffer): DecodingResult {
    return this.binaryParser.parseBinaryAudioMessage(buffer);
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
   * 处理混合协议消息
   * 支持同时包含控制事件和二进制音频数据的消息
   * @param data 二进制数据
   */
  private async handleMixedProtocolMessage(data: ArrayBuffer | Blob): Promise<void> {
    try {
      let buffer: ArrayBuffer;

      // 处理不同类型的二进制数据
      if (data instanceof ArrayBuffer) {
        buffer = data;
      } else if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
      } else {
        throw new Error(`不支持的数据类型: ${typeof data}`);
      }

      // 检查缓冲区是否为空
      if (buffer.byteLength === 0) {
        logger.warn(`[SDK] 收到空的混合协议数据，跳过处理`);
        return;
      }

      logger.debug(`[SDK] 开始处理混合协议消息，大小: ${buffer.byteLength} 字节`);

      // 尝试解析混合协议消息
      // 策略1：检查是否包含JSON控制事件前缀
      const uint8Array = new Uint8Array(buffer);

      // 检查是否以JSON开始（控制事件可能以JSON格式发送）
      if (uint8Array.length > 0 && uint8Array[0] === 123) { // 123 = '{' 的ASCII码
        logger.debug(`[SDK] 检测到可能的JSON控制事件，尝试解析`);

        try {
          // 尝试解析JSON部分
          const jsonText = new TextDecoder().decode(uint8Array);
          const jsonData = JSON.parse(jsonText);

          logger.info(`[SDK] 成功解析JSON控制事件:`, jsonData);

          // 检查是否是控制事件
          const messageType = jsonData.type || jsonData.payload?.type;
          if (messageType && [
            'output_audio_buffer.started',
            'output_audio_buffer.stopped',
            'response.cancel',
            'output_audio_buffer.cleared',
            'conversation.item.truncated'
          ].includes(messageType)) {

            if (['output_audio_buffer.started', 'output_audio_buffer.stopped'].includes(messageType)) {
              console.log(`[SDK] 🟢 混合协议中发现正确的音频缓冲区信令: ${messageType}`);
              console.log(`[SDK] 🟢 信令详情:`, jsonData);
            } else {
              console.log(`[SDK] 📝 混合协议中发现其他控制事件: ${messageType}`);
              console.log(`[SDK] 📝 控制事件详情:`, jsonData);
            }

            // 处理控制事件
            let actualMessage = jsonData;
            if (!messageType && jsonData.payload && jsonData.payload.type) {
              actualMessage = jsonData.payload;
              actualMessage.session_id = jsonData.session_id;
            }

            // ========== 高精度性能监控 ==========
            const latency = this.stopHighPrecisionTimer(messageType);
            if (latency !== null) {
              logger.info(`[PERF] High-precision latency for ${messageType}: ${latency.toFixed(3)}ms`);
            }

            // 发射控制事件
            this.emit(messageType, actualMessage);
            logger.info(`[SDK] 混合协议控制事件已发射: ${messageType}`);
            return;
          }
        } catch (jsonError) {
          logger.debug(`[SDK] JSON解析失败，继续尝试其他解析方式:`, jsonError);
        }
      }

      // 策略2：检查是否包含嵌入的控制事件标记
      // 某些协议可能在二进制数据中嵌入控制事件标记
      if (uint8Array.length >= 8) {
        // 检查控制事件标记（假设有特殊标记）
        const controlMarker = new DataView(uint8Array.buffer).getUint32(0, true); // 小端序
        if (controlMarker === 0x43414E43) { // "CANC" 标记
          logger.info(`[SDK] 检测到嵌入的控制事件标记`);

          // 提取控制事件数据
          const controlDataLength = new DataView(uint8Array.buffer).getUint32(4, true);
          if (uint8Array.length >= 8 + controlDataLength) {
            const controlData = uint8Array.slice(8, 8 + controlDataLength);
            const controlText = new TextDecoder().decode(controlData);

            try {
              const controlEvent = JSON.parse(controlText);
              const messageType = controlEvent.type;

              if (messageType && [
                'output_audio_buffer.started',
                'output_audio_buffer.stopped',
                'response.cancel',
                'output_audio_buffer.cleared',
                'conversation.item.truncated'
              ].includes(messageType)) {

                if (['output_audio_buffer.started', 'output_audio_buffer.stopped'].includes(messageType)) {
                  console.log(`[SDK] 🟢 嵌入式音频缓冲区信令: ${messageType}`);
                } else {
                  console.log(`[SDK] 📝 嵌入式其他控制事件: ${messageType}`);
                }

                // ========== 高精度性能监控 ==========
                const latency = this.stopHighPrecisionTimer(messageType);
                if (latency !== null) {
                  logger.info(`[PERF] High-precision latency for ${messageType}: ${latency.toFixed(3)}ms`);
                }

                // 发射控制事件
                this.emit(messageType, controlEvent);
                logger.info(`[SDK] 嵌入式控制事件已发射: ${messageType}`);

                // 如果还有音频数据，继续处理
                const audioData = uint8Array.slice(8 + controlDataLength);
                if (audioData.length > 0) {
                  logger.debug(`[SDK] 继续处理嵌入的音频数据，大小: ${audioData.length} 字节`);
                  await this.handleBinaryAudioMessage(audioData.buffer);
                }
                return;
              }
            } catch (parseError) {
              logger.debug(`[SDK] 嵌入式控制事件解析失败:`, parseError);
            }
          }
        }
      }

      // 策略3：如果都不是控制事件，回退到纯二进制音频处理
      logger.debug(`[SDK] 未检测到控制事件，回退到纯二进制音频处理`);
      await this.handleBinaryAudioMessage(buffer);

    } catch (error) {
      logger.error(`[SDK] 混合协议处理失败:`, error);
      throw error;
    }
  }

  /**
   * 处理二进制音频消息
   * @param buffer 二进制缓冲区
   */
  private async handleBinaryAudioMessage(data: ArrayBuffer | Blob): Promise<void> {
    try {
      let buffer: ArrayBuffer;

      // 处理不同类型的二进制数据
      if (data instanceof ArrayBuffer) {
        buffer = data;
        logger.debug(`[SDK] 收到 ArrayBuffer 类型数据，大小: ${buffer.byteLength} 字节`);
      } else if (data instanceof Blob) {
        // 将 Blob 转换为 ArrayBuffer
        buffer = await data.arrayBuffer();
        logger.debug(`[SDK] 收到 Blob 类型数据，转换后大小: ${buffer.byteLength} 字节`);
      } else {
        logger.error(`[SDK] 不支持的数据类型: ${typeof data}`);
        this.emit('binary_audio_error', {
          type: 'binary_audio_error',
          error: `不支持的数据类型: ${typeof data}`,
          bufferSize: undefined
        });
        return;
      }

      // 检查缓冲区是否为空
      if (buffer.byteLength === 0) {
        logger.warn(`[SDK] 收到空的二进制数据，跳过处理`);
        return;
      }

      logger.debug(`[SDK] 开始处理二进制音频消息，大小: ${buffer.byteLength} 字节`);

      // 使用新的二进制解码器
      const decodedAudio: DecodedAudioDeltaMessage = decodeResponseAudioDeltaMessage(buffer);

      logger.debug(`[SDK] 二进制音频解码成功:`, {
        responseId: decodedAudio.responseId,
        itemId: decodedAudio.itemId,
        outputIndex: decodedAudio.outputIndex,
        contentIndex: decodedAudio.contentIndex,
        audioDataSize: decodedAudio.audioData.length
      });

      // ========== 高精度性能监控 - 二进制音频延迟计算 ==========
      // 停止 binary_audio_delta 事件的计时器（优先方案）
      const latency = this.stopHighPrecisionTimer('binary_audio_delta');
      if (latency !== null) {
        logger.info(`[PERF] High-precision latency for binary_audio_delta: ${latency.toFixed(3)}ms`);
      }

      // 性能优化：移除频繁的调试日志
      this.emit('binary_audio_delta', {
        type: 'binary_audio_delta',
        responseId: decodedAudio.responseId,
        itemId: decodedAudio.itemId,
        outputIndex: decodedAudio.outputIndex,
        contentIndex: decodedAudio.contentIndex,
        audioData: decodedAudio.audioData
      });

    } catch (error) {
      logger.error(`[SDK] 二进制音频解码失败:`, error);

      // 发射错误事件
      this.emit('binary_audio_error', {
        type: 'binary_audio_error',
        error: error instanceof Error ? error.message : String(error),
        bufferSize: data instanceof ArrayBuffer ? data.byteLength :
          data instanceof Blob ? data.size : undefined
      });
    }
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