import styles from '../App.module.scss';
import squadyLogo from '../assets/squady.png';
import { LiveAudioVisualizerComponent } from '../component/audioVisualizer';
import { StatusPoint } from '../component/statusPoint';

interface VoiceStageProps {
  isLocalVadEnabled: boolean;
  isUserSpeaking: boolean;
  talkHint: string;
  onLocalVadToggle: () => void;
  onRecord: () => void;
}

export const VoiceStage = ({ isLocalVadEnabled, isUserSpeaking, talkHint, onLocalVadToggle, onRecord }: VoiceStageProps) => (
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
    <label className={styles.localVadSwitch}>
      <input
        type="checkbox"
        checked={isLocalVadEnabled}
        onChange={onLocalVadToggle}
      />
      <span>本地 VAD</span>
      <strong>{isLocalVadEnabled ? '开启' : '关闭'}</strong>
    </label>
    {!isLocalVadEnabled && (
      <div className={styles.wsMicHint}>麦克风开关由 WebSocket 事件控制</div>
    )}
  </div>
);
