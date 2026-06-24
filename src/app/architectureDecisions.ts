import { DEFAULT_WEBSOCKET_URL } from '../sdk/types/protocol';

// Repo decision log:
// App.tsx is the composition root for browser/runtime wiring only.
// Feature UI should live in src/components/* and receive explicit props.
// SDK protocol/audio classes remain behavior owners for transport and media details.
// These constants stay here so product/runtime choices are visible in code review.

export const VOICE_PRESET_STORAGE_KEY = 'voice_preset';
export const LEGACY_USE_CUSTOM_VOICE_STORAGE_KEY = 'use_custom_voice';
export const DEFAULT_VOICE_ID = 'zh_female_wanwanxiaohe_moon_bigtts';
export const CUSTOM_VOICE_ID = 'ttv-voice-2025120918423925-Ktg6miPT';
export const LOCKED_SESSION_ID_STORAGE_KEY = 'locked_session_id';

export type VoicePreset = 'default' | 'soft';

export interface VoiceSettingPayload extends Record<string, unknown> {
  voice_id: string;
  speed: number;
  pitch: number;
  vol: number;
}

export const voiceSettingForPreset = (preset: VoicePreset): VoiceSettingPayload => ({
  // Decision: default preset is an explicit session voice_setting. Omitting
  // voice_setting means "do not change voice" for same-session hot updates.
  voice_id: preset === 'soft' ? CUSTOM_VOICE_ID : DEFAULT_VOICE_ID,
  speed: 1.0,
  pitch: 0,
  vol: 1.0,
});

export const WS_PRESETS = [
  { id: 'default', label: 'Default', url: DEFAULT_WEBSOCKET_URL },
  { id: '27', label: '27(wss)', url: 'wss://port1.luxhub.top:2097/ws' },
  { id: '28', label: '28(wss)', url: 'wss://port2.luxhub.top:2097/ws' },
  { id: '29', label: '29(wss)', url: 'wss://agent-en.vkcto.com:9440/ws' },
  { id: '30', label: '30(wss)', url: 'wss://agent-zh-dm.vkcto.com:9441/ws' },
  { id: 'custom', label: '自定义', url: '' },
] as const;

export type WsPreset = typeof WS_PRESETS[number];
export type WsPresetId = WsPreset['id'];

export interface SessionStatus {
  connected: boolean;
  sessionCreated: boolean;
}

export interface ResponseMetrics {
  audioResponseTimes: number[];
  averageAudioLatency: number;
  totalInteractions: number;
  lastAudioLatency: number;
  isTimingActive: boolean;
}

export const createEmptyResponseMetrics = (): ResponseMetrics => ({
  audioResponseTimes: [],
  averageAudioLatency: 0,
  totalInteractions: 0,
  lastAudioLatency: 0,
  isTimingActive: false,
});
