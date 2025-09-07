import { useState } from 'react'
import styles from './example.module.scss'
import { RealTime } from './sdk'

// 在组件外部创建RealTime实例，确保在整个应用生命周期中保持一致
const realTime = new RealTime()

function App() {
  const [speaking, setSpeaking] = useState(false)
  const connect = () => {
    realTime.connectToServer()
  }
  const speak = () => {
    if (speaking) {
      realTime.stop();
    } else {
      realTime.speak();
    }
    const newSpeaking = !speaking;
    setSpeaking(newSpeaking);
    console.log('speaking?', newSpeaking);
  }
  
  const play= () => {
    realTime.playRecordedAudio()
  }

  return (
    <>
      <div className={ styles.container }>
        <button className={styles.connect} onClick={connect}>connect</button>
        <button className={speaking ? styles.stop : styles.speak} onClick={speak}>speak</button>
        <button className={styles.play} onClick={play}>播放录音</button>
      </div>
    </>
  )
}

export default App




