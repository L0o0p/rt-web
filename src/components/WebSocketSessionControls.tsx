import styles from '../App.module.scss';
import type { VoicePreset, WsPreset, WsPresetId } from '../app/architectureDecisions';

interface WebSocketSessionControlsProps {
  currentSessionId: string;
  isSessionIdLocked: boolean;
  isSwitchingWs: boolean;
  sessionIdInput: string;
  sessionLocationInput: string;
  voicePreset: VoicePreset;
  wsInput: string;
  wsPresetId: WsPresetId;
  wsPresets: readonly WsPreset[];
  wsUrl: string;
  onApplySessionLocation: () => void;
  onApplySessionId: () => void;
  onApplyVoicePreset: (preset: VoicePreset) => void;
  onApplyWebSocketUrl: (url: string, presetId?: WsPresetId) => Promise<void>;
  onSessionIdLockChange: (locked: boolean) => void;
  onSessionIdInputChange: (value: string) => void;
  onSessionLocationInputChange: (value: string) => void;
  onWsInputChange: (value: string) => void;
  onWsPresetChange: (presetId: WsPresetId) => void;
}

export const WebSocketSessionControls = ({
  currentSessionId,
  isSessionIdLocked,
  isSwitchingWs,
  sessionIdInput,
  sessionLocationInput,
  voicePreset,
  wsInput,
  wsPresetId,
  wsPresets,
  wsUrl,
  onApplySessionLocation,
  onApplySessionId,
  onApplyVoicePreset,
  onApplyWebSocketUrl,
  onSessionIdLockChange,
  onSessionIdInputChange,
  onSessionLocationInputChange,
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
      Session: {currentSessionId || '--'}{isSessionIdLocked ? ' (locked)' : ''}
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
      <label className={styles.wsConfigCheckbox}>
        <input
          type="checkbox"
          checked={isSessionIdLocked}
          disabled={isSwitchingWs}
          onChange={(event) => onSessionIdLockChange(event.target.checked)}
        />
        Lock
      </label>
    </div>

    <div className={styles.wsConfigRow}>
      <span className={styles.wsConfigLabel}>地址</span>
      <input
        value={sessionLocationInput}
        onChange={(event) => onSessionLocationInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onApplySessionLocation();
        }}
        placeholder="输入经纬度，如 22.657,114.016"
        className={styles.wsConfigInput}
        disabled={isSwitchingWs}
      />
      <button
        type="button"
        onClick={onApplySessionLocation}
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
