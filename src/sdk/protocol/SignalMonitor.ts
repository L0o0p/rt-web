export const SIGNAL_MONITOR_EVENT = 'signal:frame';
export const SIGNAL_SIDEBAR_MAX_ROWS = 80;

export type SignalDirection = 'up' | 'down';
export type SignalTransport = 'json' | 'binary';

export interface SignalMonitorFrame {
  direction: SignalDirection;
  transport: SignalTransport;
  type: string;
  protocolId?: number;
  protocolName?: string;
  commandId?: number;
  commandName?: string;
  sessionId?: string;
  bytes?: number;
  audioSignal?: boolean;
  summary?: string;
}

const AUDIO_SIGNAL_TYPES = new Set([
  'audio_chunk',
  'binary_audio_delta',
  'response.audio.delta',
]);

export const isAudioSignalType = (type: string): boolean => AUDIO_SIGNAL_TYPES.has(type);

// Decision: audio frames are high-frequency transport signals. The UI keeps
// them in the same signal stream, but collapses consecutive audio packet runs
// into one row with a packet count instead of rendering one row per chunk.
