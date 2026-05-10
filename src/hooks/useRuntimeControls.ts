import { useCallback, useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RealTime } from '../RealTime';
import { DEFAULT_WEBSOCKET_URL } from '../sdk/types/protocol';
import { getRuntimeWebSocketUrl, setStoredWebSocketUrl } from '../sdk/config/runtimeConfig';
import {
  CUSTOM_VOICE_ID,
  LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY,
  VOICE_PRESET_STORAGE_KEY,
  WS_PRESETS,
  type VoicePreset,
  type WsPresetId,
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

export const useRuntimeControls = ({
  realTimeRef,
  resetPerformanceMonitor,
}: UseRuntimeControlsOptions) => {
  // Decision: derive persisted runtime config during initial render instead of
  // syncing state in an effect. This preserves boot behavior without a second render.
  const [initialWsConfig] = useState(getInitialWebSocketConfig);
  const [voicePreset, setVoicePreset] = useState<VoicePreset>(getInitialVoicePreset);
  const [wsPresetId, setWsPresetId] = useState<WsPresetId>(initialWsConfig.presetId);
  const [wsUrl, setWsUrl] = useState<string>(initialWsConfig.url);
  const [wsInput, setWsInput] = useState<string>(initialWsConfig.url);
  const [isSwitchingWs, setIsSwitchingWs] = useState(false);
  const [sessionIdInput, setSessionIdInput] = useState<string>('');

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

  const applySessionId = useCallback(() => {
    const trimmed = sessionIdInput.trim();
    if (!trimmed) return;

    const voiceChatCore = realTimeRef.current?.getVoiceChatCore();
    if (!voiceChatCore?.isConnected) {
      alert('WebSocket未连接，无法切换sessionId');
      return;
    }

    console.log('[SESSION] switch', { from: voiceChatCore.currentSessionId, to: trimmed });
    resetPerformanceMonitor('session_switch');
    voiceChatCore.getConnectionManager().recreateSession(trimmed);
    setSessionIdInput('');
  }, [realTimeRef, resetPerformanceMonitor, sessionIdInput]);

  const applyVoicePreset = useCallback((nextPreset: VoicePreset) => {
    setVoicePreset(nextPreset);
    try {
      localStorage.setItem(VOICE_PRESET_STORAGE_KEY, nextPreset);
      localStorage.setItem(LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY, nextPreset === 'soft' ? '1' : '0');
    } catch {
      // ignore
    }

    const voice_setting = nextPreset === 'soft'
      ? { voice_id: CUSTOM_VOICE_ID, speed: 1.0, pitch: 0, vol: 1.0 }
      : undefined;

    realTimeRef.current?.setSessionConfig?.({ voice_setting });

    const voiceChatCore = realTimeRef.current?.getVoiceChatCore?.();
    if (voiceChatCore?.isConnected) {
      voiceChatCore.startNewSession?.({ voice_setting });
    }
  }, [realTimeRef]);

  return {
    applySessionId,
    applyVoicePreset,
    applyWebSocketUrl,
    isSwitchingWs,
    sessionIdInput,
    setSessionIdInput,
    setWsInput,
    setWsPresetId,
    voicePreset,
    wsInput,
    wsPresetId,
    wsUrl,
  };
};
