import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { RealTime } from '../RealTime';
import type { Reminder, ReminderArguments } from '../types/reminder';

interface PendingVisualQa {
  callId: string;
  question: string;
}

interface FunctionCallPayload {
  arguments?: string;
  call_id?: unknown;
  function?: {
    name?: unknown;
  };
  function_name?: unknown;
  name?: unknown;
}

interface UseToolCallHandlerOptions {
  handleReminderCall: (args: ReminderArguments) => Reminder;
  openCamera: (options?: { autoCapture?: boolean }) => Promise<void>;
  realTimeRef: MutableRefObject<RealTime | undefined>;
  setPendingVisualQa: (pending: PendingVisualQa) => void;
}

const parseFunctionArgs = (payload: FunctionCallPayload): unknown => {
  try {
    return JSON.parse(payload.arguments || '{}');
  } catch {
    return undefined;
  }
};

const getFunctionName = (payload: FunctionCallPayload): string | undefined => {
  const name = payload.function_name || payload.function?.name || payload.name;
  return typeof name === 'string' ? name : undefined;
};

const getCallId = (payload: FunctionCallPayload): string | undefined => {
  return typeof payload.call_id === 'string' && payload.call_id.length > 0
    ? payload.call_id
    : undefined;
};

const getConnectionManager = (realTimeRef: MutableRefObject<RealTime | undefined>) => {
  return realTimeRef.current?.getVoiceChatCore()?.getConnectionManager() as
    | { sendFunctionCallOutput?: (callId: string, output: unknown, options?: unknown) => void }
    | undefined;
};

const queryBrowserBattery = async () => {
  const batteryNavigator = navigator as Navigator & {
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      chargingTime: number;
      dischargingTime: number;
    }>;
  };

  if (typeof batteryNavigator.getBattery !== 'function') {
    throw new Error('当前浏览器不支持电量查询');
  }

  const battery = await batteryNavigator.getBattery();
  const levelRatio = Number.isFinite(battery.level) ? battery.level : 0;
  const levelPercent = Math.round(Math.max(0, Math.min(1, levelRatio)) * 100);
  const normalizeTime = (seconds: number) => Number.isFinite(seconds) ? seconds : null;

  return {
    level: levelPercent,
    levelRatio,
    charging: battery.charging,
    chargingTimeSeconds: normalizeTime(battery.chargingTime),
    dischargingTimeSeconds: normalizeTime(battery.dischargingTime),
  };
};

const getVisualQaQuestion = (parsedArgs: unknown): string => {
  if (
    parsedArgs &&
    typeof parsedArgs === 'object' &&
    'question' in parsedArgs &&
    typeof parsedArgs.question === 'string' &&
    parsedArgs.question.trim().length > 0
  ) {
    return parsedArgs.question.trim();
  }

  return '请描述我面前有什么';
};

const isTakePhotoIntent = (fnName: string | undefined, callId: string | undefined, argsStr: string): boolean => {
  return fnName === 'take_photo' ||
    fnName === 'device_command' ||
    (typeof callId === 'string' && callId.includes('take_photo')) ||
    (
      ((fnName && String(fnName).includes('device')) || (typeof callId === 'string' && callId.includes('device'))) &&
      (argsStr.includes('take_photo') || argsStr.includes('拍照') || argsStr.includes('camera'))
    );
};

export const useToolCallHandler = ({
  handleReminderCall,
  openCamera,
  realTimeRef,
  setPendingVisualQa,
}: UseToolCallHandlerOptions) => {
  // Decision: dedupe tool effects by call_id here, not in UI components.
  const takePhotoAckedCallIdsRef = useRef<Set<string>>(new Set());
  const deviceControlAckedCallIdsRef = useRef<Set<string>>(new Set());
  const visualQaTriggeredCallIdsRef = useRef<Set<string>>(new Set());

  const sendVisualQaStopOutput = useCallback((callId: string, question: string) => {
    getConnectionManager(realTimeRef)?.sendFunctionCallOutput?.(callId, {
      ok: true,
      action: 'get_visual_QA',
      result: 'vision_image_data_pending',
      question,
    }, {
      controlMode: 'stop',
      isError: false,
    });
    console.log('[Vision] ✅ 已回传 get_visual_QA stop 工具结果，后续由 ImageData/vision 管线生成回答:', { callId });
  }, [realTimeRef]);

  const handleDeviceControlCall = useCallback(async (callId: unknown, parsedArgs: unknown) => {
    if (typeof callId !== 'string' || callId.length === 0) {
      console.warn('[DeviceControl] call_id 为空，跳过 function_call_output 回传');
      return;
    }

    if (deviceControlAckedCallIdsRef.current.has(callId)) {
      return;
    }
    deviceControlAckedCallIdsRef.current.add(callId);

    const connectionManager = getConnectionManager(realTimeRef);
    const target = parsedArgs && typeof parsedArgs === 'object' && 'target' in parsedArgs && typeof parsedArgs.target === 'string'
      ? parsedArgs.target
      : 'battery';
    const actionMode = parsedArgs && typeof parsedArgs === 'object' && 'actionMode' in parsedArgs && typeof parsedArgs.actionMode === 'string'
      ? parsedArgs.actionMode
      : 'query';

    try {
      if (target !== 'battery' || actionMode !== 'query') {
        throw new Error(`暂不支持的设备控制请求: target=${target}, actionMode=${actionMode}`);
      }

      const battery = await queryBrowserBattery();
      connectionManager?.sendFunctionCallOutput?.(callId, {
        status: 1,
        target,
        actionMode,
        battery,
        message: `当前电量 ${battery.level}%${battery.charging ? '，正在充电' : ''}`,
      }, {
        controlMode: 'llm',
        isError: false,
      });
      console.log('[DeviceControl] ✅ 已回传电量查询工具结果:', { callId, battery });
    } catch (error) {
      const message = error instanceof Error ? error.message : '电量查询失败';
      connectionManager?.sendFunctionCallOutput?.(callId, {
        status: 0,
        target,
        actionMode,
        error: message,
      }, {
        controlMode: 'llm',
        isError: true,
      });
      console.warn('[DeviceControl] ⚠️ 电量查询失败，已回传错误工具结果:', { callId, message });
    }
  }, [realTimeRef]);

  const handleToolCallEvent = useCallback((eventName: string, payload: unknown) => {
    const functionCallPayload = payload as FunctionCallPayload;
    console.log('[ToolCall] 收到事件:', eventName, functionCallPayload);

    const fnName = getFunctionName(functionCallPayload);
    const callId = getCallId(functionCallPayload);
    const parsedArgs = parseFunctionArgs(functionCallPayload);
    const argsStr = parsedArgs ? JSON.stringify(parsedArgs) : (functionCallPayload.arguments || '');
    const isFallback = eventName === 'response.function_call.done';

    if (fnName === 'reminder') {
      console.log(`[Reminder] ✅ 识别到 reminder 工具调用${isFallback ? ' (function_call.done)' : ''}:`, functionCallPayload);
      try {
        const reminder = handleReminderCall(parsedArgs as ReminderArguments);
        console.log('[Reminder] ✅ 解析参数:', parsedArgs);

        if (callId) {
          getConnectionManager(realTimeRef)?.sendFunctionCallOutput?.(callId, {
            status: 1,
            reminderId: reminder?.id,
            content: reminder?.content,
            startAt: reminder?.startAt,
          });
        } else {
          console.warn('[Reminder] call_id 为空，跳过 function_call_output 回传');
        }
      } catch (error) {
        console.error('[Reminder] ❌ 参数解析失败:', error);
      }
    }

    if (fnName === 'device_control') {
      console.log(`[DeviceControl] ✅ 识别到 device_control 工具调用${isFallback ? '(备用)' : ''}:`, { callId, parsedArgs });
      void handleDeviceControlCall(callId, parsedArgs);
    }

    if (fnName === 'get_visual_QA') {
      const question = getVisualQaQuestion(parsedArgs);
      console.log(`[Vision] ✅ 识别到视觉问答工具调用${isFallback ? '(备用)' : ''}，准备拍照并走 vision 管线:`, { fnName, callId, question });
      if (callId) {
        if (!visualQaTriggeredCallIdsRef.current.has(callId)) {
          visualQaTriggeredCallIdsRef.current.add(callId);
          sendVisualQaStopOutput(callId, question);
          setPendingVisualQa({ callId, question });
          void openCamera({ autoCapture: true });
        }
      } else {
        setPendingVisualQa({ callId: `visual_${Date.now()}`, question });
        void openCamera({ autoCapture: true });
        console.warn('[Vision] call_id 为空，仍会发送 ImageData，但无法关联原始工具调用');
      }
      console.log('[Vision] 摄像头打开请求已发出，将自动拍照并发送 ImageData 到 vision 管线');
    }

    if (isTakePhotoIntent(fnName, callId, argsStr)) {
      console.log(`[Camera] ✅ 识别到拍照意图${isFallback ? '(备用)' : ''}，准备打开摄像头:`, { fnName, callId, parsedArgs });
      void openCamera();
      console.log('[Camera] 摄像头打开请求已发出（若移动端拦截，将出现“点一下授权/打开摄像头”）');

      if (callId) {
        if (!takePhotoAckedCallIdsRef.current.has(callId)) {
          takePhotoAckedCallIdsRef.current.add(callId);
          getConnectionManager(realTimeRef)?.sendFunctionCallOutput?.(callId, {
            status: 1,
            action: 'take_photo',
            result: 'camera_open_requested',
          });
        }
      } else {
        console.warn('[Camera] call_id 为空，跳过 function_call_output 回传');
      }
    }
  }, [handleDeviceControlCall, handleReminderCall, openCamera, realTimeRef, sendVisualQaStopOutput, setPendingVisualQa]);

  return { handleToolCallEvent };
};
