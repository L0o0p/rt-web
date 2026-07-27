import assert from 'node:assert/strict';
import test from 'node:test';

import { DEVICE_COMMAND_ACTIONS, resolveDeviceCommand } from '../src/toolCalls/deviceCommand.ts';

test('resolves all canonical device commands without collapsing them to photo', () => {
  const expected = Object.entries(DEVICE_COMMAND_ACTIONS);

  assert.equal(expected.length, 9);
  for (const [command, action] of expected) {
    assert.deepEqual(resolveDeviceCommand({ command }), {
      command,
      action,
      opensCamera: command === 'wk_take_a_picture',
    });
  }
});

test('volume commands never request the camera', () => {
  assert.equal(resolveDeviceCommand({ command: 'wk_increase_volume' })?.opensCamera, false);
  assert.equal(resolveDeviceCommand({ command: 'wk_reduce_volume' })?.opensCamera, false);
});

test('malformed and unknown commands fail closed', () => {
  assert.equal(resolveDeviceCommand(undefined), undefined);
  assert.equal(resolveDeviceCommand({}), undefined);
  assert.equal(resolveDeviceCommand({ command: 'volume_up' }), undefined);
  assert.equal(resolveDeviceCommand({ command: 'toString' }), undefined);
  assert.equal(resolveDeviceCommand({ command: 1 }), undefined);
});
