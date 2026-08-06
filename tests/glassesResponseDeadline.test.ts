import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GLASSES_RESPONSE_DEADLINE_MS,
  classifyGlassesDeadlineSignal,
} from '../src/app/glassesResponseDeadline.ts';
import type { SignalMonitorFrame } from '../src/sdk/protocol/SignalMonitor.ts';

const frame = (direction: 'up' | 'down', type: string): SignalMonitorFrame => ({
  direction,
  transport: 'json',
  type,
});

test('uses the glasses ten-second deadline', () => {
  assert.equal(GLASSES_RESPONSE_DEADLINE_MS, 10_000);
});

test('starts a deadline only for outbound StopInput and ImageData', () => {
  assert.deepEqual(
    classifyGlassesDeadlineSignal(frame('up', 'input_audio_buffer.speech_stopped')),
    { kind: 'request', signalType: 'input_audio_buffer.speech_stopped' },
  );
  assert.deepEqual(
    classifyGlassesDeadlineSignal(frame('up', 'image_data')),
    { kind: 'request', signalType: 'image_data' },
  );
  assert.equal(
    classifyGlassesDeadlineSignal(frame('down', 'input_audio_buffer.speech_stopped')),
    undefined,
  );
});

test('accepts only first downstream audio as a response', () => {
  for (const type of ['audio_chunk', 'binary_audio_delta', 'response.audio.delta']) {
    assert.deepEqual(classifyGlassesDeadlineSignal(frame('down', type)), {
      kind: 'first_audio',
      signalType: type,
    });
  }

  for (const type of ['response.created', 'response.text.delta', 'response.text.done']) {
    assert.equal(classifyGlassesDeadlineSignal(frame('down', type)), undefined);
  }
  assert.equal(classifyGlassesDeadlineSignal(frame('up', 'binary_audio_delta')), undefined);
});
