/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useAtom } from 'jotai'
import ReactMarkdown from 'react-markdown'
import styles from './App.module.scss'
import squadyLogo from './assets/squady.png'
import { isUserSpeakingAtom, logsAtom, wsConnectedAtom } from './state'
import { LiveAudioVisualizerComponent } from './component/audioVisualizer'
import { RealTime } from './RealTime'
import { StatusPoint } from './component/statusPoint'
import type { AudioManager } from './sdk/audio/AudioManager'
import type { AudioChunkPayload, ResponseAudioDeltaEvent, OutputAudioBufferStartedEvent, ResponseAudioDoneEvent, ResponseTextDeltaEvent, ResponseTextDoneEvent, InputAudioSpeechStartedEvent, InputAudioSpeechStoppedEvent } from './sdk/protocol/ClientProtocol';
import { AudioPlayer } from './sdk/audio/AudioPlayer';
import { audioProcessor } from './sdk/audio/AudioCodec';
import { base64ToUint8Array } from './sdk/audio/AudioUtils';
import type { VoiceChatCore } from './sdk'

// 趋势图组件
const TrendChart = React.memo(({ responseMetrics }: {
  responseMetrics: {
    audioResponseTimes: number[];
    averageAudioLatency: number;
    totalInteractions: number;
    lastAudioLatency: number;
    isTimingActive: boolean;
  }
}) => {
  const trendData = useMemo(() => {
    const times = responseMetrics.audioResponseTimes.slice(-10);
    return {
      times,
      minTime: Math.min(...responseMetrics.audioResponseTimes),
      maxTime: Math.max(...responseMetrics.audioResponseTimes)
    };
  }, [responseMetrics.audioResponseTimes]);

  return (
    <div className={styles.responseTrend}>
      <div className={styles.trendLabel}>音频响应延迟趋势（最近10次）</div>
      <div className={styles.trendBars}>
        {trendData.times.map((time: number, index: number) => (
          <div
            key={index}
            className={styles.trendBar}
            style={{
              height: `${Math.min(time / 20, 50)}px`,
              backgroundColor: time < 1000 ? '#4CAF50' : time < 2000 ? '#FF9800' : '#F44336'
            }}
            title={`第${responseMetrics.audioResponseTimes.length - 9 + index}次: ${time.toFixed(0)}ms`}
          />
        ))}
      </div>
      <div className={styles.trendStats}>
        <span>最快: {trendData.minTime.toFixed(1)}ms</span>
        <span>最慢: {trendData.maxTime.toFixed(1)}ms</span>
        <span>精度: 1ms</span>
      </div>
    </div>
  );
});

TrendChart.displayName = 'TrendChart';

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
  'response.function_call_result.delta'
] as const;


export const App = () => {
  const [isUserSpeaking, setIsUserSpeaking] = useAtom(isUserSpeakingAtom)
  const [speechDetected, setSpeechDetected] = useState(false);
  const [speechSegmentCount, setSpeechSegmentCount] = useState(0);

  const [vadThreshold, setVadThreshold] = useState(0.5);
  const [isPlayingDownstreamAudio, setIsPlayingDownstreamAudio] = useState(false);
  // 展示下行文本（WS返回的文本）
  const [currentText, setCurrentText] = useState('');
  const [finalTexts, setFinalTexts] = useState<string[]>([]);

  const realTime = useRef<any>()

  useEffect(() => {
    realTime.current = new RealTime()
  }, [])

  // 响应速度监控相关状态
  const [responseMetrics, setResponseMetrics] = useState<{
    audioResponseTimes: number[];
    averageAudioLatency: number;
    totalInteractions: number;
    lastAudioLatency: number;
    isTimingActive: boolean;
  }>({
    audioResponseTimes: [],
    averageAudioLatency: 0,
    totalInteractions: 0,
    lastAudioLatency: 0,
    isTimingActive: false
  });


  // 性能监控开关状态
  const [isPerformanceMonitorEnabled, setIsPerformanceMonitorEnabled] = useState(true);

  // 用于跟踪请求时间的 Ref
  const speechStartTimeRef = useRef<number | null>(null);
  const hasRecordedResponse = useRef<boolean>(false);

  // 用于在useEffect中访问最新状态的ref
  const isPerformanceMonitorEnabledRef = useRef(isPerformanceMonitorEnabled);
  const isPlayingDownstreamAudioRef = useRef(isPlayingDownstreamAudio);

  // 使用useLayoutEffect更新ref值，避免重渲染
  useLayoutEffect(() => {
    isPerformanceMonitorEnabledRef.current = isPerformanceMonitorEnabled;
  }, [isPerformanceMonitorEnabled]);

  useLayoutEffect(() => {
    isPlayingDownstreamAudioRef.current = isPlayingDownstreamAudio;
  }, [isPlayingDownstreamAudio]);

  // 切换性能监控状态
  const togglePerformanceMonitor = useCallback(() => {
    setIsPerformanceMonitorEnabled(prev => {
      const newState = !prev;

      if (newState) {
        console.log('[PERF MONITOR] 性能监控已启用');
      } else {
        console.log('[PERF MONITOR] 性能监控已禁用，清理数据...');

        // 清理性能数据
        setResponseMetrics({
          audioResponseTimes: [],
          averageAudioLatency: 0,
          totalInteractions: 0,
          lastAudioLatency: 0,
          isTimingActive: false
        });

        // 清理计时器状态
        speechStartTimeRef.current = null;
        hasRecordedResponse.current = false;

        // 清理高精度计时器缓存
        const voiceChatCore = realTime.current?.getVoiceChatCore();
        const connectionManager = voiceChatCore?.getConnectionManager();
        if (connectionManager) {
          console.log('[PERF MONITOR] 高精度计时器缓存已清理');
        }
      }

      return newState;
    });
  }, []);

  // 获取RealTime实例中的AudioManager
  const audioManagerRef = useRef<AudioManager | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);

  // 传输定时器
  const transmissionTimerRef = useRef<number | null>(null);
  const nextSendAtRef = useRef<number | null>(null);

  // 性能监控显示控制
  const [isPerformanceMonitorVisible, setIsPerformanceMonitorVisible] = useState(true);

  // 切换性能监控显示
  const togglePerformanceVisibility = useCallback(() => {
    setIsPerformanceMonitorVisible(prev => !prev);
  }, []);

  // 控制下行音频播放
  const toggleDownstreamAudioPlayback = useCallback(() => {
    setIsPlayingDownstreamAudio(prev => {
      const newState = !prev;

      // 初始化或清理AudioPlayer实例
      if (newState) {
        if (!audioPlayerRef.current) {
          audioPlayerRef.current = new AudioPlayer();
        }
        // console.debug('[APP] Downstream audio playback enabled');
      } else {
        if (audioPlayerRef.current) {
          audioPlayerRef.current.stopPlayback();
          audioPlayerRef.current = null;
        }
        // console.debug('[APP] Downstream audio playback disabled');
      }

      return newState;
    });
  }, []);

  const toggleVadProcessing = useCallback(async () => {
    // console.debug("toggleVadProcessing called, isUserSpeaking:", isUserSpeaking);
    if (!audioManagerRef.current) {
      // console.debug("No audioManagerRef, returning");
      return;
    }

    if (!isUserSpeaking) {
      // console.debug("[APP] Starting VAD processing");

      // 批量重置状态，减少重渲染
      setSpeechSegmentCount(0);
      setSpeechDetected(false);
      // console.debug("[APP] Cleared previous speech segments");

      try {
        // 配置并启动AudioManager
        await audioManagerRef.current
          .configure({
            enabled: true,
            threshold: vadThreshold,
            loopback: false,
            uplink: {
              onChunkProcessed: async (chunk: Uint8Array) => {
                // console.debug('[APP UPLINK] Processed audio chunk for uplink, size:', chunk.length, 'bytes');

                // 检查数据是否为空
                if (!chunk || chunk.length === 0) {
                  // console.warn('[APP UPLINK] Warning: Empty audio chunk received, skipping send');
                  return;
                }

                // 验证数据是否符合最小大小要求
                if (chunk.length < 10) {
                  // console.warn('[APP UPLINK] Warning: Audio chunk too small, size:', chunk.length, 'bytes, skipping send');
                  return;
                }

                // 注意：计时器现在由 input_audio_buffer.speech_started 事件控制
                // 这里只负责发送音频数据，不再重置计时器

                // console.debug('[APP UPLINK] Sending audio chunk to server, size:', chunk.length, 'bytes');

                // 获取VoiceChatCore实例并发送编码后的音频数据
                const voiceChatCore = realTime.current?.getVoiceChatCore();
                if (voiceChatCore) {
                  const result = voiceChatCore.sendEncodedAudioData(chunk);
                  if (!result) {
                    // console.warn('[APP UPLINK] Warning: Failed to send audio chunk to server');
                  } else {
                    // console.debug('[APP UPLINK] Audio chunk sent to server successfully');
                  }
                } else {
                  // console.warn('[APP UPLINK] VoiceChatCore instance not available');
                }
              }
            }
          })
          .start();

        // console.debug("[APP] VAD audio processing started");
        setIsUserSpeaking(true);

      } catch {
        // suppressed
      }
    } else {
      // console.debug("[APP] Stopping VAD processing");

      try {
        // 停止并禁用AudioManager
        await audioManagerRef.current
          .stop()
          .then(manager => manager.configure({ enabled: false }));

        // console.debug("[APP] VAD audio processing stopped");
        // 批量更新状态，减少重渲染次数
        setIsUserSpeaking(false);
        setSpeechDetected(false);
        setSpeechSegmentCount(0);

      } catch {
        // suppressed
      }
    }
  }, [isUserSpeaking, vadThreshold, setIsUserSpeaking]);

  const record = useCallback(() => {
    // setIsUserSpeaking(!isUserSpeaking)
    toggleVadProcessing()
  }, [toggleVadProcessing]);

  // // 音频传输控制
  // const startAudioTransmission = () => {
  //   if (transmissionTimerRef.current) return;

  //   const TICK_MS = 50; // 更高精度，带漂移校正
  //   nextSendAtRef.current = performance.now();

  //   const tick = async () => {
  //     // 注意：这里需要根据实际实现调整
  //     // await realTime.transmitAudioData(audioDataBufferRef.current);
  //     const now = performance.now();
  //     const next = (nextSendAtRef.current ?? now) + TICK_MS;
  //     nextSendAtRef.current = next;
  //     const delay = Math.max(0, next - now);
  //     transmissionTimerRef.current = window.setTimeout(tick, delay);
  //   };

  //   transmissionTimerRef.current = window.setTimeout(tick, 0);
  // };

  const stopAudioTransmission = () => {
    if (transmissionTimerRef.current) {
      window.clearTimeout(transmissionTimerRef.current);
      transmissionTimerRef.current = null;
    }
    nextSendAtRef.current = null;
  };



  useEffect(() => {
    realTime.current?.connectToServer()
    // 直接调用状态设置，避免依赖回调函数
    setIsPlayingDownstreamAudio(true);
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioPlayer();
    }
  }, [])

  useEffect(() => {

    // 获取RealTime实例中的AudioManager
    audioManagerRef.current = realTime.current?.getAudioManager();

    // 设置事件监听器
    audioManagerRef.current?.on('speech:start', () => {
      // console.log('speech:start');
      setSpeechDetected(true);
    });

    audioManagerRef.current?.on('speech:end', (_speechAudio: Float32Array) => {
      // console.log('speech:end', speechAudio.length);
      setSpeechSegmentCount(prev => prev + 1); // 使用函数式更新避免闭包问题
      setSpeechDetected(false);
    });

    audioManagerRef.current?.on('audio:data', (_audioData: Float32Array) => {
      // suppressed
    });

    // 监听错误事件
    audioManagerRef.current?.on('error', (_error: Error) => {
      // suppressed
    });

    // 监听VAD配置变化
    audioManagerRef.current?.on('vad:enabled', (_enabled: boolean) => {
      // suppressed
    });

    audioManagerRef.current?.on('vad:threshold', (_threshold: number) => {
      // suppressed
    });

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
          if (metric.type === 'response.audio.delta' && isPerformanceMonitorEnabledRef.current) {
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
        console.log('[type]:', eventName);
        
        switch (eventName) {
          case 'input_audio_buffer.speech_stopped': {
            // ========== 高精度响应延迟计时开始 ==========
            // 当收到 input_audio_buffer.speech_stopped 事件时，启动高精度计时器
            // 只有在性能监控开启时才进行计时
            if (!isPerformanceMonitorEnabledRef.current) return;

            const voiceChatCore = realTime.current?.getVoiceChatCore();
            const connectionManager = voiceChatCore?.getConnectionManager();

            if (connectionManager) {
              // 启动高精度计时器 - 针对音频响应
              connectionManager.startHighPrecisionTimer('response.audio.delta');
              console.log('[PERF MONITOR] 用户说话结束，高精度计时器已启动 - response.audio.delta');
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
            break;
          }

          case 'response.audio.delta': {
            const audioDeltaEvt = payload as ResponseAudioDeltaEvent;
            if (!audioDeltaEvt || typeof audioDeltaEvt.delta !== 'string') return;

            // ========== 兼容性响应延迟计算 ==========
            // 备用计时方式（以防高精度计时器失效）- 只有在性能监控开启时才执行
            if (isPerformanceMonitorEnabledRef.current && speechStartTimeRef.current && !hasRecordedResponse.current) {
              const audioLatency = performance.now() - speechStartTimeRef.current;
              hasRecordedResponse.current = true; // 标记已记录响应，避免重复计算

              console.log(`[DEBUG] 兼容性计时器触发 - 延迟: ${audioLatency.toFixed(2)}ms`);
              console.log(`[DEBUG] 兼容性计时器 - 不更新对话轮次计数`);

              // 注意：只在高精度计时器未工作时才更新状态，避免重复计算对话轮次
              // 高精度计时器会通过 performance:latency:measured 事件更新状态
              setResponseMetrics(prev => ({
                ...prev,
                isTimingActive: false // 确保计时状态正确
              }));
            }

            try {
              const opusBytes = base64ToUint8Array(audioDeltaEvt.delta);
              let pcmBytes = audioProcessor.decodeOpus(opusBytes);
              if (!pcmBytes || pcmBytes.length === 0) {
                pcmBytes = opusBytes;
              }
              if (pcmBytes && pcmBytes.length > 0 && audioPlayerRef.current && isPlayingDownstreamAudioRef.current) {
                // 直接播放当前分片
                audioPlayerRef.current.playAudioChunk(pcmBytes);
              }
            } catch (e) {
              console.error('[APP] Failed to decode/play response.audio.delta:', e);
            }
            break;
          }

          // 删除 started/stopped 的本地缓冲管理，保持最小化

          case 'response.audio.done':
          case 'output_audio_buffer.stopped': {
            // 无需冲刷，本地不再累积
            break;
          }

          default: {
            // 通用事件监听，用于调试
            if (eventName.includes('text') || eventName.includes('response.created')) {
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


      // 清理
      return () => {
        console.log(`[DEBUG] 清理事件监听器`);
        audioManagerRef.current?.removeAllListeners?.();
        stopAudioTransmission();
        voiceChatCore.off('audio_chunk', handleAudioDataReceived);
        handlers.forEach((h, name) => voiceChatCore.off(name, h));

        // 清理高精度性能监听器
        if (connectionManager) {
          connectionManager.removeAllListeners('performance:latency:measured');
          console.log(`[DEBUG] 已清理高精度性能监听器`);
        }
      };
    }
    // 提供全局函数来添加日志

    return undefined;
  }, []); // 只在组件挂载时执行一次

  // 单独处理音频播放状态变化
  useEffect(() => {
    // 确保audioPlayer的状态正确初始化
    if (isPlayingDownstreamAudio) {
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new AudioPlayer();
        console.log('[AUDIO] AudioPlayer 初始化完成');
      }
    } else {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stopPlayback();
        audioPlayerRef.current = null;
        console.log('[AUDIO] AudioPlayer 已停止并清理');
      }
    }
  }, [isPlayingDownstreamAudio]);

  // 获取延迟颜色类名的函数 - 使用 useMemo 优化
  const getLatencyColor = useMemo(() =>
    (latency: number): string => {
      if (latency === 0) return '';
      if (latency < 1000) return styles.excellent;
      if (latency < 2000) return styles.good;
      return styles.poor;
    }, []);

  const [, setIsWsConnected] = useAtom(wsConnectedAtom);

  useEffect(() => {
    const voiceChatCore: VoiceChatCore = realTime.current?.getVoiceChatCore();

    // 监听WebSocket原生事件
    const handleOpen = () => {
      // 连接成功时，connectionStatusChange事件应该已经更新了状态
      setIsWsConnected(true);
    };

    const handleClose = () => {
      setIsWsConnected(false);
      // setConnectionStatus({
      //     state: 'disconnected',
      //     message: 'WebSocket连接已断开'
      // });
    };

    const handleError = () => {
      // setConnectionStatus({
      //     state: 'error',
      //     message: 'WebSocket连接发生错误',
      //     error: error.message || '未知错误'
      // });
    };

    // 监听会话创建事件
    const handleSessionCreated = () => {
      // setSessionStatus({
      //     created: true,
      //     sessionId: data.session?.id || null
      // });
    };

    // 注册事件监听器
    // voiceChatCore.on('connectionStatusChange', handleConnectionStatusChange);
    voiceChatCore.on('open', handleOpen);
    voiceChatCore.on('close', handleClose);
    voiceChatCore.on('error', handleError);
    voiceChatCore.on('session.created', handleSessionCreated);

    // 清理函数
    return () => {
      // voiceChatCore.off('connectionStatusChange', handleConnectionStatusChange);
      voiceChatCore.off('open', handleOpen);
      voiceChatCore.off('close', handleClose);
      voiceChatCore.off('error', handleError);
      voiceChatCore.off('session.created', handleSessionCreated);
    };
  }, [realTime, setIsWsConnected]);

  return (
    <div className={styles.container}>
      <div className={styles.mainSection}>
        <div className={styles.squadyUIContainer}>
          <LiveAudioVisualizerComponent pause={!isUserSpeaking} />
          <div
            className={styles.squadyUI}
            onClick={record}
          >
            <img src={squadyLogo} alt="squady" />
          </div>
          <div className={styles.squadyUIText}>
            <div>Squady</div>
            <StatusPoint />
          </div>
          <div className={styles.squadySubtext}>
            {isUserSpeaking ? '正在聆听...' : '点击开始对话'}
          </div>
        </div>
      </div>

      {/* 实时响应速度监控显示 */}
      <div className={`${styles.performanceMonitor} ${isPerformanceMonitorVisible ? styles.visible : styles.hidden}`}>
        <div className={styles.performanceHeader}>
          <h4>实时响应监控</h4>
          <div className={styles.headerButtons}>
            <button
              className={`${styles.toggleButton} ${isPerformanceMonitorEnabled ? styles.enabled : styles.disabled}`}
              onClick={togglePerformanceMonitor}
              title={isPerformanceMonitorEnabled ? "关闭性能监控" : "开启性能监控"}
              type="button"
            >
              {isPerformanceMonitorEnabled ? "⏸" : "▶"}
            </button>
            <button
              className={styles.toggleButton}
              onClick={togglePerformanceVisibility}
              title="展开/收起"
              type="button"
            >
              {isPerformanceMonitorVisible ? '−' : '+'}
            </button>
          </div>
        </div>

        {isPerformanceMonitorVisible && (
          <div className={styles.performanceContent}>
            <div className={styles.metricsGrid}>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>平均音频延迟</span>
                <span className={`${styles.metricValue} ${getLatencyColor(responseMetrics.averageAudioLatency)}`}>
                  {responseMetrics.averageAudioLatency > 0
                    ? `${responseMetrics.averageAudioLatency.toFixed(0)}ms`
                    : '--'}
                </span>
              </div>

              <div className={styles.metric}>
                <span className={styles.metricLabel}>最近音频延迟</span>
                <span className={`${styles.metricValue} ${getLatencyColor(responseMetrics.lastAudioLatency)}`}>
                  {responseMetrics.lastAudioLatency > 0
                    ? `${responseMetrics.lastAudioLatency.toFixed(0)}ms`
                    : '--'}
                </span>
              </div>
              <div className={styles.metric}>
                <span className={styles.metricLabel}>对话轮次</span>
                <span className={styles.metricValue}>
                  {responseMetrics.totalInteractions}
                </span>
              </div>

              <div className={styles.metric}>
                <span className={styles.metricLabel}>计时精度</span>
                <span className={`${styles.metricValue} ${responseMetrics.isTimingActive ? styles.timing : styles.excellent}`}>
                  {responseMetrics.isTimingActive ? '高精度计时中...' : '1ms精度'}
                </span>
              </div>
            </div>

            {/* 响应时间趋势图 */}
            {responseMetrics.audioResponseTimes.length > 1 && (
              <TrendChart responseMetrics={responseMetrics} />
            )}
          </div>
        )}
      </div>


      {/* 服务器文本响应显示区域 */}
      <div className={styles.responseTextDisplay}>
        <ReactMarkdown>
          {currentText || finalTexts[0] || ''}
        </ReactMarkdown>
      </div>
    </div>
  )
}
