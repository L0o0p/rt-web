import styles from '../App.module.scss';
import squadyLogo from '../assets/squady.png';
import { LiveAudioVisualizerComponent } from '../component/audioVisualizer';
import { StatusPoint } from '../component/statusPoint';

interface VoiceStageProps {
  isUserSpeaking: boolean;
  talkHint: string;
  onRecord: () => void;
}

export const VoiceStage = ({ isUserSpeaking, talkHint, onRecord }: VoiceStageProps) => (
  <div className={styles.squadyUIContainer}>
    <LiveAudioVisualizerComponent pause={!isUserSpeaking} />
    <div
      className={styles.squadyUI}
      onPointerDown={(event) => {
        event.preventDefault();
        onRecord();
      }}
    >
      <img src={squadyLogo} alt="squady" />
    </div>
    <div className={styles.squadyUIText}>
      <div>Squady</div>
      <StatusPoint />
    </div>
    <div className={styles.squadySubtext}>
      {talkHint || (isUserSpeaking ? '正在聆听...' : '点击开始对话')}
    </div>
  </div>
);
