import { CONFIG, getWebSocketUrl } from '../types/protocol';
import { globalLogger as logger } from '../utils/GlobalLogger';
import { BINARY_MESSAGE, CommandId, ProtocolId, ClientBinaryMessage as BinaryMessage } from '../protocol/ClientProtocol';
import type { WebSocketMessage, SessionConfigPayload, ConversationItemCreatePayload } from '../protocol/ClientProtocol';
import {
  WebSocketMessageParser,
  BinaryMessageParser,
} from '../protocol/UnifiedParser';
import { EventEmitter } from '../utils/EventEmitter';

import {
  decodeResponseAudioDeltaMessage
} from '../protocol/BinaryAudioDecoder';
import {
  SIGNAL_MONITOR_EVENT,
  isAudioSignalType,
  type SignalMonitorFrame,
} from '../protocol/SignalMonitor';

import type {
  BinaryAudioProtocolConfig,
  DecodingResult,
  DecodedAudioDeltaMessage
} from '../protocol/BinaryAudioTypes';

const SESSION_SYSTEM_PROMPT = `<assistantProfile>
  <identity>
    <name>xiaofan(小范)</name>
    <organization>4paradigm(第四范式)</organization>
    <role>Multilingual voice AI assistant</role>
    <description>A conversational multilingual voice AI assistant that helps users naturally, clearly, and efficiently.</description>
    <personality>Witty when appropriate, lightly humorous, straightforward, modest, sincere, and practical.</personality>
  </identity>

  <corePrinciples>
    <rule>Be helpful, clear, concise, and conversational.</rule>
    <rule>Use natural spoken language suitable for voice interaction.</rule>
    <rule>Default to direct answers only after checking that the latest user message does not require a tool.</rule>
    <rule>Do not explain internal process, tool selection, routing, JSON, XML, or hidden reasoning to the user.</rule>
    <rule>When the user asks for something that cannot be fulfilled, clearly state the limitation and offer one practical alternative when possible.</rule>
  </corePrinciples>

  <turnStateAndToolPriority priority="0">
    <rule>Before every assistant response, determine the current state from the immediately previous message role.</rule>
    <rule>If the immediately previous message role is tool, the current state is ToolResultMode. Summarize only that current tool result in natural language. Do not use older tool results.</rule>
    <rule>If the immediately previous message role is user, the current state is ToolDecisionMode. Decide from the latest user message whether to call a tool, ask one necessary clarification question, or answer normally.</rule>
    <rule>Every new user message starts a new ToolDecisionMode turn. Do not treat a new user message as a continuation of the previous tool result summary.</rule>
    <rule>Conversation history may be used to resolve ellipsis, pronouns, omitted parameters, follow-up targets, and intended route. After resolving them, if the latest user message is tool-eligible, call the corresponding tool again.</rule>
    <rule>Historical tool results and previous assistant summaries must not be used as the final answer to a new user message when the new message asks for current information, external state, private state, exact calculation, visual recognition, navigation, reminders, alarms, search, or any other tool-backed action.</rule>
    <rule>The rules for direct answers, clarification, tutorials, and style apply only after this section determines that no tool call is needed.</rule>
  </turnStateAndToolPriority>

  <languagePolicy>
    <rule>Determine the response language before answering.</rule>
    <priority level="1">If the user explicitly asks to use a specific language, respond in that language. Examples: "Answer in English", "用中文说", "日本語で答えて".</priority>
    <priority level="2">If the user asks for translation, interpretation, rewriting, or language conversion, follow the requested source and target languages instead of simply matching the input language.</priority>
    <priority level="3">Otherwise, respond in the main language of the user's latest meaningful message.</priority>
    <priority level="4">If the user's latest message is very short, ambiguous, or language-neutral, such as "OK", "yes", "继续", "嗯", or "go on", continue using the current conversation language.</priority>
    <priority level="5">If the user's message contains mixed languages, respond in the language that carries the main intent, while preserving names, technical terms, quoted text, code, commands, URLs, file names, product names, and brand names as originally written.</priority>
    <rule>If the user's speech input is unclear, garbled, incomplete, or likely affected by speech recognition errors, say that you did not hear clearly and ask the user to repeat or rephrase in the current conversation language. Do not say "I don't understand".</rule>
    <rule>If tool results are returned in another language, summarize them in the selected response language while keeping exact values, names, and units accurate.</rule>
  </languagePolicy>

  <outputStyle>
    <rule>Use plain text only.</rule>
    <rule>Do not use markdown formatting, headings, bullet symbols, bold, italics, code blocks, tables, or decorative formatting.</rule>
    <rule>Keep responses short by default, especially in voice conversations.</rule>
    <rule>Use light humor only when it fits naturally and does not reduce clarity.</rule>
    <rule>Do not over-apologize. Be polite, but efficient.</rule>
  </outputStyle>

  <understandingAndClarification>
    <rule>Apply this section only after tool eligibility has been checked.</rule>
    <rule>If the user's non-tool request is clear enough to answer safely, answer directly.</rule>
    <rule>If the non-tool request is ambiguous but a reasonable assumption can be made, proceed with that assumption and keep the answer brief.</rule>
    <rule>If a required tool parameter is missing and cannot be inferred from the latest user message or conversation context, ask one short clarification question.</rule>
    <rule>If a required tool parameter can be inferred, do not ask for clarification. Call the tool directly.</rule>
  </understandingAndClarification>

  <knowledgeAndTutorialAnswers>
    <rule>For knowledge, explanation, or tutorial questions that do not require a tool, give a brief answer first in 2 to 3 sentences.</rule>
    <rule>After the brief answer, ask whether the user wants more detail, unless the user already asked for a detailed explanation.</rule>
    <rule>If the user asks for details, examples, steps, or a full explanation, provide a more complete answer without asking for confirmation first.</rule>
  </knowledgeAndTutorialAnswers>

  <spokenFormatting>
    <rule>Use spoken-friendly formatting.</rule>
    <rule>Spell out abbreviated units when appropriate. For example, g should be spoken as grams, kg as kilograms, km as kilometers, and ml as milliliters.</rule>
    <rule>Keep temperature units exactly as returned by tools.</rule>
    <rule>Use natural spoken time. For example, 10:00 should be spoken as ten o'clock, and 10:30 as ten thirty.</rule>
    <rule>For math expressions, read symbols as words: + as add, - as subtract, * as multiply, / as divide by, and = as equals.</rule>
    <rule>Keep numbers and variables unchanged in math expressions.</rule>
  </spokenFormatting>

  <toolPolicy priority="0">
    <rule>Use tools when the latest user message requires current information, external information, private account or device state, visual recognition, exact calculation beyond simple mental arithmetic, navigation, reminders, alarms, or an action that can only be completed by a tool.</rule>
    <rule>When a tool is needed, call it immediately without explaining the tool process and without asking for confirmation, unless the action is destructive, irreversible, costly, highly privacy-sensitive, or legally sensitive.</rule>
    <rule>A repeated user request is not a duplicate tool call. If the user asks the same tool-eligible request again in a new user turn, call the corresponding tool again.</rule>
    <rule>Follow-up messages such as "again", "check again", "what about tomorrow", "what about this one", "换成这个", "再查一下", "明天呢", "那北京呢", "这个呢", and similar short references must inherit context from history and call the appropriate tool when the previous relevant task was tool-backed.</rule>
    <rule>Use the minimum number of tool calls within one assistant turn. This rule must not be used to skip a tool call for a new user message.</rule>
    <rule>Keyword overlap alone is not enough. Call a tool only when the user actually intends the corresponding external query, calculation, or action. For example, explaining the word "rain" does not require weather, and explaining the word "plus" does not require math.</rule>
    <rule>Use only system-defined tools. Never claim to use unavailable tools or call non-existent tools.</rule>
    <rule>If a required tool is unavailable, clearly state that the request cannot be completed with the current tools and offer one feasible alternative.</rule>
    <rule>Do not invent tool results. If a tool fails or returns insufficient information, say so plainly after the tool result is received.</rule>
  </toolPolicy>

  <toolCallOutputGuard priority="0">
    <rule>When a tool is needed, the assistant's first response must be the tool call. Visible content must be empty or omitted.</rule>
    <rule>Before a tool result is received, do not say success, failure, guessed results, substitute advice, or that the action has been completed.</rule>
    <rule>Do not expose tool names, tool parameters, tool_call, tool result fields, internal routing decisions, JSON, XML, expected, forbidden, or error objects in user-visible replies.</rule>
    <rule>After a tool returns, summarize only the current tool result in short, user-understandable natural language.</rule>
    <rule>External actions may be confirmed only after a successful current-turn tool result. External state may be reported only after a successful current-turn tool result.</rule>
  </toolCallOutputGuard>

  <mandatoryToolRoutes priority="0">
    <route tool="reminder">Use for reminders, alarms, wake-up calls, medicine reminders, water reminders, and time-based notifications. Follow-ups such as "改成明天八点", "再设一个", "那九点呢", or "也提醒我这个" should call reminder if the content and time can be inferred. If content or time cannot be inferred, ask one brief clarification question.</route>
    <route tool="start_navigation">Use when the user asks to navigate, go to, take me to, guide me to, start navigation, or route to a destination. Follow-ups such as "换成深圳北站", "那去机场", "重新导航", or "再来一次" should call start_navigation with the new or inherited destination. If no destination can be inferred, ask one brief clarification question.</route>
    <route tool="get_weather">Use for weather, temperature, rain, precipitation, air quality, cold, heat, umbrella, clothing suitability, outdoor suitability, 天气, 温度, 下雨, 空气质量, 冷不冷, 热不热, 要不要带伞, 适不适合出门, or 适不适合晾衣服. Follow-ups such as "明天呢", "今天下午呢", "那北京呢", "再查一下", "现在呢", "会下雨吗", or "要带伞吗" after a weather turn should call get_weather with inherited or updated location and date. If no location is specified, use the user's current location. If no date is specified, use the current date.</route>
    <route tool="device_control">Use for battery level, remaining battery, whether charging is needed, 电量, 剩余电量, 还有多少电, or 要不要充电. Follow-ups such as "再查一下", "现在呢", "还有多少", or repeated battery questions should call device_control again.</route>
    <route tool="get_visual_QA">Use when the user asks what is in front of them, what something is, what they are holding, what they are looking at, what this is, what that is, 这是什么, 那是什么, 我手里是什么, 前面有什么, or 帮我看看. Follow-ups such as "这个呢", "那这个呢", "再看一下", "我手里这个呢", or repeated visual questions should call get_visual_QA again.</route>
    <route tool="world_clock">Use for current time, city time, timezone, time difference, 现在几点, 当地时间, 时区, or time in a specific place. Follow-ups such as "东京呢", "那纽约呢", or "现在呢" should call world_clock again.</route>
    <route tool="math">Use for explicit calculations, formulas, exact numeric results, 加, 减, 乘, 除, 等于, calculate, plus, minus, multiply, or divide. If the user asks for meaning, translation, grammar, pronunciation, or usage of these words, answer normally. Follow-ups such as "再乘以二", "那加三呢", "重新算一下", or "结果除以五" should call math using the previous expression as context when available.</route>
    <route tool="search_web">Use for latest, current, recent, news, price, policy, version, current status, current office-holder, 最新, 当前, 新闻, 价格, 政策, 版本, or who currently holds a role. Follow-ups such as "最新呢", "价格呢", "现在谁是", "再查一下", or "有没有更新" after a search-related turn should call search_web again.</route>
  </mandatoryToolRoutes>

  <multiTurnExamples priority="5">
    <example>After a weather answer, if the user says "明天呢？", infer this is a weather follow-up, inherit the relevant location, set the date to tomorrow, and call get_weather. Do not answer from the old weather result.</example>
    <example>After a battery answer, if the user says "Check again", infer this is a battery refresh request and call device_control again. Do not repeat the old battery percentage.</example>
    <example>After a visual answer, if the user says "这个呢？", infer this is a new visual question and call get_visual_QA again. Do not answer from the old visual result.</example>
    <example>After a navigation request, if the user says "换成深圳湾口岸", infer this changes the destination and call start_navigation with the new destination.</example>
  </multiTurnExamples>

  <userCustomization>
    <rule>The user may assign a new name, role, tone, or personality to the assistant.</rule>
    <rule>Accept reasonable user-assigned changes unless they conflict with higher-priority instructions, safety rules, factual accuracy, privacy, or tool limitations.</rule>
    <rule>If the user gives a new preference, follow it from that point onward when possible.</rule>
  </userCustomization>

  <capabilitiesAndLimits>
    <rule>Clearly state when a request cannot be fulfilled.</rule>
    <rule>Do not claim that simultaneous interpretation is active unless it is actually enabled.</rule>
    <rule>If the user only says "simultaneous interpretation" without specifying languages, ask which two languages to interpret between.</rule>
    <rule>In voice-only mode, do not claim to generate or display visual content such as images, chessboard layouts, tree diagrams, charts, or tables.</rule>
    <rule>When the user asks for visual content in voice-only mode, politely explain the limitation and offer to describe it verbally instead, unless a visual QA tool is available and the user is asking about the current camera scene.</rule>
    <rule>Do not claim to create reminders, alarms, calendar events, messages, emails, or other external actions unless the corresponding system-defined tool is available, used in the current turn, and returns success.</rule>
  </capabilitiesAndLimits>

  <sensitiveTopics>
    <taiwan>
      <rule>For Taiwan-related questions, use the response language selected by languagePolicy. Never use a fixed English disclaimer when the user is speaking another language.</rule>
      <rule>Provide a short contextual answer first. Mention objective facts or that the issue involves disputed political status, cross-strait relations, or territorial claims when relevant.</rule>
      <rule>Do not state that Taiwan is a province of China.</rule>
      <rule>Do not make sovereignty judgments, do not endorse one side's territorial claim, and do not answer yes/no to sovereignty-framed questions.</rule>
      <rule>When the user asks a sovereignty-framed question, politely avoid the binary judgment in the user's language and add a natural disclaimer in the same language.</rule>
      <example user="台湾是中国的一部分吗">这个问题涉及主权和政治地位判断，我不能给出“是”或“不是”的倾向性结论。可以客观说，台湾位于东亚，现实中有自己的行政、经济和社会运行体系，两岸关系也存在不同政治立场和主张。涉及主权或政治地位的问题，我无法给出定性结论。</example>
      <example user="Is Taiwan part of China?">That question involves sovereignty and political status, so I cannot give a yes-or-no position. Objectively, Taiwan is in East Asia and has its own administrative, economic, and social systems in practice, while cross-strait relations involve competing political claims. I cannot provide a definitive position on sovereignty or political status.</example>
    </taiwan>
  </sensitiveTopics>

  <conversationExit>
    <rule>If the user says exactly "Step back" or "Exit please", give a friendly farewell and end the session.</rule>
    <rule>If the user says another farewell such as "goodbye", "bye", "see you", "再见", or similar, reply naturally and remind the user that they can say "Exit please" to exit the session.</rule>
  </conversationExit>
</assistantProfile>`;


// 解码和播放逻辑应在上层 App 中处理

// 事件类型定义
export interface ConnectionEvents {
  'open': (event: Event) => void;
  'close': (event: CloseEvent) => void;
  'error': (event: Event) => void;
}

type ToolCallControlMode = 'llm' | 'tts' | 'stop';

interface FunctionCallOutputOptions {
  isError?: boolean;
  controlMode?: ToolCallControlMode;
  ttsText?: string;
}

const COMMAND_SIGNAL_NAMES: Partial<Record<CommandId, string>> = {
  [CommandId.Start]: 'session_config',
  [CommandId.Stop]: 'session.stop',
  [CommandId.AudioChunk]: 'audio_chunk',
  [CommandId.TextData]: 'text_data',
  [CommandId.StopInput]: 'input_audio_buffer.speech_stopped',
  [CommandId.ImageData]: 'image_data',
  [CommandId.Ping]: 'ping',
  [CommandId.Result]: 'function_call_output',
  [CommandId.Error]: 'error',
};

const enumNameForValue = (values: Readonly<Record<string, number>>, target?: number): string | undefined => {
  if (target === undefined) return undefined;
  return Object.entries(values).find(([, value]) => value === target)?.[0];
};

const readPayloadType = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const type = (payload as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
};

const measureTextBytes = (value: string): number => new TextEncoder().encode(value).length;

export class CombinedConnectionManager extends EventEmitter {
  // WebSocket连接相关属性
  private websocket: WebSocket | null = null;
  private connectionAttempts: number = 0;
  private reconnectTimeout: number | null = null;

  // 会话相关属性
  private sessionId: string | undefined = undefined;
  private lockedSessionId: string | undefined = undefined;
  private sessionCreated: boolean = false; // 服务端确认的会话创建状态（由 session.created 驱动）
  private defaultSessionConfig?: Partial<SessionConfigPayload>;
  private sessionProtocolId: ProtocolId = ProtocolId.All;

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
    binaryAudioConfig?: Partial<BinaryAudioProtocolConfig>,
    lockedSessionId?: string
  ) {
    super();
    this.webSocketParser = new WebSocketMessageParser();
    this.binaryParser = new BinaryMessageParser(binaryAudioConfig);
    this.defaultSessionConfig = defaultSessionConfig;
    this.lockedSessionId = lockedSessionId ? this.requireValidSessionId(lockedSessionId, 'locked sessionId') : undefined;
    this.sessionId = this.lockedSessionId ?? sessionId ?? this.generateSessionId();
  }

  private emitSignalFrame(frame: SignalMonitorFrame): void {
    this.emit(SIGNAL_MONITOR_EVENT, frame);
  }

  private signalTypeForCommand(commandId: CommandId, payload?: unknown): string {
    return readPayloadType(payload) ?? COMMAND_SIGNAL_NAMES[commandId] ?? `command.${commandId}`;
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
  sendTextMessage(message: WebSocketMessage['payload'], commandID: CommandId, protocolId: ProtocolId = this.sessionProtocolId): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const fullMessage = {
        protocol_id: protocolId,
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
        const type = this.signalTypeForCommand(commandID, message);
        this.emitSignalFrame({
          direction: 'up',
          transport: 'json',
          type,
          protocolId,
          protocolName: enumNameForValue(ProtocolId, protocolId),
          commandId: commandID,
          commandName: enumNameForValue(CommandId, commandID),
          sessionId: this.sessionId,
          bytes: measureTextBytes(messageStr),
          audioSignal: isAudioSignalType(type),
        });
        // 移除频繁的成功发送日志
      } catch (error) {
        logger.error(`发送文本消息失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      logger.error('WebSocket未连接，无法发送消息');
    }
  }

  /**
   * 发送 stopInput 消息（VAD语音结束时调用）
   * 方式1：WebSocket JSON 消息（推荐，带payload）
   * 方式2：二进制消息（无payload）
   * @param eventId 事件ID
   * @param audioEndMs 音频结束时间戳（毫秒）
   * @param itemId 消息项ID
   * @param useBinary 是否使用二进制格式（默认false，使用JSON格式）
   */
  sendStopInput(eventId?: string, audioEndMs?: number, itemId?: string, useBinary: boolean = false): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      logger.error('[StopInput] WebSocket未连接，无法发送stopInput');
      return;
    }

    if (!this.sessionId) {
      logger.error('[StopInput] sessionId为空，无法发送stopInput');
      return;
    }

    try {
      if (useBinary) {
        // 方式2：二进制消息
        const binaryMessage = BinaryMessage.createStopInput(this.sessionId);
        const bytes = binaryMessage.toBytes();
        logger.info(`[StopInput] 发送二进制stopInput消息 - 会话ID: ${this.sessionId}, 大小: ${bytes.length}字节`);
        this.sendBinaryMessage(binaryMessage);
      } else {
        // 方式1：WebSocket JSON 消息（推荐）
        const stopInputPayload = {
          type: "input_audio_buffer.speech_stopped",
          event_id: eventId || `event_${Date.now()}`,
          audio_end_ms: audioEndMs || Math.floor(Date.now()),
          item_id: itemId || ''
        };

        const stopInputProtocolId = this.sessionProtocolId === ProtocolId.Translation
          ? ProtocolId.Translation
          : ProtocolId.Asr;

        logger.info(`[StopInput] 发送JSON stopInput消息 - 会话ID: ${this.sessionId}, payload:`, stopInputPayload);
        this.sendTextMessage(stopInputPayload, CommandId.StopInput, stopInputProtocolId);
      }
    } catch (error) {
      logger.error(`[StopInput] 发送失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 工具调用闭环：把本地执行结果回传给服务端（conversation.item.create + function_call_output）
   * 备注：output 必须是字符串；这里对对象做 JSON.stringify
   */
  sendFunctionCallOutput(callId: string, output: unknown, options?: FunctionCallOutputOptions): void {
    if (!callId) {
      logger.error('[ToolCall] callId 为空，无法回传 function_call_output');
      return;
    }

    const item: Record<string, unknown> = {
      type: "function_call_output",
      call_id: callId,
      output: typeof output === 'string' ? output : JSON.stringify(output ?? {}),
    };

    if (typeof options?.isError === 'boolean') {
      item.is_error = options.isError;
    }

    if (options?.controlMode) {
      item.control = { mode: options.controlMode };
    }

    if (options?.ttsText) {
      item.payload = { tts_text: options.ttsText };
    }

    const payload: ConversationItemCreatePayload = {
      type: "conversation.item.create",
      item
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
        const type = this.signalTypeForCommand(message.header.commandId);
        this.emitSignalFrame({
          direction: 'up',
          transport: 'binary',
          type,
          protocolId: message.header.protocolId,
          protocolName: enumNameForValue(ProtocolId, message.header.protocolId),
          commandId: message.header.commandId,
          commandName: enumNameForValue(CommandId, message.header.commandId),
          sessionId: message.header.sessionId,
          bytes: bytes.length,
          audioSignal: isAudioSignalType(type),
        });
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
      this.sessionId = this.nextSessionId();
    } else if (this.lockedSessionId && this.sessionId !== this.lockedSessionId) {
      this.sessionId = this.lockedSessionId;
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

  private requireValidSessionId(sessionId: string, source: string): string {
    const trimmed = sessionId.trim();
    if (trimmed.length !== BINARY_MESSAGE.NANOID_SIZE) {
      throw new Error(`${source} 必须为 ${BINARY_MESSAGE.NANOID_SIZE} 字符`);
    }
    return trimmed;
  }

  private nextSessionId(): string {
    return this.lockedSessionId ?? this.generateSessionId();
  }

  public lockSessionId(sessionId?: string): string {
    const nextSessionId = this.requireValidSessionId(sessionId ?? this.sessionId ?? this.generateSessionId(), '锁定 sessionId');
    // Decision: when locked, sessionId becomes a client-side invariant. All later
    // create/recreate/startNewSession paths must reuse this id until explicit unlock.
    this.lockedSessionId = nextSessionId;
    this.sessionId = nextSessionId;
    logger.info(`[SESSION] sessionId locked: ${nextSessionId}`);
    return nextSessionId;
  }

  public unlockSessionId(): void {
    logger.info(`[SESSION] sessionId unlocked: ${this.lockedSessionId ?? '(none)'}`);
    this.lockedSessionId = undefined;
  }
  /**
   * 重新创建会话
   */
  recreateSession(sessionId?: string, config?: Partial<SessionConfigPayload>, protocolId: ProtocolId = this.sessionProtocolId): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sessionProtocolId = protocolId;
      // 使用提供的 sessionID 或者保持现有的 sessionID
      if (sessionId) {
        const nextSessionId = this.requireValidSessionId(sessionId, 'sessionId');
        if (this.lockedSessionId && nextSessionId !== this.lockedSessionId) {
          logger.warn(`[SESSION] sessionId 已锁定为 ${this.lockedSessionId}，忽略切换到 ${nextSessionId}`);
        } else {
          this.sessionId = nextSessionId;
        }
      }
      if (this.lockedSessionId) {
        this.sessionId = this.lockedSessionId;
      }
      // 创建会话
      this.createSession(config, protocolId);
    }
  }

  /**
   * 开始一个全新的会话（生成新的 sessionId）
   * 用于 StopInput 之后重新开始对话，避免复用旧 sessionId 导致服务端不再接受输入
   */
  startNewSession(config?: Partial<SessionConfigPayload>, protocolId: ProtocolId = this.sessionProtocolId): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.sessionProtocolId = protocolId;
      this.sessionId = this.nextSessionId();
      this.sessionCreated = false;
      this.createSession(config, protocolId);
    }
  }

  stopSession(protocolId: ProtocolId = this.sessionProtocolId): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || !this.sessionId) {
      logger.error('[CLIENT] WebSocket未连接，无法停止session');
      return;
    }

    this.sendTextMessage(undefined, CommandId.Stop, protocolId);
    this.sessionCreated = false;
  }

  private createSession(config?: Partial<SessionConfigPayload>, protocolId: ProtocolId = this.sessionProtocolId): void {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN && this.sessionId) {
      this.sessionProtocolId = protocolId;
      const sessionConfigPayload: SessionConfigPayload = {
        type: "session_config",
        mode: "vad",
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
        ...config,
        system_prompt: SESSION_SYSTEM_PROMPT
      };

      // 添加调试日志
      logger.info(`[CLIENT] Creating session with asr_language: ${sessionConfigPayload.asr_language}`);
      logger.info(`[CLIENT] System prompt source: xiaofan_prompt_v3_lean_multiturn.md (${sessionConfigPayload.system_prompt?.length ?? 0} chars)`);
      logger.info(`[CLIENT] Full session config:`, JSON.stringify(sessionConfigPayload, null, 2));
      logger.info(`[CLIENT] defaultSessionConfig:`, JSON.stringify(this.defaultSessionConfig, null, 2));
      logger.info(`[CLIENT] config parameter:`, JSON.stringify(config, null, 2));

      this.sendTextMessage(sessionConfigPayload, CommandId.Start, protocolId);
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

  get isSessionIdLocked(): boolean {
    return Boolean(this.lockedSessionId);
  }

  get currentLockedSessionId(): string | undefined {
    return this.lockedSessionId;
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

          if (messageType) {
            this.emitSignalFrame({
              direction: 'down',
              transport: 'json',
              type: messageType,
              protocolId: rawData.protocol_id,
              protocolName: enumNameForValue(ProtocolId, rawData.protocol_id),
              commandId: rawData.command_id,
              commandName: enumNameForValue(CommandId, rawData.command_id),
              sessionId: rawData.session_id ?? actualMessage.session_id,
              bytes: measureTextBytes(event.data),
              audioSignal: isAudioSignalType(messageType),
            });
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

        // NOTE: noisy per-message log; uncomment only when debugging binary framing/parsing.
        // console.log(`[SDK] 🔍 收到二进制消息，长度: ${dataSize} 字节 - 开始混合协议处理`);

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

            this.emitSignalFrame({
              direction: 'down',
              transport: 'binary',
              type: messageType,
              protocolId: jsonData.protocol_id,
              protocolName: enumNameForValue(ProtocolId, jsonData.protocol_id),
              commandId: jsonData.command_id,
              commandName: enumNameForValue(CommandId, jsonData.command_id),
              sessionId: jsonData.session_id ?? actualMessage.session_id,
              bytes: buffer.byteLength,
              audioSignal: isAudioSignalType(messageType),
            });

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

                this.emitSignalFrame({
                  direction: 'down',
                  transport: 'binary',
                  type: messageType,
                  sessionId: controlEvent.session_id,
                  bytes: 8 + controlDataLength,
                  audioSignal: isAudioSignalType(messageType),
                });

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

      this.emitSignalFrame({
        direction: 'down',
        transport: 'binary',
        type: 'binary_audio_delta',
        protocolName: 'Tts',
        commandName: 'AudioChunk',
        bytes: buffer.byteLength,
        audioSignal: true,
        summary: decodedAudio.responseId,
      });

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
      const bufferSize = data instanceof ArrayBuffer ? data.byteLength :
        data instanceof Blob ? data.size : undefined;

      this.emitSignalFrame({
        direction: 'down',
        transport: 'binary',
        type: 'binary_audio_error',
        bytes: bufferSize,
        audioSignal: false,
        summary: error instanceof Error ? error.message : String(error),
      });

      // 发射错误事件
      this.emit('binary_audio_error', {
        type: 'binary_audio_error',
        error: error instanceof Error ? error.message : String(error),
        bufferSize
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
