/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import styles from './App.module.scss'
import { RealTime } from './RealTime'
import { ProtocolId, type AudioChunkPayload, type ResponseAudioDeltaEvent, type ResponseTextDeltaEvent, type ResponseTextDoneEvent } from './sdk/protocol/ClientProtocol';
import { AudioPlayer } from './sdk/audio/AudioPlayer';
import { base64ToUint8Array } from './sdk/audio/AudioUtils';

import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { useReminderHandler } from './hooks/useReminderHandler';
import { useCameraHandler } from './hooks/useCameraHandler';
import { useImageSender } from './hooks/useImageSender';
import { useToolCallHandler } from './hooks/useToolCallHandler';
import { useRuntimeControls } from './hooks/useRuntimeControls';
import { useSessionStatus } from './hooks/useSessionStatus';
import { useDownstreamAudioPlayer } from './hooks/useDownstreamAudioPlayer';
import { useLocalVadUplink } from './hooks/useLocalVadUplink';
import { ReminderPanel } from './components/ReminderPanel';
import { ImageResponsePanel } from './components/ImageResponsePanel';
import { PerformanceMonitor } from './components/PerformanceMonitor';
import { VoiceStage } from './components/VoiceStage';
import { WebSocketSessionControls } from './components/WebSocketSessionControls';
import { SimulMeetingTestPanel } from './components/SimulMeetingTestPanel';
import { SignalSidebar, type SignalSidebarRow } from './components/SignalSidebar';
import {
  WS_PRESETS,
  createEmptyResponseMetrics,
  type ResponseMetrics,
} from './app/architectureDecisions';
import { decodeDownstreamAudio } from './app/downstreamAudio';
import {
  SIGNAL_MONITOR_EVENT,
  SIGNAL_SIDEBAR_MAX_ROWS,
  type SignalMonitorFrame,
} from './sdk/protocol/SignalMonitor';

// 定义下行事件常量（参考 ClientProtocol.ts 中的服务端事件）
const downstreamEvents = [
  'session.created',
  'conversation.item.created',
  'conversation.item.updated',
  'input_audio_buffer.speech_started',
  'input_audio_buffer.speech_stopped',
  'conversation.item.input_audio_transcription.delta',
  'conversation.item.input_audio_transcription.completed',
  'response.created',
  'response.text.delta',
  'response.text.done',
  'response.text.speculative',
  'response.audio.delta',
  'response.audio.done',
  'response.output_item.added',
  'response.output_item.done',
  'response.done',
  'conversation.item.truncated',
  'output_audio_buffer.started',
  'output_audio_buffer.stopped',
  'error.event',
  'output_audio_buffer.cleared',
  'conversation.item.input_audio_transcription.failed',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.function_call_result.done',
  'session.update',
  'response.cancel',
  'response.function_call.delta',
  'response.function_call.done',
  'response.function_call_result.delta',
  'response.language_detected',
  'llm_summary',
  // 新的二进制音频事件
  'binary_audio_delta',
  'binary_audio_error'
] as const;

type PipelineMode = 'dialogue' | 'interpret' | 'meeting';

const PIPELINE_OPTIONS: Array<{ mode: PipelineMode; label: string }> = [
  { mode: 'dialogue', label: '对话' },
  { mode: 'interpret', label: '同传' },
  { mode: 'meeting', label: '会议' },
];

export const App = () => {
  const [isImageUploadSectionExpanded, setIsImageUploadSectionExpanded] = useState(false); // 默认展示响应显示
  const [isSignalSidebarCollapsed, setIsSignalSidebarCollapsed] = useState(false);
  const [signalRows, setSignalRows] = useState<SignalSidebarRow[]>([]);
  const signalRowSeqRef = useRef(0);
  // 展示下行文本（WS返回的文本）
  const [currentText, setCurrentText] = useState('');
  const [finalTexts, setFinalTexts] = useState<string[]>([]);

  const realTime = useRef<RealTime>()

  // Reminder 处理 Hook
  const { handleReminderCall } = useReminderHandler();

  // Camera 处理 Hook
  const { openCamera, closeCamera } = useCameraHandler();
  const {
    handleCancelImage,
    handleImageSelect,
    handleSendImage,
    imagePreview,
    imagePrompt,
    isImageUploading,
    selectedImage,
    setImagePrompt,
    setPendingVisualQa,
  } = useImageSender({ realTimeRef: realTime });
  const { handleToolCallEvent } = useToolCallHandler({
    handleReminderCall,
    openCamera,
    realTimeRef: realTime,
    setPendingVisualQa,
  });
  const handleToolCallEventRef = useRef(handleToolCallEvent);
  const closeCameraRef = useRef(closeCamera);

  useLayoutEffect(() => {
    // Decision: the runtime event bridge is registered once, but the feature
    // handlers it calls are allowed to evolve as UI state changes.
    handleToolCallEventRef.current = handleToolCallEvent;
    closeCameraRef.current = closeCamera;
  }, [closeCamera, handleToolCallEvent]);

  useEffect(() => {
    realTime.current = new RealTime()

    // 页面打开时预加载 VAD 模型，避免用户点击时等待 WASM 加载
    const preloadVADModel = async () => {
      try {
        console.log('[APP] 页面打开，预加载 VAD 模型...');
        const audioManager = realTime.current?.getAudioManager();
        if (audioManager) {
          await audioManager.preloadModel();
          console.log('[APP] VAD 模型预加载完成');
        }
      } catch (error) {
        console.error('[APP] VAD 模型预加载失败:', error);
        // 预加载失败不阻塞，后续按需加载
      }
    };

    preloadVADModel();
  }, [])
  const { currentSessionId, sessionStatus } = useSessionStatus({ realTimeRef: realTime });

  // 响应速度监控相关状态
  const [responseMetrics, setResponseMetrics] = useState<ResponseMetrics>(createEmptyResponseMetrics);


  // 性能监控开关状态
  const [isPerformanceMonitorEnabled, setIsPerformanceMonitorEnabled] = useState(true);

  // 用于跟踪请求时间的 Ref
  const speechStartTimeRef = useRef<number | null>(null);
  const hasRecordedResponse = useRef<boolean>(false);
  
  // 用于在useEffect中访问最新状态的ref
  const isPerformanceMonitorEnabledRef = useRef(isPerformanceMonitorEnabled);

  // 使用useLayoutEffect更新ref值，避免重渲染
  useLayoutEffect(() => {
    isPerformanceMonitorEnabledRef.current = isPerformanceMonitorEnabled;
  }, [isPerformanceMonitorEnabled]);

  const resetPerformanceMonitor = useCallback((reason: string) => {
    console.log(`[PERF MONITOR] reset (${reason})`);

    setResponseMetrics(createEmptyResponseMetrics());

    speechStartTimeRef.current = null;
    hasRecordedResponse.current = false;

    const voiceChatCore = realTime.current?.getVoiceChatCore();
    const connectionManager = voiceChatCore?.getConnectionManager();
    connectionManager?.clearPerformanceMetrics?.();
  }, []);

  const {
    applySessionId,
    applyVoicePreset,
    applyWebSocketUrl,
    isSessionIdLocked,
    isSwitchingWs,
    sessionIdInput,
    setSessionIdLock,
    setSessionIdInput,
    setWsInput,
    setWsPresetId,
    voicePreset,
    wsInput,
    wsPresetId,
    wsUrl,
  } = useRuntimeControls({ realTimeRef: realTime, resetPerformanceMonitor });

  // 切换性能监控状态
  const togglePerformanceMonitor = useCallback(() => {
    setIsPerformanceMonitorEnabled(prev => {
      const newState = !prev;

      if (newState) {
        console.log('[PERF MONITOR] 性能监控已启用');
      } else {
        console.log('[PERF MONITOR] 性能监控已禁用，清理数据...');
        resetPerformanceMonitor('disabled');
      }

      return newState;
    });
  }, [resetPerformanceMonitor]);

  const {
    audioPlayerRef,
    enableDownstreamAudioPlayback,
    isPlayingDownstreamAudio,
    isPlayingDownstreamAudioRef,
    toggleDownstreamAudioPlayback,
  } = useDownstreamAudioPlayer();

  // 性能监控显示控制
  const [isPerformanceMonitorVisible, setIsPerformanceMonitorVisible] = useState(true);
  const { isUserSpeaking, record, talkHint } = useLocalVadUplink({ realTimeRef: realTime });
  const [pipelineMode, setPipelineMode] = useState<PipelineMode>('dialogue');

  const switchPipelineMode = useCallback((nextMode: PipelineMode) => {
    if (nextMode === pipelineMode) return;

    // Decision: dialogue, simultaneous interpretation, and meeting are mutually
    // exclusive pipeline modes. Switching mode stops the previous server session
    // instead of layering another pipeline on the same browser microphone/WS.
    if (isUserSpeaking) {
      void record();
    }

    const currentProtocol = pipelineMode === 'dialogue' ? ProtocolId.All : ProtocolId.Translation;
    realTime.current?.stopSession(currentProtocol);
    setCurrentText('');
    setPipelineMode(nextMode);

    if (nextMode === 'dialogue') {
      realTime.current?.startNewSession(undefined, ProtocolId.All);
    }
  }, [isUserSpeaking, pipelineMode, record]);

  // 切换性能监控显示
  const togglePerformanceVisibility = useCallback(() => {
    setIsPerformanceMonitorVisible(prev => !prev);
  }, []);

  // 切换图片上传区域和响应文本显示区域的展开状态
  const toggleSecondarySections = useCallback(() => {
    setIsImageUploadSectionExpanded(prev => !prev);
  }, []);

  const toggleSignalSidebar = useCallback(() => {
    setIsSignalSidebarCollapsed(prev => !prev);
  }, []);

  useEffect(() => {
    const voiceChatCore = realTime.current?.getVoiceChatCore();
    if (!voiceChatCore) return undefined;

    const handleSignalFrame = (frame: SignalMonitorFrame) => {
      const receivedAt = new Date();
      const row: SignalSidebarRow = {
        ...frame,
        id: `${receivedAt.getTime()}_${signalRowSeqRef.current++}`,
        clock: receivedAt.toLocaleTimeString('zh-CN', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        packetCount: 1,
      };

      setSignalRows(prev => {
        const latest = prev[0];
        if (
          frame.audioSignal &&
          latest?.audioSignal &&
          latest.direction === frame.direction &&
          latest.type === frame.type
        ) {
          return [{
            ...latest,
            clock: row.clock,
            bytes: (latest.bytes ?? 0) + (row.bytes ?? 0),
            packetCount: latest.packetCount + 1,
            summary: row.summary ?? latest.summary,
          }, ...prev.slice(1)];
        }

        return [row, ...prev].slice(0, SIGNAL_SIDEBAR_MAX_ROWS);
      });
    };

    voiceChatCore.on(SIGNAL_MONITOR_EVENT, handleSignalFrame);

    return () => {
      voiceChatCore.off(SIGNAL_MONITOR_EVENT, handleSignalFrame);
    };
  }, []);

  useEffect(() => {
    realTime.current?.connectToServer()
    enableDownstreamAudioPlayback();
  }, [enableDownstreamAudioPlayback])

  useEffect(() => {

    // 监听VoiceChatCore的下行音频数据
    const voiceChatCore = realTime.current?.getVoiceChatCore();
    const handleAudioDataReceived = (payload: AudioChunkPayload) => {
      // payload 包含 type 和 data 字段
      // data 是 Base64 编码的音频数据
      // console.debug('[APP] Received downstream audio data:', payload.data.length, 'characters');
      // 播放下行音频数据
      if (audioPlayerRef.current && isPlayingDownstreamAudioRef.current) {
        // 需要将Base64字符串解码为Uint8Array
        const uint8Array = base64ToUint8Array(payload.data);
        audioPlayerRef.current.playAudioChunk(uint8Array);
      }
    };

    if (voiceChatCore) {
      voiceChatCore.on('audio_chunk', handleAudioDataReceived);

      // ========== 高精度性能监控监听器 ==========
      const connectionManager = voiceChatCore?.getConnectionManager();
      if (connectionManager) {
        console.log(`[DEBUG] 注册高精度性能监听器`);
        // 监听高精度延迟测量完成事件
        connectionManager.on('performance:latency:measured', (metric: {
          type: string;
          latency: number;
          startTime: number;
          endTime: number;
          timestamp: number;
        }) => {
          console.log(`[HIGH-PERF] 高精度延迟测量: ${metric.type} = ${metric.latency.toFixed(3)}ms`);

          // 更新UI显示 - 只有在性能监控开启时才处理
          // 优先处理 binary_audio_delta 事件，response.audio.delta 作为备用方案
          if ((metric.type === 'binary_audio_delta' || metric.type === 'response.audio.delta') && isPerformanceMonitorEnabledRef.current) {
            console.log(`[DEBUG] 高精度计时器触发，准备更新计数`);
            setResponseMetrics(prev => {
              console.log(`[DEBUG] 当前对话轮次: ${prev.totalInteractions} -> ${prev.totalInteractions + 1}`);
              const newAudioTimes = [...prev.audioResponseTimes, metric.latency].slice(-50);
              const avgAudio = newAudioTimes.reduce((sum: number, time: number) => sum + time, 0) / newAudioTimes.length;

              return {
                ...prev,
                audioResponseTimes: newAudioTimes,
                averageAudioLatency: avgAudio,
                lastAudioLatency: metric.latency,
                totalInteractions: prev.totalInteractions + 1,
                isTimingActive: false
              };
            });
          }
        });
      }

      const handlers = new Map<string, (payload: unknown) => void>();
      // 移除外部缓冲累积逻辑，直接逐块播放下行PCM
      // 创建统一的事件处理器
      const createEventHandler = (eventName: string) => (payload: unknown) => {
        // NOTE: noisy per-event log; uncomment only when debugging WS event stream ordering.
        // console.log('[type]:', eventName);

        switch (eventName) {
          case 'input_audio_buffer.speech_stopped': {
            // ========== 高精度响应延迟计时开始 ==========
            // 当收到 input_audio_buffer.speech_stopped 事件时，启动高精度计时器
            // 优先使用 binary_audio_delta 事件进行延迟计算，response.audio.delta 作为备用
            // 只有在性能监控开启时才进行计时
            if (!isPerformanceMonitorEnabledRef.current) return;

            const voiceChatCore = realTime.current?.getVoiceChatCore();
            const connectionManager = voiceChatCore?.getConnectionManager();

            if (connectionManager) {
              // 启动高精度计时器 - 优先针对二进制音频响应
              connectionManager.startHighPrecisionTimer('binary_audio_delta');
              console.log('[PERF MONITOR] 用户说话结束，高精度计时器已启动 - binary_audio_delta (优先)');
            }

            // 兼容性：保留原有计时方式
            speechStartTimeRef.current = performance.now();
            hasRecordedResponse.current = false;

            // 更新状态显示计时器已激活
            setResponseMetrics(prev => ({
              ...prev,
              isTimingActive: true
            }));
            break;
          }

          case 'response.created': {
            console.log('[TEXT] Response created, clearing current text');
            setCurrentText('');
            break;
          }

          case 'response.text.delta': {
            const textDeltaEvt = payload as ResponseTextDeltaEvent;
            if (!textDeltaEvt || typeof textDeltaEvt.delta !== 'string') return;
            console.log('[TEXT] Text delta received:', textDeltaEvt.delta);
            setCurrentText(prev => prev + textDeltaEvt.delta);
            break;
          }

          case 'response.text.done': {
            const textDoneEvt = payload as ResponseTextDoneEvent;
            if (!textDoneEvt || typeof textDoneEvt.text !== 'string') return;
            console.log('[TEXT] Text done received:', textDoneEvt.text);
            setFinalTexts(prev => [textDoneEvt.text, ...prev].slice(0, 20));
            setCurrentText('');
            // 收到服务器消息后回到响应显示区域，避免图片上传面板遮住结果。
            setIsImageUploadSectionExpanded(false);
            break;
          }

          case 'binary_audio_delta': {
            // 处理新的二进制音频数据
            const binaryAudioData = payload as any;
            if (!binaryAudioData || !binaryAudioData.audioData) return;

            // NOTE: noisy per-chunk log; uncomment only when debugging downstream audio playback.
            // console.log('[APP] 🎵 收到二进制音频数据，准备播放');

            // ⚠️ 移除错误的自动打断逻辑
            // 流式音频应该连续推送到队列，而不是每次都清空
            // 只有在特定事件（如 output_audio_buffer.started）时才应该清空队列

            // ========== 响应延迟计算（二进制协议优先） ==========
            // 只有在性能监控开启时才执行
            // binary_audio_delta 事件优先于 response.audio.delta 进行延迟计算
            if (isPerformanceMonitorEnabledRef.current && speechStartTimeRef.current && !hasRecordedResponse.current) {
              const audioLatency = performance.now() - speechStartTimeRef.current;
              hasRecordedResponse.current = true; // 标记已记录响应，避免重复计算

              console.log(`[DEBUG] 二进制音频响应延迟 (binary_audio_delta): ${audioLatency.toFixed(2)}ms`);

              setResponseMetrics(prev => ({
                ...prev,
                isTimingActive: false // 确保计时状态正确
              }));
            }

            try {
              console.debug('[APP] 收到二进制音频数据:', {
                dataSize: binaryAudioData.audioData.length,
                responseId: binaryAudioData.responseId,
                itemId: binaryAudioData.itemId,
                outputIndex: binaryAudioData.outputIndex,
                contentIndex: binaryAudioData.contentIndex
              });

              // 二进制音频数据可能需要Opus解码
              const audioData = binaryAudioData.audioData;

              // 确保有音频数据
              if (!audioData || audioData.length === 0) {
                console.warn('[APP] 没有有效的音频数据，跳过播放');
                return;
              }

              const pcmBytes = decodeDownstreamAudio({
                bytes: audioData,
                source: 'binary',
                responseId: binaryAudioData.responseId,
                itemId: binaryAudioData.itemId,
              });
              if (!pcmBytes) return;

              // 播放音频数据
              if (audioPlayerRef.current && isPlayingDownstreamAudioRef.current) {
                console.debug('[APP] 开始播放二进制音频数据:', pcmBytes.length, '字节');
                audioPlayerRef.current.playAudioChunk(pcmBytes);
              } else {
                console.warn('[APP] 音频播放器未就绪:', {
                  hasPlayer: !!audioPlayerRef.current,
                  isPlaying: isPlayingDownstreamAudioRef.current
                });
              }
            } catch (e) {
              console.error('[APP] 二进制音频处理失败:', e);
            }
            break;
          }

          case 'binary_audio_error': {
            // 处理二进制音频错误
            const errorData = payload as any;
            console.error('[APP] 二进制音频解码错误:', errorData);
            break;
          }

          case 'response.audio.delta': {
            // 保留对传统JSON音频的支持（向后兼容）
            // 作为 binary_audio_delta 的备用方案，当二进制协议不可用时使用
            const audioDeltaEvt = payload as ResponseAudioDeltaEvent;
            if (!audioDeltaEvt || typeof audioDeltaEvt.delta !== 'string') return;

            // ========== 响应延迟计算（JSON协议备用） ==========
            // 只有在性能监控开启时才执行
            // response.audio.delta 作为备用方案，当 binary_audio_delta 不可用时使用
            if (isPerformanceMonitorEnabledRef.current && speechStartTimeRef.current && !hasRecordedResponse.current) {
              const audioLatency = performance.now() - speechStartTimeRef.current;
              hasRecordedResponse.current = true; // 标记已记录响应，避免重复计算

              console.log(`[DEBUG] JSON音频响应延迟 (response.audio.delta - 备用方案): ${audioLatency.toFixed(2)}ms`);

              setResponseMetrics(prev => ({
                ...prev,
                isTimingActive: false // 确保计时状态正确
              }));
            }

            try {
              // 直接使用传统的JSON协议处理音频数据
              const opusBytes = base64ToUint8Array(audioDeltaEvt.delta);

              const pcmBytes = decodeDownstreamAudio({
                bytes: opusBytes,
                source: 'json',
                responseId: audioDeltaEvt.response_id,
                itemId: audioDeltaEvt.item_id,
              });
              if (!pcmBytes) return;

              // 播放音频数据
              if (audioPlayerRef.current && isPlayingDownstreamAudioRef.current) {
                console.debug('[APP] 开始播放JSON音频数据:', pcmBytes.length, '字节');
                audioPlayerRef.current.playAudioChunk(pcmBytes);
              } else {
                console.warn('[APP] 音频播放器未就绪:', {
                  hasPlayer: !!audioPlayerRef.current,
                  isPlaying: isPlayingDownstreamAudioRef.current
                });
              }
            } catch (e) {
              console.error('[APP] JSON音频处理失败:', e);
            }
            break;
          }

          // 删除 started/stopped 的本地缓冲管理，保持最小化

          case 'output_audio_buffer.started': {
            const now = performance.now();
            const startedPayload = payload as any;
            console.log('[APP] 🟢 信令时序诊断 - output_audio_buffer.started:', {
              timestamp: now,
              hasExistingPlayer: !!audioPlayerRef.current,
              playerStatus: audioPlayerRef.current?.getQueueStatus(),
              sessionId: startedPayload.session_id,
              item_id: startedPayload.item_id
            });

            // 确保AudioPlayer实例已准备好
            if (!audioPlayerRef.current) {
              audioPlayerRef.current = new AudioPlayer();
              console.log('[APP] 🟢 为新的音频缓冲区创建了新的AudioPlayer实例');
            } else {
              // 🔍 诊断：检查是否存在音频流重叠
              const queueStatus = audioPlayerRef.current.getQueueStatus();
              const potentialOverlap = queueStatus.isPlaying && (now - queueStatus.lastClearTime) < 50;

              console.log('[APP] 🔍 音频流重叠检测:', {
                isPlaying: queueStatus.isPlaying,
                timeSinceLastClear: now - queueStatus.lastClearTime,
                clearCount: queueStatus.clearCount,
                potentialOverlap,
                action: potentialOverlap ? 'force_reset' : 'clear_queue'
              });

              if (potentialOverlap) {
                // 如果检测到重叠，使用强制重置
                audioPlayerRef.current.forceReset();
                console.log('[APP] 🔴 检测到音频流重叠，执行强制重置');
              } else {
                // 清理之前的播放状态，准备新的音频流
                audioPlayerRef.current.clearQueue();
                console.log('[APP] 🟢 清理现有AudioPlayer状态，准备新的音频流');
              }
            }
            break;
          }

          case 'response.audio.done':
          case 'output_audio_buffer.stopped': {
            const now = performance.now();
            const stoppedPayload = payload as any;
            console.log('[APP] 🔴 信令时序诊断 - output_audio_buffer.stopped:', {
              timestamp: now,
              hasExistingPlayer: !!audioPlayerRef.current,
              playerStatus: audioPlayerRef.current?.getQueueStatus(),
              sessionId: stoppedPayload.session_id,
              item_id: stoppedPayload.item_id
            });

            // 停止处理：如果下行播放开关仍为开启，则不要把实例置空（否则后续音频会进入“未就绪”状态）
            if (audioPlayerRef.current) {
              console.log('[APP] 🔴 调用stopPlayback()停止音频播放');
              audioPlayerRef.current.stopPlayback();
              if (!isPlayingDownstreamAudioRef.current) {
                audioPlayerRef.current = null;
                console.log('[APP] 🔴 AudioPlayer实例已清理（下行播放已关闭）');
              } else {
                // 保持实例，等待下一段音频流
                audioPlayerRef.current.clearQueue();
                console.log('[APP] 🔴 AudioPlayer已停止并清空队列（保持实例以便后续继续播放）');
              }
            } else {
              console.log('[APP] 🔴 AudioPlayer实例已为空，无需清理');
            }
            break;
          }

          // 🔧 修复：这些事件现在由正确的 output_audio_buffer.started/stopped 机制处理
          // 保留日志记录但移除错误的打断逻辑
          case 'response.cancel': {
            console.log('[APP] 📝 收到response.cancel事件（已由正确的信令机制处理）');
            // 不再执行打断操作，由 output_audio_buffer.stopped 处理
            break;
          }

          case 'output_audio_buffer.cleared': {
            console.log('[APP] 📝 收到output_audio_buffer.cleared事件（已由正确的信令机制处理）');
            // 不再执行打断操作，由 output_audio_buffer.stopped 处理
            break;
          }

          case 'conversation.item.truncated': {
            console.log('[APP] 📝 收到conversation.item.truncated事件（已由正确的信令机制处理）');
            // 不再执行打断操作，由 output_audio_buffer.stopped 处理
            break;
          }

          case 'response.function_call_arguments.done': {
            handleToolCallEventRef.current(eventName, payload);
            break;
          }

          case 'response.function_call.done': {
            handleToolCallEventRef.current(eventName, payload);
            break;
          }

          default: {
            // 通用事件监听，用于调试
            if (eventName.includes('text') || eventName.includes('response.created') || eventName.includes('cancel') || eventName.includes('cleared') || eventName.includes('truncated')) {
              console.log('[DEBUG] Event received:', eventName, payload);
            }
            // 其他事件默认记录（保持可观察性）
            // console.log('[DOWNSTREAM]', eventName, payload);
            break;
          }
        }
      };

      // 注册所有事件处理器
      downstreamEvents.forEach((eventName) => {
        const handler = createEventHandler(eventName);
        handlers.set(eventName, handler);
        voiceChatCore.on(eventName, handler);
      });

      // 添加通用事件监听器，用于调试所有收到的事件
      voiceChatCore.on('*', (eventName: string, payload: any) => {
        if (eventName.includes('function_call') || eventName.includes('reminder')) {
          console.log('[DEBUG] 🔔 收到相关事件:', eventName, JSON.stringify(payload).substring(0, 200));
        }
      });


      // 清理
      return () => {
        console.log(`[DEBUG] 清理事件监听器`);
        voiceChatCore.off('audio_chunk', handleAudioDataReceived);
        handlers.forEach((h, name) => voiceChatCore.off(name, h));

        // 清理高精度性能监听器
        if (connectionManager) {
          connectionManager.removeAllListeners('performance:latency:measured');
          console.log(`[DEBUG] 已清理高精度性能监听器`);
        }

        // 关闭摄像头
        closeCameraRef.current();
        console.log(`[DEBUG] 摄像头已关闭`);
      };
    }
    // 提供全局函数来添加日志

    return undefined;
  }, [audioPlayerRef, isPlayingDownstreamAudioRef]); // 只在组件挂载时执行一次；这两个 ref 来自稳定 hook 返回值

  return (
    <div className={`${styles.appShell} ${isSignalSidebarCollapsed ? styles.appShellSidebarCollapsed : ''}`}>
      <main className={styles.container}>
        <PerformanceMonitor
          enabled={isPerformanceMonitorEnabled}
          visible={isPerformanceMonitorVisible}
          metrics={responseMetrics}
          onToggleEnabled={togglePerformanceMonitor}
          onToggleVisible={togglePerformanceVisibility}
        />
        <div className={styles.mainSection}>
          {pipelineMode === 'dialogue' && (
            <VoiceStage
              isUserSpeaking={isUserSpeaking}
              talkHint={talkHint}
              onRecord={record}
            />
          )}
          <WebSocketSessionControls
            currentSessionId={currentSessionId}
            isSessionIdLocked={isSessionIdLocked}
            isSwitchingWs={isSwitchingWs}
            sessionIdInput={sessionIdInput}
            voicePreset={voicePreset}
            wsInput={wsInput}
            wsPresetId={wsPresetId}
            wsPresets={WS_PRESETS}
            wsUrl={wsUrl}
            onApplySessionId={applySessionId}
            onApplyVoicePreset={applyVoicePreset}
            onApplyWebSocketUrl={applyWebSocketUrl}
            onSessionIdLockChange={setSessionIdLock}
            onSessionIdInputChange={setSessionIdInput}
            onWsInputChange={setWsInput}
            onWsPresetChange={setWsPresetId}
          />
          <div className={styles.pipelineModeBar} data-testid="pipeline-mode-bar">
            {PIPELINE_OPTIONS.map(option => (
              <button
                key={option.mode}
                type="button"
                data-testid={`pipeline-mode-${option.mode}`}
                className={`${styles.pipelineModeButton} ${pipelineMode === option.mode ? styles.pipelineModeButtonActive : ''}`}
                onClick={() => switchPipelineMode(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {pipelineMode === 'dialogue' ? (
          <ImageResponsePanel
            currentText={currentText}
            finalTexts={finalTexts}
            imagePreview={imagePreview}
            imagePrompt={imagePrompt}
            isExpanded={isImageUploadSectionExpanded}
            isImageUploading={isImageUploading}
            selectedImage={selectedImage}
            sessionStatus={sessionStatus}
            onCancelImage={handleCancelImage}
            onImagePromptChange={setImagePrompt}
            onImageSelect={handleImageSelect}
            onSendImage={handleSendImage}
            onToggle={toggleSecondarySections}
          />
        ) : (
          <SimulMeetingTestPanel
            key={pipelineMode}
            isUserSpeaking={isUserSpeaking}
            profile={pipelineMode}
            realTimeRef={realTime}
            sessionStatus={sessionStatus}
            onRecord={record}
          />
        )}
      </main>

      <SignalSidebar
        collapsed={isSignalSidebarCollapsed}
        rows={signalRows}
        onToggle={toggleSignalSidebar}
      />

      {/* PWA安装提示 */}
      <PWAInstallPrompt />

      {/* 提醒面板 */}
      <ReminderPanel />
    </div>
  )
}
