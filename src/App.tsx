import { useState, useEffect, useRef } from 'react'
import styles from './example.module.scss'
import { RealTime } from './sdk'
import { AudioManager } from './sdk/audio/AudioManager';
import { createTextDataMessageExample, createSessionConfigMessageExample } from './sdk/protocol/ProtocolExample.js'

// 在组件外部创建RealTime实例，确保在整个应用生命周期中保持一致
const realTime = new RealTime()

function App() {
  const [speaking, setSpeaking] = useState(false)
  const [vadThreshold, setVadThreshold] = useState(0.5);
  const [isRecording, setIsRecording] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [speechSegmentCount, setSpeechSegmentCount] = useState(0);

  // VAD音频片段存储
  const speechSegmentsRef = useRef<Float32Array[]>([]);
  const currentSpeechDataRef = useRef<Float32Array[]>([]);
  const isCollectingRef = useRef<boolean>(false);
  
  // 音频数据缓冲区
  const audioDataBufferRef = useRef<Float32Array[]>([]);
  const recordedAudioDataRef = useRef<any[]>([]);
  
  // 传输定时器
  const transmissionTimerRef = useRef<number | null>(null);

  // 获取RealTime实例中的AudioManager
  const audioManagerRef = useRef<AudioManager | null>(null);

  useEffect(() => {
    // 获取RealTime实例中的AudioManager
    audioManagerRef.current = realTime.getAudioManager();

    // 设置事件监听器
    audioManagerRef.current.on('speech:start', () => {
      console.log('========== HUMAN VOICE DETECTED - SPEECH STARTED ==========');
      setSpeechDetected(true);
      // 开始外部收集音频数据
      isCollectingRef.current = true;
      currentSpeechDataRef.current = [];
      console.log('[APP EXTERNAL] Started collecting speech data externally');
    });

    audioManagerRef.current.on('speech:end', (speechAudio) => {
      console.log('========== HUMAN VOICE DETECTED - SPEECH ENDED ==========');
      console.log('[APP VAD] Speech ended event received, audio length:', speechAudio.length);

      // 停止外部收集
      isCollectingRef.current = false;

      // 合并外部收集的数据
      const externalCollectedAudio = combineCollectedAudio();
      console.log('[APP EXTERNAL] External collection ended, collected audio length:', externalCollectedAudio.length);

      // 优先使用外部收集的数据，如果为空则使用VAD库提供的数据
      const finalAudio = externalCollectedAudio.length > 0 ? externalCollectedAudio : speechAudio;
      console.log('[APP EXTERNAL] Final audio length:', finalAudio.length);

      if (finalAudio.length > 0) {
        // 将语音片段添加到存储中
        speechSegmentsRef.current.push(finalAudio);
        setSpeechSegmentCount(speechSegmentsRef.current.length); // 更新状态触发重新渲染
        console.log('[APP VAD] Stored speech segment, total segments:', speechSegmentsRef.current.length);
        console.log('[APP VAD] Speech segment duration (approx):', (finalAudio.length / 16000).toFixed(2), 'seconds');
      } else {
        console.warn('[APP VAD] Received empty speech audio data from both sources');
      }

      setSpeechDetected(false);
    });

    // 监听原始音频数据，用于外部收集
    audioManagerRef.current.on('audio:data', (audioData) => {
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
        console.log('[APP EXTERNAL] Collected audio chunk, total chunks:', currentSpeechDataRef.current.length);
        
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
    audioManagerRef.current.on('error', (error) => {
      console.error('[APP] AudioManager error:', error);
    });

    // 监听VAD配置变化
    audioManagerRef.current.on('vad:enabled', (enabled) => {
      console.log('[APP] VAD enabled state changed:', enabled);
    });

    audioManagerRef.current.on('vad:threshold', (threshold) => {
      console.log('[APP] VAD threshold changed:', threshold);
    });

    // 注意：我们不再在清理函数中调用destroy方法，
    // 因为这个AudioManager实例是由RealTime管理的
    return () => {
      // 清理事件监听器
      audioManagerRef.current?.removeAllListeners();
      
      // 停止音频传输
      stopAudioTransmission();
    };
  }, []);

  const connect = () => {
    realTime.connectToServer()
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
    console.log('speaking?', newSpeaking);
  }

  const play = () => {
    realTime.playRecordedAudio(recordedAudioDataRef.current)
  }

  // 音频传输控制
  const startAudioTransmission = () => {
    if (transmissionTimerRef.current) {
      return;
    }
    
    // 计时分片传输
    transmissionTimerRef.current = window.setInterval(async () => {
      await realTime.transmitAudioData(audioDataBufferRef.current);
    }, 100); // 使用固定的100ms间隔
  };
  
  const stopAudioTransmission = () => {
    if (transmissionTimerRef.current) {
      window.clearInterval(transmissionTimerRef.current);
      transmissionTimerRef.current = null;
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

    console.log(`[APP EXTERNAL] Combined ${currentSpeechDataRef.current.length} chunks into ${totalLength} samples`);
    return combined;
  }

  // 播放VAD收集的语音片段
  const playVadAudio = () => {
    console.log(`[PLAY VAD] Current segments count: ${speechSegmentsRef.current.length}`);
    console.log(`[PLAY VAD] Segments details:`, speechSegmentsRef.current.map((seg, i) => `Segment ${i}: ${seg.length} samples`));

    if (speechSegmentsRef.current.length === 0) {
      console.log('没有VAD收集的语音片段可播放');
      return;
    }

    console.log(`播放VAD收集的语音片段，共 ${speechSegmentsRef.current.length} 段`);

    // 合并所有语音片段
    const totalLength = speechSegmentsRef.current.reduce((sum, segment) => sum + segment.length, 0);
    console.log(`[PLAY VAD] Total length: ${totalLength} samples`);

    const combinedAudio = new Float32Array(totalLength);
    let offset = 0;

    for (const segment of speechSegmentsRef.current) {
      console.log(`[PLAY VAD] Adding segment of length ${segment.length} at offset ${offset}`);
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

    console.log(`播放VAD音频，总时长: ${(combinedAudio.length / 16000).toFixed(2)} 秒`);
  }

  // 运行协议测试
  const runProtocolTest = () => {
    console.log("=== 运行协议测试 ===")

    // 创建文本数据消息
    const textMessage = createTextDataMessageExample()
    console.log("文本数据消息:")
    console.log(textMessage)

    // 创建会话配置消息
    const configMessage = createSessionConfigMessageExample()
    console.log("\n会话配置消息:")
    console.log(configMessage)

    console.log("\n=== 协议测试完成 ===")
  }


  // 设置VAD阈值
  const handleVadThresholdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newThreshold = parseFloat(event.target.value);
    console.log("[APP] VAD threshold changed to:", newThreshold);
    setVadThreshold(newThreshold);
    audioManagerRef.current?.configure({ threshold: newThreshold });
  };

  // 开始/停止VAD音频处理
  const toggleVadProcessing = async () => {
    console.log("toggleVadProcessing called, isRecording:", isRecording);
    if (!audioManagerRef.current) {
      console.log("No audioManagerRef, returning");
      return;
    }

    if (!isRecording) {
      console.log("[APP] Starting VAD processing");

      // 清空之前的语音片段
      speechSegmentsRef.current = [];
      setSpeechSegmentCount(0);
      console.log("[APP] Cleared previous speech segments");

      try {
        // 配置并启动AudioManager
        await audioManagerRef.current
          .configure({
            enabled: true,
            threshold: vadThreshold,
            loopback: true
          })
          .start();

        console.log("[APP] VAD audio processing started");
        setIsRecording(true);

      } catch (error) {
        console.error("[APP] Failed to start VAD processing:", error);
      }
    } else {
      console.log("[APP] Stopping VAD processing");

      try {
        // 停止并禁用AudioManager
        await audioManagerRef.current
          .stop()
          .then(manager => manager.configure({ enabled: false }));

        console.log("[APP] VAD audio processing stopped");
        setIsRecording(false);
        setSpeechDetected(false);

      } catch (error) {
        console.error("[APP] Failed to stop VAD processing:", error);
      }
    }
  };

  return (
    <>
      <div className={styles.container}>
        <h1>Audio Manager Demo</h1>

        {/* 原有的按钮 */}
        <button className={styles.connect} onClick={connect}>connect</button>
        <button className={speaking ? styles.stop : styles.speak} onClick={speak}>speak</button>
        <button className={styles.play} onClick={play}>播放录音</button>
        <button className={styles.play} onClick={playVadAudio}>播放VAD音频</button>
        <button onClick={runProtocolTest}>运行协议测试</button>

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

        {/* 录音指示器 */}
        <div>
          <h3>录音状态:</h3>
          <p>录音中: {isRecording ? '是' : '否'}</p>
          <p>检测到语音: {speechDetected ? '是' : '否'}</p>
          <p>VAD收集的语音片段: {speechSegmentCount} 段</p>
        </div>
      </div>
    </>
  )
}

export default App




