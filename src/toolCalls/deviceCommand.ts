export const DEVICE_COMMAND_ACTIONS = {
  wk_take_a_picture: 'take_photo',
  wk_take_a_record: 'take_record',
  wk_take_a_video: 'take_video',
  wk_increase_volume: 'volume_up',
  wk_reduce_volume: 'volume_down',
  wk_play_music: 'play_music',
  wk_previous_song: 'previous_song',
  wk_next_song: 'next_song',
  wk_stop_music: 'stop_music',
} as const;

export type DeviceCommand = keyof typeof DEVICE_COMMAND_ACTIONS;
export type DeviceCommandAction = typeof DEVICE_COMMAND_ACTIONS[DeviceCommand];

export interface ResolvedDeviceCommand {
  command: DeviceCommand;
  action: DeviceCommandAction;
  opensCamera: boolean;
}

export const resolveDeviceCommand = (parsedArgs: unknown): ResolvedDeviceCommand | undefined => {
  if (!parsedArgs || typeof parsedArgs !== 'object' || !('command' in parsedArgs)) {
    return undefined;
  }

  const command = parsedArgs.command;
  if (typeof command !== 'string' || !Object.hasOwn(DEVICE_COMMAND_ACTIONS, command)) {
    return undefined;
  }

  const typedCommand = command as DeviceCommand;
  return {
    command: typedCommand,
    action: DEVICE_COMMAND_ACTIONS[typedCommand],
    opensCamera: typedCommand === 'wk_take_a_picture',
  };
};
