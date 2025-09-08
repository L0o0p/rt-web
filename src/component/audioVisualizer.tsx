import React, { useState, useCallback, useEffect } from 'react';
import { LiveAudioVisualizer } from 'react-audio-visualize';

interface AudioVisualizerComponentProps {
  width?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  backgroundColor?: string;
  barColor?: string;
  barPlayedColor?: string;
  className?: string;
}


// 实时音频可视化组件
interface LiveAudioVisualizerComponentProps extends AudioVisualizerComponentProps {
  smoothingTimeConstant?: number;
  fftSize?: number;
  onRecordingStateChange?: (isRecording: boolean) => void;
  isRecording?: boolean;
  hideButton?: boolean;
}

export const LiveAudioVisualizerComponent: React.FC<LiveAudioVisualizerComponentProps> = ({
  width = 500,
  height = 200,
  barWidth = 2,
  gap = 1,
  backgroundColor = 'none',
  barColor = '#3b82f6',
  className = '',
  smoothingTimeConstant = 0.8,
  fftSize = 1024,
  onRecordingStateChange,
  isRecording: externalIsRecording,
  hideButton = false,
}) => {
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [internalIsRecording, setInternalIsRecording] = useState(false);

  // 使用外部传入的状态，如果没有则使用内部状态
  const isRecording = externalIsRecording !== undefined ? externalIsRecording : internalIsRecording;

  const startRecording = useCallback(async () => {
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
      if (externalIsRecording === undefined) {
        setInternalIsRecording(true);
        onRecordingStateChange?.(true);
      }
      recorder.start();
    } catch {
      alert('无法获取麦克风权限，请检查浏览器设置');
    }
  }, [onRecordingStateChange, externalIsRecording]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      setMediaRecorder(null);
      if (externalIsRecording === undefined) {
        setInternalIsRecording(false);
        onRecordingStateChange?.(false);
      }
    }
  }, [mediaRecorder, onRecordingStateChange, externalIsRecording]);

  // 监听外部录音状态变化
  useEffect(() => {
    if (externalIsRecording !== undefined) {
      if (externalIsRecording && !mediaRecorder) {
        // 开始录音
        const start = async () => {
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
            alert('无法获取麦克风权限，请检查浏览器设置');
          }
        };
        start();
      } else if (!externalIsRecording && mediaRecorder) {
        // 停止录音
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        setMediaRecorder(null);
      }
    }
  }, [externalIsRecording, mediaRecorder]);

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
    <div className={className}>
      {!hideButton && (
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          <button
            onClick={isRecording ? stopRecording : startRecording}
            style={{
              padding: '12px 24px',
              backgroundColor: isRecording ? '#ef4444' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            }}
          >
            {isRecording ? '🔴 停止录音' : '🎤 开始录音'}
          </button>
        </div>
      )}

      <div
        style={{
          border: backgroundColor === 'transparent' ? 'none' : `2px solid ${isRecording ? '#10b981' : '#e5e7eb'}`,
          borderRadius: '12px',
          padding: '20px',
          backgroundColor: backgroundColor,
          transition: 'all 0.3s ease',
          boxShadow: backgroundColor === 'transparent' ? 'none' : (isRecording ? '0 0 20px rgba(255, 255, 255, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.05)'),
        }}
      >
        {isRecording && mediaRecorder ? (
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
        ) : (
          <div
            style={{
              width,
              height,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
              fontSize: '18px',
              textAlign: 'center',
              gap: '10px',
            }}
          >
            <div style={{ fontSize: '48px' }}>🎤</div>
            <div>点击上方按钮开始实时语音可视化</div>
          </div>
        )}
      </div>
    </div>
  );
};

// 导出默认组件
export default LiveAudioVisualizerComponent;

