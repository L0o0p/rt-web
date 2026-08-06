import type { SignalMonitorFrame } from '../sdk/protocol/SignalMonitor';

export const GLASSES_RESPONSE_DEADLINE_MS = 10_000;

const REQUEST_SIGNAL_TYPES = new Set([
  'input_audio_buffer.speech_stopped',
  'image_data',
]);

const RESPONSE_SIGNAL_TYPES = new Set([
  'audio_chunk',
  'binary_audio_delta',
  'response.audio.delta',
]);

export type GlassesDeadlineSignal =
  | { kind: 'request'; signalType: string }
  | { kind: 'first_audio'; signalType: string };

export const classifyGlassesDeadlineSignal = (
  frame: SignalMonitorFrame,
): GlassesDeadlineSignal | undefined => {
  if (frame.direction === 'up' && REQUEST_SIGNAL_TYPES.has(frame.type)) {
    return { kind: 'request', signalType: frame.type };
  }

  if (frame.direction === 'down' && RESPONSE_SIGNAL_TYPES.has(frame.type)) {
    return { kind: 'first_audio', signalType: frame.type };
  }

  return undefined;
};
