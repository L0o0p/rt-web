import React, { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import styles from './App.module.scss'
import squadyLogo from './assets/squady.png'
import { isUserSpeakingAtom } from './state'
import { LiveAudioVisualizerComponent } from './component/audioVisualizer'
import { RealTime } from './RealTime'

const realTime = new RealTime()

export const App = () => {
  const [isUserSpeaking, setIsUserSpeaking] = useAtom(isUserSpeakingAtom)
  const hasConnected = useRef(false)

  const connect = async () => {
    if (hasConnected.current) return
    hasConnected.current = true
    await realTime.connectToServer()
  }

  useEffect(() => {
    connect()
  }, [])

  return (
    <div className={styles.container}>
      <div className={styles.mainSection}>
        {isUserSpeaking && (
          <div className={styles.audioVisualizerOverlay}>
            <LiveAudioVisualizerComponent
              width={700}
              height={200}
              barColor="#ffffff"
              smoothingTimeConstant={0.8}
              fftSize={512}
              barWidth={3}
              gap={2}
              isRecording={isUserSpeaking}
            />
          </div>
        )}
        <SquadyUI onToggleRecording={() => setIsUserSpeaking(!isUserSpeaking)} />
      </div>
    </div>
  )
}

interface SquadyUIProps {
  onToggleRecording: () => void;
}

const SquadyUI: React.FC<SquadyUIProps> = ({ onToggleRecording }) => {
  const text = 'Squady'
  return (
    <div className={styles.squadyUIContainer}>
      <div
        className={styles.squadyUI}
        onClick={onToggleRecording}
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