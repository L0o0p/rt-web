import { useState, useEffect, useRef } from 'react'
import styles from './example.module.scss'
import { RealTime } from './RealTime'
import type { AudioManager } from './sdk/audio/AudioManager';
import { AudioPlayer } from './sdk/audio/AudioPlayer';
import { audioProcessor } from './sdk/audio/AudioCodec';
import { base64ToUint8Array } from './sdk/audio/AudioUtils';
import type { AudioChunkPayload, ResponseAudioDeltaEvent, OutputAudioBufferStartedEvent, ResponseAudioDoneEvent } from './sdk/protocol/ClientProtocol';

// 在组件外部创建RealTime实例，确保在整个应用生命周期中保持一致
const realTime = new RealTime()

function App() {
  const [speaking, setSpeaking] = useState(false)
  const [vadThreshold, setVadThreshold] = useState(0.5);
  const [isRecording, setIsRecording] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [speechSegmentCount, setSpeechSegmentCount] = useState(0);
  const [isPlayingDownstreamAudio, setIsPlayingDownstreamAudio] = useState(false);
  
  // 会话配置状态
  const [sessionConfig, setSessionConfig] = useState({
    mode: 'vad',
    vad_threshold: 0.5,
    silence_duration_ms: 500,
    min_speech_duration_ms: 200,
    asr_language: 'zh',
    timezone: 'Asia/Shanghai',
    location: '中国',
    system_prompt: '你是一个语音AI助手...',
    enable_search: true,
    signal_only: true,
    text_done_signal_only: false,
    initial_burst_count: 10,
    initial_burst_delay_ms: 5,
    send_rate_multiplier: 1.0
  });

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


  // 获取RealTime实例中的AudioManager
  const audioManagerRef = useRef<AudioManager | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
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
      } else {
        // console.warn('[APP VAD] Received empty speech audio data from both sources');
      }

      setSpeechDetected(false);
    });

    // 监听原始音频数据，用于外部收集
    audioManagerRef.current.on('audio:data', (audioData: Float32Array) => {
      // 始终保存录制的音频数据用于回放
      if (speaking) {
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

      // 监听所有下行信令（参考 ClientProtocol.ts 中的服务端事件）
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
          // 专门处理音频增量：解码并播放
          if (eventName === 'response.audio.delta') {
            const evt = payload as ResponseAudioDeltaEvent;
            if (!evt || typeof evt.delta !== 'string') return;
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
    // 注意：我们不再在清理函数中调用destroy方法，
    // 因为这个AudioManager实例是由RealTime管理的
    return undefined;
  }, [isPlayingDownstreamAudio]);

  const connect = () => {
    realTime.connectToServer()
  }
  
  const startSession = () => {
    realTime.startSession(sessionConfig)
  }
  
  // 更新会话配置的处理函数
  const handleConfigChange = (field: string, value: string | boolean | number) => {
    setSessionConfig(prev => ({
      ...prev,
      [field]: value
    }))
  }
  const speak = () => {
    if (speaking) {
      realTime.stop();
      stopAudioTransmission();
    } else {
      // 清空之前录制的数据
      recordedAudioDataRef.current = [];
      audioDataBufferRef.current = [];

      realTime.speak();
      startAudioTransmission();
    }
    const newSpeaking = !speaking;
    setSpeaking(newSpeaking);
    // console.debug('speaking?', newSpeaking);
  }

  const play = () => {
    console.log('playRecordedAudio removed from RealTime; no-op');
  }

  // 音频传输控制
  const startAudioTransmission = () => {
    if (transmissionTimerRef.current) return;

    const TICK_MS = 50; // 更高精度，带漂移校正
    nextSendAtRef.current = performance.now();

    const tick = async () => {
      await realTime.transmitAudioData(audioDataBufferRef.current);
      const now = performance.now();
      const next = (nextSendAtRef.current ?? now) + TICK_MS;
      nextSendAtRef.current = next;
      const delay = Math.max(0, next - now);
      transmissionTimerRef.current = window.setTimeout(tick, delay);
    };

    transmissionTimerRef.current = window.setTimeout(tick, 0);
  };

  const stopAudioTransmission = () => {
    if (transmissionTimerRef.current) {
      window.clearTimeout(transmissionTimerRef.current);
      transmissionTimerRef.current = null;
    }
    nextSendAtRef.current = null;
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

  // 播放VAD收集的语音片段
  const playVadAudio = () => {
    // console.debug(`[PLAY VAD] Current segments count: ${speechSegmentsRef.current.length}`);
    // console.debug(`[PLAY VAD] Segments details:`, speechSegmentsRef.current.map((seg, i) => `Segment ${i}: ${seg.length} samples`));

    if (speechSegmentsRef.current.length === 0) {
      // console.log('没有VAD收集的语音片段可播放');
      return;
    }

    // console.debug(`播放VAD收集的语音片段，共 ${speechSegmentsRef.current.length} 段`);

    // 合并所有语音片段
    const totalLength = speechSegmentsRef.current.reduce((sum, segment) => sum + segment.length, 0);
    // console.debug(`[PLAY VAD] Total length: ${totalLength} samples`);

    const combinedAudio = new Float32Array(totalLength);
    let offset = 0;

    for (const segment of speechSegmentsRef.current) {
      // console.debug(`[PLAY VAD] Adding segment of length ${segment.length} at offset ${offset}`);
      combinedAudio.set(segment, offset);
      offset += segment.length;
    }

    // 播放合并后的音频
    const audioContext = new AudioContext();
    const buffer = audioContext.createBuffer(1, combinedAudio.length, 16000);
    buffer.copyToChannel(combinedAudio, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();

    // console.debug(`播放VAD音频，总时长: ${(combinedAudio.length / 16000).toFixed(2)} 秒`);
  }

  // 运行协议测试
  // const runProtocolTest = () => {
  //   console.log("=== 运行协议测试 ===")

  //   // 创建文本数据消息
  //   // const textMessage = createTextDataMessageExample()
  //   // console.log("文本数据消息:")
  //   // console.log(textMessage)

  //   // 创建会话配置消息
  //   // const configMessage = createSessionConfigMessageExample()
  //   // console.log("\n会话配置消息:")
  //   // console.log(configMessage)

  //   // console.log("\n=== 协议测试完成 ===")
  // }


  // 设置VAD阈值
  const handleVadThresholdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newThreshold = parseFloat(event.target.value);
    console.log("[APP] VAD threshold changed to:", newThreshold);
    setVadThreshold(newThreshold);
    audioManagerRef.current?.configure({ threshold: newThreshold });
  };

  // 开始/停止VAD音频处理
  const toggleVadProcessing = async () => {
    // console.debug("toggleVadProcessing called, isRecording:", isRecording);
    if (!audioManagerRef.current) {
      // console.debug("No audioManagerRef, returning");
      return;
    }

    if (!isRecording) {
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
            loopback: true,
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
        setIsRecording(true);

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
        setIsRecording(false);
        setSpeechDetected(false);

      } catch {
        // suppressed
      }
    }
  };

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

  return (
    <>
      <div className={styles.container}>
        <h1>Audio Manager Demo</h1>

        {/* 原有的按钮 */}
        <button className={styles.connect} onClick={connect}>connect</button>
        <button className={styles.connect} onClick={startSession}>开始会话</button>
        <button className={speaking ? styles.stop : styles.speak} onClick={speak}>speak</button>
        <button className={styles.play} onClick={play}>播放录音</button>
        <button className={styles.play} onClick={playVadAudio}>播放VAD音频</button>

        <hr />
        
        {/* 会话配置面板 */}
        <h2>会话配置</h2>
        
        <div>
          <label>
            VAD阈值:
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={sessionConfig.vad_threshold}
              onChange={(e) => handleConfigChange('vad_threshold', parseFloat(e.target.value))}
            />
          </label>
        </div>
        
        <div>
          <label>
            静默持续时间 (ms):
            <input
              type="number"
              value={sessionConfig.silence_duration_ms}
              onChange={(e) => handleConfigChange('silence_duration_ms', parseInt(e.target.value))}
            />
          </label>
        </div>
        
        <div>
          <label>
            最小语音持续时间 (ms):
            <input
              type="number"
              value={sessionConfig.min_speech_duration_ms}
              onChange={(e) => handleConfigChange('min_speech_duration_ms', parseInt(e.target.value))}
            />
          </label>
        </div>
        
        
        <div>
          <label>
            初始突发计数:
            <input
              type="number"
              value={sessionConfig.initial_burst_count}
              onChange={(e) => handleConfigChange('initial_burst_count', parseInt(e.target.value))}
            />
          </label>
        </div>
        
        <div>
          <label>
            初始突发延迟 (ms):
            <input
              type="number"
              value={sessionConfig.initial_burst_delay_ms}
              onChange={(e) => handleConfigChange('initial_burst_delay_ms', parseInt(e.target.value))}
            />
          </label>
        </div>
        
        <div>
          <label>
            发送速率乘数:
            <input
              type="number"
              step="0.1"
              value={sessionConfig.send_rate_multiplier}
              onChange={(e) => handleConfigChange('send_rate_multiplier', parseFloat(e.target.value))}
            />
          </label>
        </div>
        
        <div>
          <label>
            模式:
            <select
              value={sessionConfig.mode}
              onChange={(e) => handleConfigChange('mode', e.target.value)}
            >
              <option value="vad">VAD</option>
              <option value="continuous">连续</option>
              <option value="manual">手动</option>
            </select>
          </label>
        </div>
        
        <div>
          <label>
            ASR语言:
            <select
              value={sessionConfig.asr_language}
              onChange={(e) => handleConfigChange('asr_language', e.target.value)}
            >
              <option value="zh">中文</option>
              <option value="en">英文</option>
            </select>
          </label>
        </div>
        
        <div>
          <label>
            时区:
            <input
              type="text"
              value={sessionConfig.timezone}
              onChange={(e) => handleConfigChange('timezone', e.target.value)}
            />
          </label>
        </div>
        
        <div>
          <label>
            位置:
            <input
              type="text"
              value={sessionConfig.location}
              onChange={(e) => handleConfigChange('location', e.target.value)}
            />
          </label>
        </div>
        
        <div>
          <label>
            系统提示:
            <textarea
              value={sessionConfig.system_prompt}
              onChange={(e) => handleConfigChange('system_prompt', e.target.value)}
            />
          </label>
        </div>
        
        <div>
          <label>
            <input
              type="checkbox"
              checked={sessionConfig.enable_search}
              onChange={(e) => handleConfigChange('enable_search', e.target.checked)}
            />
            启用搜索
          </label>
        </div>
        
        <div>
          <label>
            <input
              type="checkbox"
              checked={sessionConfig.signal_only}
              onChange={(e) => handleConfigChange('signal_only', e.target.checked)}
            />
            仅信号模式
          </label>
        </div>
        
        <div>
          <label>
            <input
              type="checkbox"
              checked={sessionConfig.text_done_signal_only}
              onChange={(e) => handleConfigChange('text_done_signal_only', e.target.checked)}
            />
            文本完成仅信号
          </label>
        </div>
        
       
        <hr />
        
        {/* VAD控制面板 */}
        <h2>VAD 控制面板</h2>


        {/* VAD阈值滑块 */}
        <div>
          <label>
            VAD 阈值: {vadThreshold.toFixed(2)}
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={vadThreshold}
              onChange={handleVadThresholdChange}
            />
          </label>
        </div>

        {/* 开始/停止VAD音频处理按钮 */}
        <button onClick={toggleVadProcessing}>
          {isRecording ? '停止录音' : '开始录音'}
        </button>

        {/* 下行音频播放控制按钮 */}
        <button onClick={toggleDownstreamAudioPlayback}>
          {isPlayingDownstreamAudio ? '停止播放下行音频' : '开始播放下行音频'}
        </button>

        {/* 录音指示器 */}
        <div>
          <h3>录音状态:</h3>
          <p>录音中: {isRecording ? '是' : '否'}</p>
          <p>检测到语音: {speechDetected ? '是' : '否'}</p>
          <p>VAD收集的语音片段: {speechSegmentCount} 段</p>
          <p>播放下行音频: {isPlayingDownstreamAudio ? '是' : '否'}</p>
        </div>
      </div>
    </>
  )
}

export default App




