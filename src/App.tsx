import React from 'react'
import { useAtom } from 'jotai'
import styles from './App.module.scss'
import squadyLogo from './assets/squady.png'
import { isUserSpeakingAtom } from './state'
import { LiveAudioVisualizerComponent } from './component/audioVisualizer'
export const App = () => {
  const [isUserSpeaking, setIsUserSpeaking] = useAtom(isUserSpeakingAtom)

  return (
    <div className={styles.container}>
      <SquadyUI onToggleRecording={() => setIsUserSpeaking(!isUserSpeaking)} />
      {isUserSpeaking && (
        <div className={styles.audioVisualizerSection}>
          <LiveAudioVisualizerComponent
            width={700}
            height={200}
            barColor="#ffffff"
            backgroundColor="transparent"
            smoothingTimeConstant={0.8}
            fftSize={512}
            barWidth={3}
            gap={2}
            isRecording={isUserSpeaking}
            onRecordingStateChange={setIsUserSpeaking}
            hideButton={true}
          />
        </div>
      )}
    </div>
  )
}

interface SquadyUIProps {
  onToggleRecording: () => void;
}

const SquadyUI: React.FC<SquadyUIProps> = ({ onToggleRecording }) => {
  const text = 'Squady'
  const [isUserSpeaking] = useAtom(isUserSpeakingAtom)
  return (
    <div className={styles.squadyUIContainer}>
      <div
        className={styles.squadyUI}
        onClick={onToggleRecording}
        style={isUserSpeaking ? { width: '60%', borderRadius: '999px' } : { width: '100%', borderRadius: '0' }}
      >
        <img src={squadyLogo} alt="squady" />
      </div>
      <div className={styles.squadyUIText}>
        <div>{text}</div>
        {/* <div style={{
          fontSize: '16px',
          fontWeight: 'normal',
          marginTop: '8px',
          opacity: 0.8
        }}>
          {isUserSpeaking ? '点击停止录音' : '点击开始录音'}
        </div> */}
      </div>
    </div>
  )
}