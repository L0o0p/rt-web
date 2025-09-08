import React, { useState, useRef, useCallback } from 'react';
import { AudioVisualizer, LiveAudioVisualizer } from 'react-audio-visualize';

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

// 文件音频可视化组件
export const FileAudioVisualizer: React.FC<AudioVisualizerComponentProps> = ({
    width = 500,
    height = 200,
    barWidth = 2,
    gap = 1,
    backgroundColor = '#f0f0f0',
    barColor = '#3b82f6',
    barPlayedColor = '#1d4ed8',
    className = '',
}) => {
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement>(null);

    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setAudioFile(file);
            setIsPlaying(false);
        }
    }, []);

    const togglePlayPause = useCallback(() => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    }, [isPlaying]);

    return (
        <div className= { className } >
        <div style={ { marginBottom: '20px' } }>
            <input
          type="file"
    accept = "audio/*"
    onChange = { handleFileChange }
    style = {{ marginBottom: '10px' }
}
        />
{
    audioFile && (
        <div>
        <button
              onClick={ togglePlayPause }
    style = {{
        padding: '8px 16px',
            backgroundColor: barColor,
                color: 'white',
                    border: 'none',
                        borderRadius: '4px',
                            cursor: 'pointer',
                                marginBottom: '10px'
    }
}
            >
    { isPlaying? '暂停': '播放' }
    </button>
    < audio
ref = { audioRef }
src = { URL.createObjectURL(audioFile) }
onPlay = {() => setIsPlaying(true)}
onPause = {() => setIsPlaying(false)}
onEnded = {() => setIsPlaying(false)}
style = {{ display: 'none' }}
            />
    </div>
        )}
</div>

{
    audioFile && (
        <div
          style={
        {
            border: `1px solid ${barColor}`,
                borderRadius: '8px',
                    padding: '16px',
                        backgroundColor: backgroundColor,
          }
    }
        >
        <AudioVisualizer
            blob={ audioFile }
    width = { width }
    height = { height }
    barWidth = { barWidth }
    gap = { gap }
    barColor = { barColor }
    barPlayedColor = { barPlayedColor }
        />
        </div>
      )
}
</div>
  );
};

// 实时音频可视化组件
interface LiveAudioVisualizerComponentProps extends AudioVisualizerComponentProps {
    smoothingTimeConstant?: number;
    fftSize?: number;
}

export const LiveAudioVisualizerComponent: React.FC<LiveAudioVisualizerComponentProps> = ({
    width = 500,
    height = 200,
    barWidth = 2,
    gap = 1,
    backgroundColor = '#f0f0f0',
    barColor = '#3b82f6',
    className = '',
    smoothingTimeConstant = 0.8,
    fftSize = 1024,
}) => {
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [isRecording, setIsRecording] = useState(false);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            setMediaRecorder(recorder);
            setIsRecording(true);
            recorder.start();
        } catch (error) {
            console.error('无法获取麦克风权限:', error);
            alert('无法获取麦克风权限，请检查浏览器设置');
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorder) {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            setMediaRecorder(null);
            setIsRecording(false);
        }
    }, [mediaRecorder]);

    return (
        <div className= { className } >
        <div style={ { marginBottom: '20px' } }>
            <button
          onClick={ isRecording ? stopRecording : startRecording }
    style = {{
        padding: '8px 16px',
            backgroundColor: isRecording ? '#dc2626' : barColor,
                color: 'white',
                    border: 'none',
                        borderRadius: '4px',
                            cursor: 'pointer',
          }
}
        >
    { isRecording? '停止录音': '开始录音' }
    </button>
    </div>

    < div
style = {{
    border: `1px solid ${barColor}`,
        borderRadius: '8px',
            padding: '16px',
                backgroundColor: backgroundColor,
        }}
      >
    { isRecording && mediaRecorder ? (
        <LiveAudioVisualizer
            mediaRecorder= { mediaRecorder }
            width = { width }
height = { height }
barWidth = { barWidth }
gap = { gap }
barColor = { barColor }
smoothingTimeConstant = { smoothingTimeConstant }
fftSize = { fftSize }
    />
        ) : (
    <div
            style= {{
    width,
        height,
        display: 'flex',
            alignItems: 'center',
                justifyContent: 'center',
                    color: '#666',
                        fontSize: '16px',
            }}
          >
    点击 "开始录音" 来查看实时音频可视化
        </div>
        )}
</div>
    </div>
  );
};

// 导出默认组件
export default FileAudioVisualizer;
