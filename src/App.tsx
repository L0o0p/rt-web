/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useEffect, useRef, useState } from 'react'
import { useAtom } from 'jotai'
import styles from './App.module.scss'
import squadyLogo from './assets/squady.png'
import { isUserSpeakingAtom } from './state'
import { LiveAudioVisualizerComponent } from './component/audioVisualizer'
import { RealTime } from './RealTime'
import { WebSocketStatusMonitor } from './component/WebSocketStatusMonitor'
import { StatusPoint } from './component/statusPoint'
import type { AudioManager } from './sdk/audio/AudioManager'
import type { AudioChunkPayload, ResponseAudioDeltaEvent, OutputAudioBufferStartedEvent, ResponseAudioDoneEvent, ResponseTextDeltaEvent, ResponseTextDoneEvent } from './sdk/protocol/ClientProtocol';
import { AudioPlayer } from './sdk/audio/AudioPlayer';
import { audioProcessor } from './sdk/audio/AudioCodec';
import { base64ToUint8Array } from './sdk/audio/AudioUtils';

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

// eslint-disable-next-line react-refresh/only-export-components
export const realTime = new RealTime()

export const App = () => {
  const [isUserSpeaking, setIsUserSpeaking] = useAtom(isUserSpeakingAtom)
  const hasConnected = useRef(false)
  const [, setSpeechDetected] = useState(false);
  const [, setSpeechSegmentCount] = useState(0);
  const [vadThreshold,] = useState(0.5);
  const [isPlayingDownstreamAudio, setIsPlayingDownstreamAudio] = useState(false);
  // 展示下行文本（WS返回的文本）
  const [currentText, setCurrentText] = useState('');
  const [finalTexts, setFinalTexts] = useState<string[]>([]);


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

  // 用于跟踪请求时间的 Ref
  const speechStartTimeRef = useRef<number | null>(null);
  const hasRecordedResponse = useRef<boolean>(false);

  // 获取RealTime实例中的AudioManager
  const audioManagerRef = useRef<AudioManager | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);

  // VAD音频片段存储
  const speechSegmentsRef = useRef<Float32Array[]>([]);
  const currentSpeechDataRef = useRef<Float32Array[]>([]);
  const isCollectingRef = useRef<boolean>(false);

  // 音频数据缓冲区
  const audioDataBufferRef = useRef<Float32Array[]>([]);
  const recordedAudioDataRef = useRef<any[]>([]);

  // 传输定时器
  const transmissionTimerRef = useRef<number | null>(null);
  const nextSendAtRef = useRef<number | null>(null);

  const connect = async () => {
    if (hasConnected.current) return
    hasConnected.current = true
    await realTime.connectToServer()
  }

  const record = () => {
    // setIsUserSpeaking(!isUserSpeaking)
    toggleVadProcessing()
  }

  // 控制下行音频播放
  const toggleDownstreamAudioPlayback = () => {
    const newState = !isPlayingDownstreamAudio;
    setIsPlayingDownstreamAudio(newState);

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
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const toggleVadProcessing = async () => {
    // console.debug("toggleVadProcessing called, isUserSpeaking:", isUserSpeaking);
    if (!audioManagerRef.current) {
      // console.debug("No audioManagerRef, returning");
      return;
    }

    if (!isUserSpeaking) {
      // console.debug("[APP] Starting VAD processing");

      // 清空之前的语音片段
      speechSegmentsRef.current = [];
      setSpeechSegmentCount(0);
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


                // console.debug('[APP UPLINK] Sending audio chunk to server, size:', chunk.length, 'bytes');

                // 获取VoiceChatCore实例并发送编码后的音频数据
                const voiceChatCore = realTime.getVoiceChatCore();
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
        setIsUserSpeaking(false);
        setSpeechDetected(false);

      } catch {
        // suppressed
      }
    }
  };

  // 合并外部收集的音频数据
  const combineCollectedAudio = (): Float32Array => {
    if (currentSpeechDataRef.current.length === 0) {
      return new Float32Array(0);
    }

    const totalLength = currentSpeechDataRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;

    for (const chunk of currentSpeechDataRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // console.debug(`[APP EXTERNAL] Combined ${currentSpeechDataRef.current.length} chunks into ${totalLength} samples`);
    return combined;
  }

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
    connect()
    toggleDownstreamAudioPlayback()
  }, [])

  useEffect(() => {
    // 获取RealTime实例中的AudioManager
    audioManagerRef.current = realTime.getAudioManager();

    // 设置事件监听器
    audioManagerRef.current.on('speech:start', () => {
      // console.log('speech:start');
      setSpeechDetected(true);
      // 开始外部收集音频数据
      isCollectingRef.current = true;
      currentSpeechDataRef.current = [];
      console.log('[APP EXTERNAL] Started collecting speech data externally');
    });

    audioManagerRef.current.on('speech:end', (speechAudio: Float32Array) => {
      // console.log('speech:end', speechAudio.length);

      // 停止外部收集
      isCollectingRef.current = false;

      // 合并外部收集的数据
      const externalCollectedAudio = combineCollectedAudio();
      // console.debug('[APP EXTERNAL] External collection ended, collected audio length:', externalCollectedAudio.length);

      // 优先使用外部收集的数据，如果为空则使用VAD库提供的数据
      const finalAudio = externalCollectedAudio.length > 0 ? externalCollectedAudio : speechAudio;
      // console.debug('[APP EXTERNAL] Final audio length:', finalAudio.length);

      if (finalAudio.length > 0) {
        // 将语音片段添加到存储中
        speechSegmentsRef.current.push(finalAudio);
        setSpeechSegmentCount(speechSegmentsRef.current.length); // 更新状态触发重新渲染
        // console.debug('[APP VAD] Stored speech segment, total segments:', speechSegmentsRef.current.length);
        // console.debug('[APP VAD] Speech segment duration (approx):', (finalAudio.length / 16000).toFixed(2), 'seconds');

        // ========== VAD检测到语音结束时开始响应延迟计时 ==========
        speechStartTimeRef.current = performance.now();
        hasRecordedResponse.current = false;
        console.log('[PERF MONITOR] VAD检测到语音结束，开始计时等待服务器响应');

        // 更新状态显示计时器已激活
        setResponseMetrics(prev => ({
          ...prev,
          isTimingActive: true
        }));
      } else {
        // console.warn('[APP VAD] Received empty speech audio data from both sources');
      }

      setSpeechDetected(false);
    });

    // 监听原始音频数据，用于外部收集
    audioManagerRef.current.on('audio:data', (audioData: Float32Array) => {
      // 始终保存录制的音频数据用于回放
      if (isUserSpeaking) {
        recordedAudioDataRef.current.push({
          data: audioData,
          timestamp: Date.now()
        });
      }

      // 只有当VAD检测到语音活动且WebSocket连接时，才添加到传输缓冲区
      if (isCollectingRef.current) {
        // 创建副本并添加到当前收集中
        const audioCopy = new Float32Array(audioData);
        currentSpeechDataRef.current.push(audioCopy);
        // console.debug('[APP EXTERNAL] Collected audio chunk, total chunks:', currentSpeechDataRef.current.length);

        // 同时添加到传输缓冲区
        audioDataBufferRef.current.push(audioCopy);

        // 控制缓冲区大小
        const MAX_BUFFER_SIZE = 5;
        while (audioDataBufferRef.current.length > MAX_BUFFER_SIZE) {
          audioDataBufferRef.current.shift();
        }
      }
    });

    // 监听错误事件
    audioManagerRef.current.on('error', (_error: Error) => {
      // suppressed
    });

    // 监听VAD配置变化
    audioManagerRef.current.on('vad:enabled', (_enabled: boolean) => {
      // suppressed
    });

    audioManagerRef.current.on('vad:threshold', (_threshold: number) => {
      // suppressed
    });

    // 监听VoiceChatCore的下行音频数据
    const voiceChatCore = realTime.getVoiceChatCore();
    const handleAudioDataReceived = (payload: AudioChunkPayload) => {
      // payload 包含 type 和 data 字段
      // data 是 Base64 编码的音频数据
      // console.debug('[APP] Received downstream audio data:', payload.data.length, 'characters');
      // 播放下行音频数据
      if (audioPlayerRef.current && isPlayingDownstreamAudio) {
        // 需要将Base64字符串解码为Uint8Array
        const uint8Array = base64ToUint8Array(payload.data);
        audioPlayerRef.current.playAudioChunk(uint8Array);
      }
    };

    if (voiceChatCore) {
      voiceChatCore.on('audio_chunk', handleAudioDataReceived);

      const handlers = new Map<string, (payload: unknown) => void>();
      // 按 response_id 缓冲PCM字节，基于时间阈值（50ms）聚合后播放
      type BufferState = { chunks: Uint8Array[]; lastFlushAt: number };
      const pcmBuffersRef = new Map<string, BufferState>();
      const FRAME_DURATION_MS = 20; // 每帧20ms
      const FLUSH_INTERVAL_MS = 50; // 目标缓冲时长 ~50ms

      const flushPlay = (responseId: string, now: number = performance.now()) => {
        if (!audioPlayerRef.current || !isPlayingDownstreamAudio) return;
        const state = pcmBuffersRef.get(responseId);
        if (!state || state.chunks.length === 0) return;
        const list = state.chunks;
        let total = 0;
        for (const chunk of list) total += chunk.length;
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of list) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        // 重置并播放
        state.chunks = [];
        state.lastFlushAt = now;
        pcmBuffersRef.set(responseId, state);
        audioPlayerRef.current.playAudioChunk(merged);
      };
      downstreamEvents.forEach((eventName) => {
        const handler = (payload: unknown) => {
          // 通用事件监听，用于调试
          if (eventName.includes('text') || eventName.includes('response.created')) {
            console.log('[DEBUG] Event received:', eventName, payload);
          }
          // 文本增量与完成（展示在前端）
          if (eventName === 'response.created') {
            console.log('[TEXT] Response created, clearing current text');
            setCurrentText('');
            return;
          }
          if (eventName === 'response.text.delta') {
            const evt = payload as ResponseTextDeltaEvent;
            if (!evt || typeof evt.delta !== 'string') return;
            console.log('[TEXT] Text delta received:', evt.delta);
            setCurrentText(prev => prev + evt.delta);
            return;
          }

          if (eventName === 'response.text.done') {
            const evt = payload as ResponseTextDoneEvent;
            if (!evt || typeof evt.text !== 'string') return;
            console.log('[TEXT] Text done received:', evt.text);
            setFinalTexts(prev => [evt.text, ...prev].slice(0, 20));
            setCurrentText('');
            return;
          }

          // 专门处理音频增量：解码并播放
          if (eventName === 'response.audio.delta') {
            const evt = payload as ResponseAudioDeltaEvent;
            if (!evt || typeof evt.delta !== 'string') return;

            // ========== 响应延迟计算 ==========
            // 当收到第一个 response.audio.delta 时，定格计算延迟
            if (speechStartTimeRef.current && !hasRecordedResponse.current) {
              const audioLatency = performance.now() - speechStartTimeRef.current;
              hasRecordedResponse.current = true; // 标记已记录响应，避免重复计算

              console.log(`[PERF MONITOR] 收到音频响应，延迟: ${audioLatency.toFixed(2)}ms`);

              setResponseMetrics(prev => {
                const newAudioTimes = [...prev.audioResponseTimes, audioLatency].slice(-50); // 保留最近50次
                const avgAudio = newAudioTimes.reduce((sum, time) => sum + time, 0) / newAudioTimes.length;

                return {
                  ...prev,
                  audioResponseTimes: newAudioTimes,
                  averageAudioLatency: avgAudio,
                  lastAudioLatency: audioLatency,
                  totalInteractions: prev.totalInteractions + 1,
                  isTimingActive: false // 计时完成，关闭计时状态
                };
              });
            }

            try {
              const opusBytes = base64ToUint8Array(evt.delta);
              let pcmBytes = audioProcessor.decodeOpus(opusBytes);
              // 解码失败或返回空时，回退直接按PCM播放
              if (!pcmBytes || pcmBytes.length === 0) {
                pcmBytes = opusBytes;
              }
              if (pcmBytes && pcmBytes.length > 0) {
                const rid = evt.response_id;
                const now = performance.now();
                const state = pcmBuffersRef.get(rid) || { chunks: [], lastFlushAt: now } as BufferState;
                state.chunks.push(pcmBytes);
                // 若距离上次播放已超过50ms，或累计帧时长超过50ms则冲刷
                const elapsed = now - state.lastFlushAt;
                const accumulatedMs = state.chunks.length * FRAME_DURATION_MS;
                if (elapsed >= FLUSH_INTERVAL_MS || accumulatedMs >= FLUSH_INTERVAL_MS) {
                  flushPlay(rid, now);
                } else {
                  pcmBuffersRef.set(rid, state);
                }
              }
            } catch (e) {
              console.error('[APP] Failed to decode/play response.audio.delta:', e);
            }
            return;
          }

          // 开始缓冲
          if (eventName === 'output_audio_buffer.started') {
            const evt = payload as OutputAudioBufferStartedEvent;
            if (evt && typeof evt.response_id === 'string') {
              pcmBuffersRef.set(evt.response_id, { chunks: [], lastFlushAt: performance.now() });
            }
            return;
          }

          // 结束缓冲并播放剩余
          if (eventName === 'response.audio.done' || eventName === 'output_audio_buffer.stopped') {
            const respId = (payload as Partial<ResponseAudioDoneEvent> & { response_id?: string }).response_id;
            if (respId) {
              flushPlay(respId);
              pcmBuffersRef.delete(respId);
            }
            return;
          }

          // 其他事件默认记录（保持可观察性）
          // console.log('[DOWNSTREAM]', eventName, payload);
        };
        handlers.set(eventName, handler);
        voiceChatCore.on(eventName, handler);
      });


      // 清理
      return () => {
        audioManagerRef.current?.removeAllListeners();
        stopAudioTransmission();
        voiceChatCore.off('audio_chunk', handleAudioDataReceived);
        handlers.forEach((h, name) => voiceChatCore.off(name, h));
      };
    }

    return undefined;
  }, [isPlayingDownstreamAudio]);

  // 获取延迟颜色类名的函数
  const getLatencyColor = (latency: number): string => {
    if (latency === 0) return '';
    if (latency < 1000) return styles.excellent;
    if (latency < 2000) return styles.good;
    return styles.poor;
  };

  return (
    <div className={styles.container}>
      <div className={styles.mainSection}>
        {isUserSpeaking && (
          <div className={styles.audioVisualizerOverlay}>
            <LiveAudioVisualizerComponent
              width={700}
              height={200}
              barColor="#ffffff"
              smoothingTimeConstant={0.8}
              fftSize={512}
              barWidth={3}
              gap={2}
              isRecording={isUserSpeaking}
            />
          </div>
        )}
        <SquadyUI onToggleRecording={record} />
      </div>

      {/* 实时响应速度监控显示 */}
      <div className={styles.performanceMonitor}>
        <h4>实时响应监控</h4>
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
            <span className={styles.metricLabel}>计时状态</span>
            <span className={`${styles.metricValue} ${responseMetrics.isTimingActive ? styles.timing : ''}`}>
              {responseMetrics.isTimingActive ? '计时中...' : '待机'}
            </span>
          </div>
        </div>

        {/* 响应时间趋势图 */}
        {responseMetrics.audioResponseTimes.length > 1 && (
          <div className={styles.responseTrend}>
            <div className={styles.trendLabel}>音频响应延迟趋势（最近10次）</div>
            <div className={styles.trendBars}>
              {responseMetrics.audioResponseTimes.slice(-10).map((time, index) => (
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
              <span>最快: {Math.min(...responseMetrics.audioResponseTimes).toFixed(0)}ms</span>
              <span>最慢: {Math.max(...responseMetrics.audioResponseTimes).toFixed(0)}ms</span>
            </div>
          </div>
        )}
      </div>


      {/* 服务器文本响应显示区域 */}
      <div className={styles.responseTextDisplay}>
        {currentText || finalTexts[0] || ''}
      </div>
    </div>
  )
}

interface SquadyUIProps {
  onToggleRecording: () => void;
}

const SquadyUI: React.FC<SquadyUIProps> = ({ onToggleRecording }) => {
  const text = 'Squady'
  return (
    <div className={styles.squadyUIContainer}>
      <WebSocketStatusMonitor realTime={realTime} />
      <div
        className={styles.squadyUI}
        onClick={onToggleRecording}
      >
        <img src={squadyLogo} alt="squady" />
      </div>
      <div className={styles.squadyUIText}>
        <div>{text}</div>
        <StatusPoint />
      </div>
    </div>
  )
}