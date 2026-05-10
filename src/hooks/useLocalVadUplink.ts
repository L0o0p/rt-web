import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useAtom } from 'jotai';
import type { RealTime } from '../RealTime';
import { isUserSpeakingAtom } from '../state';

interface UseLocalVadUplinkOptions {
  realTimeRef: MutableRefObject<RealTime | undefined>;
}

const VAD_THRESHOLD = 0.5;
const MIN_UPLINK_CHUNK_BYTES = 10;

export const useLocalVadUplink = ({ realTimeRef }: UseLocalVadUplinkOptions) => {
  const [isUserSpeaking, setIsUserSpeaking] = useAtom(isUserSpeakingAtom);
  const [talkHint, setTalkHint] = useState('');
  const audioStartTimeRef = useRef(0);

  const sendUplinkChunk = useCallback((chunk: Uint8Array) => {
    if (!chunk || chunk.length < MIN_UPLINK_CHUNK_BYTES) {
      return;
    }

    // Decision: this hook owns only local VAD/uplink transport. Server-side
    // timing still starts from downstream input_audio_buffer events in App.tsx.
    realTimeRef.current?.getVoiceChatCore()?.sendEncodedAudioData(chunk);
  }, [realTimeRef]);

  const toggleVadProcessing = useCallback(async () => {
    const audioManager = realTimeRef.current?.getAudioManager();
    if (!audioManager) {
      setTalkHint('音频未就绪，请稍等 1s 再试');
      return;
    }

    if (!isUserSpeaking) {
      audioStartTimeRef.current = Date.now();
      console.log('[APP] 音频开始时间记录:', audioStartTimeRef.current);

      try {
        await audioManager
          .configure({
            enabled: true,
            threshold: VAD_THRESHOLD,
            loopback: false,
            uplink: {
              onChunkProcessed: async (chunk: Uint8Array) => {
                sendUplinkChunk(chunk);
              },
            },
          })
          .start();

        setIsUserSpeaking(true);
        setTalkHint('');
      } catch (error) {
        console.error('[APP] 启动麦克风/对话失败:', error);
        setTalkHint('启动失败：请检查麦克风权限/HTTPS/静音模式');
      }
      return;
    }

    try {
      await audioManager
        .stop()
        .then(manager => manager.configure({ enabled: false }));

      setIsUserSpeaking(false);
      setTalkHint('');
    } catch (error) {
      console.error('[APP] Error stopping VAD processing:', error);
      setTalkHint('停止失败：请刷新重试');
    }
  }, [isUserSpeaking, realTimeRef, sendUplinkChunk, setIsUserSpeaking]);

  useEffect(() => {
    const audioManager = realTimeRef.current?.getAudioManager();
    if (!audioManager) return undefined;

    const handleSpeechEnd = () => {
      const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
      if (voiceChatCore?.isConnected && voiceChatCore?.isSessionCreated) {
        const audioEndMs = Date.now() - audioStartTimeRef.current;
        const eventId = `event_${Date.now()}`;
        const itemId = `msg_${Date.now().toString(36)}`;

        console.log('[APP] VAD检测到语音结束，发送stopInput:', {
          eventId,
          audioEndMs,
          itemId,
          sessionId: voiceChatCore.currentSessionId,
        });

        voiceChatCore.sendStopInput(eventId, audioEndMs, itemId, false);
        return;
      }

      console.warn('[APP] 无法发送stopInput: 连接状态或会话状态不满足条件', {
        isConnected: voiceChatCore?.isConnected,
        isSessionCreated: voiceChatCore?.isSessionCreated,
      });
    };

    audioManager.on('speech:end', handleSpeechEnd);

    return () => {
      audioManager.off('speech:end', handleSpeechEnd);
    };
  }, [realTimeRef]);

  return {
    isUserSpeaking,
    record: toggleVadProcessing,
    talkHint,
  };
};
