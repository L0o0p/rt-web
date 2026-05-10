import styles from '../App.module.scss';
import type { VoicePreset, WsPreset, WsPresetId } from '../app/architectureDecisions';

interface WebSocketSessionControlsProps {
  currentSessionId: string;
  isSwitchingWs: boolean;
  sessionIdInput: string;
  voicePreset: VoicePreset;
  wsInput: string;
  wsPresetId: WsPresetId;
  wsPresets: readonly WsPreset[];
  wsUrl: string;
  onApplySessionId: () => void;
  onApplyVoicePreset: (preset: VoicePreset) => void;
  onApplyWebSocketUrl: (url: string, presetId?: WsPresetId) => Promise<void>;
  onSessionIdInputChange: (value: string) => void;
  onWsInputChange: (value: string) => void;
  onWsPresetChange: (presetId: WsPresetId) => void;
}

export const WebSocketSessionControls = ({
  currentSessionId,
  isSwitchingWs,
  sessionIdInput,
  voicePreset,
  wsInput,
  wsPresetId,
  wsPresets,
  wsUrl,
  onApplySessionId,
  onApplyVoicePreset,
  onApplyWebSocketUrl,
  onSessionIdInputChange,
  onWsInputChange,
  onWsPresetChange,
}: WebSocketSessionControlsProps) => (
  <div className={styles.wsConfigBar}>
    <div className={styles.wsConfigRow}>
      <span className={styles.wsConfigLabel}>WS</span>
      <select
        value={wsPresetId}
        onChange={(event) => {
          const id = event.target.value as WsPresetId;
          onWsPresetChange(id);
          const preset = wsPresets.find((candidate) => candidate.id === id);
          if (preset && preset.id !== 'custom') {
            void onApplyWebSocketUrl(preset.url, id);
          }
        }}
        disabled={isSwitchingWs}
        className={styles.wsConfigSelect}
      >
        {wsPresets.map((preset) => (
          <option key={preset.id} value={preset.id}>{preset.label}</option>
        ))}
      </select>

      {wsPresetId === 'custom' && (
        <input
          value={wsInput}
          onChange={(event) => onWsInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void onApplyWebSocketUrl(wsInput, 'custom');
            }
          }}
          placeholder="ws://host:port/path"
          disabled={isSwitchingWs}
          className={styles.wsConfigInput}
        />
      )}

      {wsPresetId === 'custom' && (
        <button
          type="button"
          onClick={() => void onApplyWebSocketUrl(wsInput, 'custom')}
          disabled={isSwitchingWs}
          className={styles.wsConfigButton}
        >
          Apply
        </button>
      )}
    </div>
    <div className={styles.wsConfigHint} title={wsUrl}>
      当前: {wsUrl}
    </div>

    <div className={styles.wsConfigHint} title={currentSessionId || undefined}>
      Session: {currentSessionId || '--'}
    </div>

    <div className={styles.wsConfigRow}>
      <span className={styles.wsConfigLabel}>Session</span>
      <input
        value={sessionIdInput}
        onChange={(event) => onSessionIdInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onApplySessionId();
        }}
        placeholder="输入 sessionId（如16位）"
        className={styles.wsConfigInput}
        disabled={isSwitchingWs}
      />
      <button
        type="button"
        onClick={onApplySessionId}
        disabled={isSwitchingWs}
        className={styles.wsConfigButton}
      >
        Apply
      </button>
    </div>

    <div className={styles.wsConfigRow}>
      <span className={styles.wsConfigLabel}>Voice</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={voicePreset === 'default'}
          disabled={isSwitchingWs}
          onChange={(event) => {
            if (event.target.checked) onApplyVoicePreset('default');
          }}
        />
        默认
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={voicePreset === 'soft'}
          disabled={isSwitchingWs}
          onChange={(event) => {
            if (event.target.checked) onApplyVoicePreset('soft');
          }}
        />
        轻柔音色
      </label>
    </div>
  </div>
);
