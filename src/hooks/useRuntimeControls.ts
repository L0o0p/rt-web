import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RealTime } from '../RealTime';
import { BINARY_MESSAGE } from '../sdk/protocol/ClientProtocol';
import { DEFAULT_WEBSOCKET_URL } from '../sdk/types/protocol';
import { getRuntimeWebSocketUrl, setStoredWebSocketUrl } from '../sdk/config/runtimeConfig';
import {
  LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY,
  LOCKED_SESSION_ID_STORAGE_KEY,
  DEFAULT_SESSION_LOCATION,
  VOICE_PRESET_STORAGE_KEY,
  WS_PRESETS,
  type VoicePreset,
  type WsPresetId,
  voiceSettingForPreset,
} from '../app/architectureDecisions';

interface UseRuntimeControlsOptions {
  realTimeRef: MutableRefObject<RealTime | undefined>;
  resetPerformanceMonitor: (reason: string) => void;
}

const getInitialVoicePreset = (): VoicePreset => {
  try {
    const preset = localStorage.getItem(VOICE_PRESET_STORAGE_KEY) as VoicePreset | null;
    if (preset === 'default' || preset === 'soft') return preset;
    const legacy = localStorage.getItem(LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY);
    return (legacy === '1' || legacy === 'true') ? 'soft' : 'default';
  } catch {
    return 'default';
  }
};

const getInitialWebSocketConfig = () => {
  const current = getRuntimeWebSocketUrl(DEFAULT_WEBSOCKET_URL);
  const matched = WS_PRESETS.find((preset) => preset.url && preset.url === current);

  return {
    matched,
    presetId: (matched?.id ?? 'custom') as WsPresetId,
    url: current,
  };
};

const getInitialLockedSessionId = (): string | undefined => {
  try {
    const stored = localStorage.getItem(LOCKED_SESSION_ID_STORAGE_KEY)?.trim();
    if (!stored) return undefined;
    if (stored.length === BINARY_MESSAGE.NANOID_SIZE) return stored;
    localStorage.removeItem(LOCKED_SESSION_ID_STORAGE_KEY);
  } catch {
    // ignore
  }
  return undefined;
};

const persistLockedSessionId = (sessionId: string): void => {
  try {
    localStorage.setItem(LOCKED_SESSION_ID_STORAGE_KEY, sessionId);
  } catch {
    // Runtime lock still works for this page even if persistence is unavailable.
  }
};

export const useRuntimeControls = ({
  realTimeRef,
  resetPerformanceMonitor,
}: UseRuntimeControlsOptions) => {
  // Decision: derive persisted runtime config during initial render instead of
  // syncing state in an effect. This preserves boot behavior without a second render.
  const [initialWsConfig] = useState(getInitialWebSocketConfig);
  const [initialLockedSessionId] = useState(getInitialLockedSessionId);
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(getInitialVoicePreset);
  const [wsPresetId, setWsPresetId] = useState<WsPresetId>(initialWsConfig.presetId);
  const [wsUrl, setWsUrl] = useState<string>(initialWsConfig.url);
  const [wsInput, setWsInput] = useState<string>(initialWsConfig.url);
  const [isSwitchingWs, setIsSwitchingWs] = useState(false);
  const [sessionIdInput, setSessionIdInput] = useState<string>(initialLockedSessionId ?? '');
  const [sessionLocationInput, setSessionLocationInput] = useState<string>(DEFAULT_SESSION_LOCATION);
  const [isSessionIdLocked, setIsSessionIdLocked] = useState(Boolean(initialLockedSessionId));

  useEffect(() => {
    console.log('[WS CONFIG] boot', {
      presetId: initialWsConfig.presetId,
      presetLabel: initialWsConfig.matched?.label ?? '自定义',
      url: initialWsConfig.url,
    });
  }, [initialWsConfig]);

  const applyWebSocketUrl = useCallback(async (nextUrl: string, presetId?: WsPresetId) => {
    const trimmed = nextUrl.trim();
    if (!trimmed) return;

    const prevUrl = getRuntimeWebSocketUrl(DEFAULT_WEBSOCKET_URL);
    const presetLabel = presetId ? (WS_PRESETS.find((preset) => preset.id === presetId)?.label ?? presetId) : '(unknown)';

    console.log('[WS CONFIG] switch:start', { presetId: presetId ?? null, presetLabel, from: prevUrl, to: trimmed });

    // 切换环境时：重置性能监控，避免旧连接的数据污染新环境统计。
    resetPerformanceMonitor('ws_switch');

    setStoredWebSocketUrl(trimmed);
    setWsUrl(trimmed);
    setWsInput(trimmed);

    // Decision: switching WS endpoint is a full app restart. Runtime config is persisted
    // before reload so RealTime/VoiceChatCore boot against the same endpoint.
    setIsSwitchingWs(true);
    console.log('[WS CONFIG] switch:reload', { presetId: presetId ?? null, presetLabel, url: trimmed });
    window.location.reload();
  }, [resetPerformanceMonitor]);

  const validateSessionId = useCallback((value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length !== BINARY_MESSAGE.NANOID_SIZE) {
      alert(`sessionId 必须是 ${BINARY_MESSAGE.NANOID_SIZE} 个字符`);
      return null;
    }
    return trimmed;
  }, []);

  const applySessionId = useCallback(() => {
    const trimmed = validateSessionId(sessionIdInput);
    if (!trimmed) return;

    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
    if (isSessionIdLocked) {
      try {
        const lockedSessionId = voiceChatCore?.lockSessionId(trimmed) ?? trimmed;
        persistLockedSessionId(lockedSessionId);
        setSessionIdInput(lockedSessionId);
        console.log('[SESSION] lock:apply', { sessionId: lockedSessionId });
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (!voiceChatCore?.isConnected) {
      if (isSessionIdLocked) {
        return;
      }
      alert('WebSocket未连接，无法切换sessionId');
      return;
    }

    console.log('[SESSION] switch', { from: voiceChatCore.currentSessionId, to: trimmed });
    resetPerformanceMonitor('session_switch');
    voiceChatCore.getConnectionManager().recreateSession(trimmed);
    if (!isSessionIdLocked) {
      setSessionIdInput('');
    }
  }, [isSessionIdLocked, realTimeRef, resetPerformanceMonitor, sessionIdInput, validateSessionId]);

  const setSessionIdLock = useCallback((nextLocked: boolean) => {
    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();

    if (!nextLocked) {
      voiceChatCore?.unlockSessionId();
      try {
        localStorage.removeItem(LOCKED_SESSION_ID_STORAGE_KEY);
      } catch {
        // ignore
      }
      setIsSessionIdLocked(false);
      console.log('[SESSION] lock:off');
      return;
    }

    const candidate = sessionIdInput.trim() || voiceChatCore?.currentSessionId || '';
    if (!candidate.trim()) {
      alert('先输入 sessionId，或等待当前 session 创建后再锁定');
      return;
    }
    const trimmed = validateSessionId(candidate);
    if (!trimmed) return;

    try {
      const lockedSessionId = voiceChatCore?.lockSessionId(trimmed) ?? trimmed;
      persistLockedSessionId(lockedSessionId);
      setIsSessionIdLocked(true);
      setSessionIdInput(lockedSessionId);
      console.log('[SESSION] lock:on', { sessionId: lockedSessionId });

      if (voiceChatCore?.isConnected) {
        resetPerformanceMonitor('session_lock');
        voiceChatCore.getConnectionManager().recreateSession(lockedSessionId);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }, [realTimeRef, resetPerformanceMonitor, sessionIdInput, validateSessionId]);

  const applyVoicePreset = useCallback((nextPreset: VoicePreset) => {
    setVoicePreset(nextPreset);
    try {
      localStorage.setItem(VOICE_PRESET_STORAGE_KEY, nextPreset);
      localStorage.setItem(LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY, nextPreset === 'soft' ? '1' : '0');
    } catch {
      // ignore
    }

    const voice_setting = voiceSettingForPreset(nextPreset);

    // Decision: voice preset changes are same-session session_config updates.
    // setSessionConfig persists the default and resends session_config when connected.
    realTimeRef.current?.setSessionConfig?.({ voice_setting });
  }, [realTimeRef]);

  const applySessionLocation = useCallback(() => {
    const location = sessionLocationInput.trim();
    if (!location) {
      alert('请输入经纬度，例如 22.657,114.016');
      return;
    }

    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
    setSessionLocationInput(location);
    voiceChatCore?.getConnectionManager().setDefaultSessionConfig({ location });

    if (voiceChatCore?.isConnected) {
      if (voiceChatCore.isSessionIdLocked) {
        voiceChatCore.unlockSessionId();
        try {
          localStorage.removeItem(LOCKED_SESSION_ID_STORAGE_KEY);
        } catch {
          // ignore
        }
        setIsSessionIdLocked(false);
        setSessionIdInput('');
      }

      resetPerformanceMonitor('location_switch');
      realTimeRef.current?.startNewSession?.({ location });
    }

    console.log('[SESSION] location:update', { location });
  }, [realTimeRef, resetPerformanceMonitor, sessionLocationInput]);

  return {
    applySessionLocation,
    applySessionId,
    applyVoicePreset,
    applyWebSocketUrl,
    isSessionIdLocked,
    isSwitchingWs,
    sessionIdInput,
    sessionLocationInput,
    setSessionIdLock,
    setSessionIdInput,
    setSessionLocationInput,
    setWsInput,
    setWsPresetId,
    voicePreset,
    wsInput,
    wsPresetId,
    wsUrl,
  };
};
