import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useAtom } from 'jotai';
import { sessionCreatedAtom, wsConnectedAtom } from '../state';
import type { RealTime } from '../RealTime';
import type { VoiceChatCore } from '../sdk';
import type { SessionStatus } from '../app/architectureDecisions';

interface UseSessionStatusOptions {
  realTimeRef: MutableRefObject<RealTime | undefined>;
}

export const useSessionStatus = ({ realTimeRef }: UseSessionStatusOptions) => {
  const [, setIsWsConnected] = useAtom(wsConnectedAtom);
  const [, setIsSessionCreated] = useAtom(sessionCreatedAtom);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({
    connected: false,
    sessionCreated: false,
  });

  const updateSessionStatus = useCallback(() => {
    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
    if (!voiceChatCore) {
      console.log('[DEBUG] VoiceChatCore 实例不可用');
      return;
    }

    const nextStatus = {
      connected: voiceChatCore.isConnected,
      sessionCreated: voiceChatCore.isSessionCreated,
    };
    setSessionStatus(nextStatus);
    setIsSessionCreated(voiceChatCore.isSessionCreated);
    setCurrentSessionId(voiceChatCore.currentSessionId ?? '');
  }, [realTimeRef, setIsSessionCreated]);

  useEffect(() => {
    const voiceChatCore: VoiceChatCore | undefined = realTimeRef.current?.getVoiceChatCore();
    if (!voiceChatCore) return undefined;

    // Decision: session status is external runtime state, so this hook owns
    // both event-driven updates and the existing polling fallback.
    const handleOpen = () => {
      setIsWsConnected(true);
      updateSessionStatus();
    };
    const handleClose = () => {
      setIsWsConnected(false);
      updateSessionStatus();
    };
    const handleError = () => {
      updateSessionStatus();
    };
    const handleSessionCreated = () => {
      updateSessionStatus();
    };

    voiceChatCore.on('open', handleOpen);
    voiceChatCore.on('close', handleClose);
    voiceChatCore.on('error', handleError);
    voiceChatCore.on('session.created', handleSessionCreated);

    return () => {
      voiceChatCore.off('open', handleOpen);
      voiceChatCore.off('close', handleClose);
      voiceChatCore.off('error', handleError);
      voiceChatCore.off('session.created', handleSessionCreated);
    };
  }, [realTimeRef, setIsWsConnected, updateSessionStatus]);

  useEffect(() => {
    const interval = window.setInterval(updateSessionStatus, 1000);
    return () => window.clearInterval(interval);
  }, [updateSessionStatus]);

  return {
    currentSessionId,
    sessionStatus,
    updateSessionStatus,
  };
};
