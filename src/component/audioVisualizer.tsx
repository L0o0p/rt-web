import React, { useState, useEffect } from 'react';
import { LiveAudioVisualizer } from 'react-audio-visualize';

interface LiveAudioVisualizerComponentProps {
  width?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  barColor?: string;
  smoothingTimeConstant?: number;
  fftSize?: number;
  isRecording?: boolean;
}

export const LiveAudioVisualizerComponent: React.FC<LiveAudioVisualizerComponentProps> = ({
  width = 500,
  height = 200,
  barWidth = 2,
  gap = 1,
  barColor = '#ffffff',
  smoothingTimeConstant = 0.8,
  fftSize = 512,
  isRecording = false,
}) => {
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  // 监听录音状态变化
  useEffect(() => {
    if (isRecording && !mediaRecorder) {
      // 开始录音
      const startRecording = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          });
          const recorder = new MediaRecorder(stream);
          setMediaRecorder(recorder);
          recorder.start();
        } catch {
          // 静默失败，不显示提示
        }
      };
      startRecording();
    } else if (!isRecording && mediaRecorder) {
      // 停止录音
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      setMediaRecorder(null);
    }
  }, [isRecording, mediaRecorder]);

  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      if (mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [mediaRecorder]);

  return (
    <div>
      {isRecording && mediaRecorder && (
        <LiveAudioVisualizer
          mediaRecorder={mediaRecorder}
          width={width}
          height={height}
          barWidth={barWidth}
          gap={gap}
          barColor={barColor}
          smoothingTimeConstant={smoothingTimeConstant}
          fftSize={fftSize as 512}
        />
      )}
    </div>
  );
};

// 导出默认组件
export default LiveAudioVisualizerComponent;

