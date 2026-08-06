import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RealTime } from '../RealTime';
import {
  GLASSES_RESPONSE_DEADLINE_MS,
  classifyGlassesDeadlineSignal,
} from '../app/glassesResponseDeadline';
import {
  SIGNAL_MONITOR_EVENT,
  type SignalMonitorFrame,
} from '../sdk/protocol/SignalMonitor';
import { globalLogger as logger } from '../sdk/utils/GlobalLogger';

const STORAGE_KEY = 'realtime.glasses-response-deadline-enabled';

export type GlassesDeadlineStatus =
  | 'disabled'
  | 'idle'
  | 'waiting'
  | 'answered'
  | 'timed_out';

export interface GlassesDeadlineSnapshot {
  enabled: boolean;
  status: GlassesDeadlineStatus;
  requestType?: string;
  responseType?: string;
  elapsedMs?: number;
  remainingMs?: number;
}

interface ActiveDeadline {
  generation: number;
  requestType: string;
  startedAt: number;
}

interface UseGlassesResponseDeadlineOptions {
  realTimeRef: MutableRefObject<RealTime | undefined>;
}

const readInitialEnabled = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const idleSnapshot = (enabled: boolean): GlassesDeadlineSnapshot => ({
  enabled,
  status: enabled ? 'idle' : 'disabled',
});

export const useGlassesResponseDeadline = ({
  realTimeRef,
}: UseGlassesResponseDeadlineOptions) => {
  const [enabled, setEnabledState] = useState(readInitialEnabled);
  const [snapshot, setSnapshot] = useState<GlassesDeadlineSnapshot>(() => idleSnapshot(enabled));
  const activeRef = useRef<ActiveDeadline | null>(null);
  const generationRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const tickerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    clearTimers();
    activeRef.current = null;
    setSnapshot(idleSnapshot(nextEnabled));
    try {
      localStorage.setItem(STORAGE_KEY, nextEnabled ? '1' : '0');
    } catch {
      // The simulator still works for this page when storage is unavailable.
    }
    setEnabledState(nextEnabled);
  }, [clearTimers]);

  useEffect(() => {
    clearTimers();
    activeRef.current = null;

    if (!enabled) return undefined;

    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
    if (!voiceChatCore) return undefined;

    const startDeadline = (frame: SignalMonitorFrame) => {
      clearTimers();
      const active: ActiveDeadline = {
        generation: ++generationRef.current,
        requestType: frame.type,
        startedAt: performance.now(),
      };
      activeRef.current = active;
      setSnapshot({
        enabled: true,
        status: 'waiting',
        requestType: active.requestType,
        elapsedMs: 0,
        remainingMs: GLASSES_RESPONSE_DEADLINE_MS,
      });

      logger.info('[GLASSES 10S] request started', {
        requestType: active.requestType,
        sessionId: frame.sessionId,
      });

      tickerRef.current = window.setInterval(() => {
        if (activeRef.current?.generation !== active.generation) return;
        const elapsedMs = performance.now() - active.startedAt;
        setSnapshot({
          enabled: true,
          status: 'waiting',
          requestType: active.requestType,
          elapsedMs,
          remainingMs: Math.max(0, GLASSES_RESPONSE_DEADLINE_MS - elapsedMs),
        });
      }, 100);

      timeoutRef.current = window.setTimeout(() => {
        if (activeRef.current?.generation !== active.generation) return;
        clearTimers();
        activeRef.current = null;
        setSnapshot({
          enabled: true,
          status: 'timed_out',
          requestType: active.requestType,
          elapsedMs: GLASSES_RESPONSE_DEADLINE_MS,
          remainingMs: 0,
        });
        logger.error('[GLASSES 10S] first audio timeout; disconnecting', {
          requestType: active.requestType,
          deadlineMs: GLASSES_RESPONSE_DEADLINE_MS,
        });
        voiceChatCore.disconnect();
      }, GLASSES_RESPONSE_DEADLINE_MS);
    };

    const completeDeadline = (frame: SignalMonitorFrame) => {
      const active = activeRef.current;
      if (!active) return;
      const elapsedMs = performance.now() - active.startedAt;
      clearTimers();
      activeRef.current = null;
      setSnapshot({
        enabled: true,
        status: 'answered',
        requestType: active.requestType,
        responseType: frame.type,
        elapsedMs,
        remainingMs: Math.max(0, GLASSES_RESPONSE_DEADLINE_MS - elapsedMs),
      });
      logger.info('[GLASSES 10S] first audio received', {
        requestType: active.requestType,
        responseType: frame.type,
        elapsedMs,
      });
    };

    const handleSignalFrame = (frame: SignalMonitorFrame) => {
      const signal = classifyGlassesDeadlineSignal(frame);
      if (signal?.kind === 'request') {
        startDeadline(frame);
      } else if (signal?.kind === 'first_audio') {
        completeDeadline(frame);
      }
    };

    voiceChatCore.on(SIGNAL_MONITOR_EVENT, handleSignalFrame);

    return () => {
      voiceChatCore.off(SIGNAL_MONITOR_EVENT, handleSignalFrame);
      clearTimers();
      activeRef.current = null;
    };
  }, [clearTimers, enabled, realTimeRef]);

  return {
    setEnabled,
    snapshot,
  };
};
