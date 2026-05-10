import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AudioPlayer } from '../sdk/audio/AudioPlayer';

export const useDownstreamAudioPlayer = () => {
  const [isPlayingDownstreamAudio, setIsPlayingDownstreamAudio] = useState(false);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const isPlayingDownstreamAudioRef = useRef(isPlayingDownstreamAudio);

  useLayoutEffect(() => {
    isPlayingDownstreamAudioRef.current = isPlayingDownstreamAudio;
  }, [isPlayingDownstreamAudio]);

  const ensureAudioPlayer = useCallback(() => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new AudioPlayer();
    }
    return audioPlayerRef.current;
  }, []);

  const stopAndDisposeAudioPlayer = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stopPlayback();
      audioPlayerRef.current = null;
    }
  }, []);

  const enableDownstreamAudioPlayback = useCallback(() => {
    // Decision: keep downstream playback opt-in at runtime startup, matching
    // the previous App.tsx boot effect instead of changing the initial state.
    ensureAudioPlayer();
    setIsPlayingDownstreamAudio(true);
  }, [ensureAudioPlayer]);

  const toggleDownstreamAudioPlayback = useCallback(() => {
    setIsPlayingDownstreamAudio(prev => {
      const nextState = !prev;

      if (nextState) {
        ensureAudioPlayer();
      } else {
        stopAndDisposeAudioPlayer();
      }

      return nextState;
    });
  }, [ensureAudioPlayer, stopAndDisposeAudioPlayer]);

  useEffect(() => {
    if (isPlayingDownstreamAudio) {
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new AudioPlayer();
        console.log('[AUDIO] AudioPlayer 初始化完成');
      }
    } else if (audioPlayerRef.current) {
      audioPlayerRef.current.stopPlayback();
      audioPlayerRef.current = null;
      console.log('[AUDIO] AudioPlayer 已停止并清理');
    }
  }, [isPlayingDownstreamAudio]);

  return {
    audioPlayerRef,
    enableDownstreamAudioPlayback,
    isPlayingDownstreamAudio,
    isPlayingDownstreamAudioRef,
    toggleDownstreamAudioPlayback,
  };
};
