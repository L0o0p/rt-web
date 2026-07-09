import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { RealTime } from '../RealTime';
import { ProtocolId } from '../sdk/protocol/ClientProtocol';
import type { SessionConfigPayload } from '../sdk/protocol/ClientProtocol';
import type { SessionStatus } from '../app/architectureDecisions';
import styles from './SimulMeetingTestPanel.module.scss';

export type TestProfile = 'interpret' | 'meeting';
type SpeechMode = 'vad' | 'vad_deferred';

interface SimulMeetingTestPanelProps {
  isUserSpeaking: boolean;
  profile: TestProfile;
  realTimeRef: MutableRefObject<RealTime | undefined>;
  sessionStatus: SessionStatus;
  onRecord: () => void;
}

interface AsrFinalSegment {
  id: string;
  atMs: number;
  text: string;
  responseId?: string;
  itemId?: string;
}

interface MonitorSnapshot {
  eventCount: number;
  asrDeltaCount: number;
  asrFinalCount: number;
  textEventCount: number;
  audioEventCount: number;
  errorCount: number;
  lastEventName?: string;
  lastEventMs?: number;
  lastAsrMs?: number;
  currentPartial: string;
  summary: string;
  warnings: string[];
}

interface EventLine {
  id: string;
  text: string;
}

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'yue', label: '粤语' },
  { value: 'auto', label: 'Auto' },
] as const;

const MAX_FINAL_SEGMENTS = 80;
const MAX_EVENT_LINES = 80;

const appendUniqueWarning = (warnings: string[], warning: string) => (
  warnings.includes(warning) ? warnings : [...warnings, warning]
);

const preview = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const readString = (payload: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const createMonitorSnapshot = (): MonitorSnapshot => ({
  eventCount: 0,
  asrDeltaCount: 0,
  asrFinalCount: 0,
  textEventCount: 0,
  audioEventCount: 0,
  errorCount: 0,
  currentPartial: '',
  summary: '',
  warnings: [],
});

const formatDuration = (ms?: number) => {
  if (ms === undefined || ms < 0) return '--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const SimulMeetingTestPanel = ({
  isUserSpeaking,
  profile,
  realTimeRef,
  sessionStatus,
  onRecord,
}: SimulMeetingTestPanelProps) => {
  const [speechMode, setSpeechMode] = useState<SpeechMode>('vad');
  const [fromLanguage, setFromLanguage] = useState('en');
  const [toLanguage, setToLanguage] = useState('zh');
  const [interpretEnableTts, setInterpretEnableTts] = useState(true);
  const [interpretEnableSummary, setInterpretEnableSummary] = useState(false);
  const [monitor, setMonitor] = useState<MonitorSnapshot>(() => createMonitorSnapshot());
  const [finalSegments, setFinalSegments] = useState<AsrFinalSegment[]>([]);
  const [eventLines, setEventLines] = useState<EventLine[]>([]);
  const [activeProfile, setActiveProfile] = useState<TestProfile | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(0);
  const enableTts = profile === 'meeting' ? false : interpretEnableTts;
  const enableSummary = profile === 'meeting' ? true : interpretEnableSummary;

  const sessionConfig = useMemo<Partial<SessionConfigPayload>>(() => {
    const isMeeting = profile === 'meeting';

    // Decision: the meeting test intentionally uses the Translation protocol with
    // an empty to_language. BE maps that to "ASR + optional summary" in the
    // dedicated TranslationPipeline, so it exercises the meeting path without
    // going through the normal ASR/LLM/TTS assistant pipeline.
    return {
      type: 'session_config',
      mode: speechMode,
      from_language: fromLanguage.trim() || 'auto',
      to_language: isMeeting ? '' : toLanguage.trim(),
      asr_language: fromLanguage.trim() || 'auto',
      enable_tts: isMeeting ? false : enableTts,
      enable_summary: isMeeting ? true : enableSummary,
      timezone: 'Asia/Shanghai',
      location: '22.657,114.016',
      initial_burst_count: 10,
      initial_burst_delay_ms: 5,
      send_rate_multiplier: 1.0,
      input_audio_config: {
        format: 'opus',
        sample_rate: 16000,
        channels: 1,
        bitrate: 32000,
        application: 'voip',
      },
      output_audio_config: {
        format: 'opus',
        slice_ms: 20,
        sample_rate: 16000,
        channels: 1,
        bitrate: 32000,
        application: 'voip',
      },
      text_done_signal_only: false,
      signal_only: false,
    };
  }, [enableSummary, enableTts, fromLanguage, profile, speechMode, toLanguage]);

  const nowMs = useCallback(() => Math.round(performance.now() - startedAtRef.current), []);

  useEffect(() => {
    if (startedAtRef.current === 0) {
      startedAtRef.current = performance.now();
    }
  }, []);

  useEffect(() => {
    if (!activeProfile) return undefined;
    const interval = window.setInterval(() => {
      setElapsedMs(Math.round(performance.now() - startedAtRef.current));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [activeProfile]);

  const addEventLine = useCallback((eventName: string, payload: Record<string, unknown>) => {
    const ms = nowMs();
    const rid = readString(payload, 'response_id', 'responseId') ?? '';
    const item = readString(payload, 'item_id', 'itemId') ?? '';
    const text = `${ms}ms ${eventName}${rid ? ` rid=${rid}` : ''}${item ? ` item=${item}` : ''}`;
    setEventLines(prev => [{ id: `${Date.now()}_${Math.random()}`, text }, ...prev].slice(0, MAX_EVENT_LINES));
  }, [nowMs]);

  const handleRuntimeEvent = useCallback((eventName: string, rawPayload: unknown) => {
    const payload = (rawPayload && typeof rawPayload === 'object') ? rawPayload as Record<string, unknown> : {};
    if (!eventName || ![
      'session.created',
      'conversation.item.input_audio_transcription.delta',
      'conversation.item.input_audio_transcription.completed',
      'response.text.speculative',
      'response.text.delta',
      'response.text.done',
      'response.audio.delta',
      'response.audio.done',
      'output_audio_buffer.started',
      'output_audio_buffer.stopped',
      'binary_audio_delta',
      'response.done',
      'response.language_detected',
      'llm_summary',
      'error.event',
    ].includes(eventName)) {
      return;
    }

    addEventLine(eventName, payload);

    const responseId = readString(payload, 'response_id', 'responseId');
    const itemId = readString(payload, 'item_id', 'itemId');
    const ms = nowMs();

    setMonitor(prev => ({
      ...prev,
      eventCount: prev.eventCount + 1,
      lastEventName: eventName,
      lastEventMs: ms,
    }));

    if (eventName === 'conversation.item.input_audio_transcription.delta') {
      setMonitor(prev => {
        const warnings = responseId ? prev.warnings : appendUniqueWarning(prev.warnings, 'ASR delta 缺 response_id');
        return {
          ...prev,
          asrDeltaCount: prev.asrDeltaCount + 1,
          lastAsrMs: ms,
          currentPartial: preview(payload.delta),
          warnings,
        };
      });
      return;
    }

    if (eventName === 'conversation.item.input_audio_transcription.completed') {
      const transcript = preview(payload.transcript);
      setMonitor(prev => ({
        ...prev,
        asrFinalCount: prev.asrFinalCount + 1,
        lastAsrMs: ms,
        currentPartial: '',
        warnings: responseId ? prev.warnings : appendUniqueWarning(prev.warnings, 'ASR final 缺 response_id'),
      }));
      setFinalSegments(prev => [{
        id: `${Date.now()}_${Math.random()}`,
        atMs: ms,
        text: transcript,
        responseId,
        itemId,
      }, ...prev].slice(0, MAX_FINAL_SEGMENTS));
      return;
    }

    if (eventName === 'response.text.speculative' || eventName === 'response.text.delta' || eventName === 'response.text.done') {
      setMonitor(prev => ({
        ...prev,
        textEventCount: prev.textEventCount + 1,
      }));
      return;
    }

    if (eventName === 'output_audio_buffer.started' || eventName === 'output_audio_buffer.stopped' || eventName === 'binary_audio_delta' || eventName === 'response.audio.delta' || eventName === 'response.audio.done') {
      setMonitor(prev => ({
        ...prev,
        audioEventCount: prev.audioEventCount + 1,
      }));
      return;
    }

    if (eventName === 'llm_summary') {
      setMonitor(prev => ({
        ...prev,
        summary: preview(payload.summary),
      }));
      return;
    }

    if (eventName === 'error.event') {
      setMonitor(prev => ({
        ...prev,
        errorCount: prev.errorCount + 1,
        warnings: appendUniqueWarning(prev.warnings, preview(payload.error ?? payload.message ?? payload)),
      }));
    }
  }, [addEventLine, nowMs]);

  useEffect(() => {
    const core = realTimeRef.current?.getVoiceChatCore();
    if (!core) return undefined;

    const listener = (eventName: string, payload: unknown) => handleRuntimeEvent(eventName, payload);
    core.onAny(listener);

    return () => {
      core.offAny(listener);
    };
  }, [handleRuntimeEvent, realTimeRef]);

  const startTestSession = useCallback(() => {
    const core = realTimeRef.current?.getVoiceChatCore();
    if (!core?.isConnected) {
      alert('WebSocket 未连接，先等 session.created 或切换 WS 后刷新');
      return;
    }

    // Decision: this panel only owns Translation-family modes. The App-level
    // pipeline selector is the single place that decides whether dialogue,
    // interpretation, or meeting controls are visible.
    startedAtRef.current = performance.now();
    setElapsedMs(0);
    setMonitor(createMonitorSnapshot());
    setFinalSegments([]);
    setEventLines([]);
    setActiveProfile(profile);
    realTimeRef.current?.startNewSession(sessionConfig, ProtocolId.Translation);
  }, [profile, realTimeRef, sessionConfig]);

  const stopCurrentInput = useCallback(() => {
    const core = realTimeRef.current?.getVoiceChatCore();
    core?.sendStopInput(`event_${Date.now()}`, Math.floor(performance.now() - startedAtRef.current), `msg_${Date.now().toString(36)}`, false);
  }, [realTimeRef]);

  const stopTestSession = useCallback(() => {
    realTimeRef.current?.stopSession(ProtocolId.Translation);
    setActiveProfile(null);
  }, [realTimeRef]);

  const configText = useMemo(() => JSON.stringify({
    protocol_id: ProtocolId.Translation,
    ...sessionConfig,
  }, null, 2), [sessionConfig]);
  const currentMs = elapsedMs;
  const runMs = activeProfile ? currentMs : undefined;
  const lastEventAgeMs = monitor.lastEventMs === undefined ? undefined : currentMs - monitor.lastEventMs;
  const lastAsrAgeMs = monitor.lastAsrMs === undefined
    ? (activeProfile ? currentMs : undefined)
    : currentMs - monitor.lastAsrMs;
  const silenceWarn = activeProfile && isUserSpeaking && lastAsrAgeMs !== undefined && lastAsrAgeMs > 15000;
  const statusLabel = !sessionStatus.connected
    ? 'WS disconnected'
    : !activeProfile
      ? '未启动'
      : silenceWarn
        ? 'ASR 静默'
        : isUserSpeaking
          ? '收音中'
          : '会话已开，麦克风未开';

  return (
    <section className={styles.panel} data-testid="simul-meeting-test-panel">
      <div className={styles.controls}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{profile === 'interpret' ? '同传测试台' : '会议测试台'}</h2>
          <span className={styles.status}>
            {sessionStatus.connected ? 'WS connected' : 'WS disconnected'}
          </span>
        </div>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            输入语言
            <select className={styles.select} value={fromLanguage} onChange={(event) => setFromLanguage(event.target.value)}>
              {LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            目标语言
            <select
              className={styles.select}
              value={toLanguage}
              disabled={profile === 'meeting'}
              onChange={(event) => setToLanguage(event.target.value)}
            >
              {LANGUAGE_OPTIONS.filter(option => option.value !== 'auto').map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            语音模式
            <select className={styles.select} value={speechMode} onChange={(event) => setSpeechMode(event.target.value as SpeechMode)}>
              <option value="vad">VAD</option>
              <option value="vad_deferred">VAD deferred</option>
            </select>
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={profile === 'interpret' ? enableTts : false}
              disabled={profile === 'meeting'}
              onChange={(event) => setInterpretEnableTts(event.target.checked)}
            />
            服务端 TTS
          </label>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={profile === 'meeting' ? true : enableSummary}
              disabled={profile === 'meeting'}
              onChange={(event) => setInterpretEnableSummary(event.target.checked)}
            />
            结束时总结
          </label>
        </div>

        <div className={styles.buttonRow}>
          <button
            type="button"
            data-testid="simul-start-session"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={startTestSession}
          >
            {profile === 'interpret' ? '新建同传会话' : '新建会议会话'}
          </button>
          <button type="button" className={styles.button} onClick={onRecord}>
            {isUserSpeaking ? '停止麦克风' : '开始麦克风'}
          </button>
          <button type="button" className={styles.button} onClick={stopCurrentInput}>
            StopInput
          </button>
          <button type="button" className={`${styles.button} ${styles.buttonDanger}`} onClick={stopTestSession}>
            Stop Session
          </button>
        </div>

        <pre className={styles.configPreview} data-testid="simul-session-config">{configText}</pre>
      </div>

      <div className={styles.monitor}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>{profile === 'meeting' ? '会议 ASR 状态' : '同传状态'}</h2>
          <span className={styles.status}>
            {statusLabel}
          </span>
        </div>

        <div className={styles.statusGrid}>
          <div className={styles.metric}>
            <span>运行</span>
            <strong>{formatDuration(runMs)}</strong>
          </div>
          <div className={styles.metric}>
            <span>最后 ASR</span>
            <strong>{formatDuration(lastAsrAgeMs)}</strong>
          </div>
          <div className={styles.metric}>
            <span>Final</span>
            <strong>{monitor.asrFinalCount}</strong>
          </div>
          <div className={styles.metric}>
            <span>Partial</span>
            <strong>{monitor.asrDeltaCount}</strong>
          </div>
          <div className={styles.metric}>
            <span>事件</span>
            <strong>{monitor.eventCount}</strong>
          </div>
          <div className={styles.metric}>
            <span>错误</span>
            <strong>{monitor.errorCount}</strong>
          </div>
        </div>

        <div className={styles.currentBlock}>
          <div className={styles.blockHeader}>
            <span>当前 partial</span>
            <span>{monitor.lastEventName ? `${monitor.lastEventName} · ${formatDuration(lastEventAgeMs)} ago` : '暂无事件'}</span>
          </div>
          <div className={styles.liveText}>
            {monitor.currentPartial || '等待 ASR partial'}
          </div>
        </div>

        {monitor.summary && (
          <div className={styles.currentBlock}>
            <div className={styles.blockHeader}>
              <span>会议总结</span>
            </div>
            <div className={styles.liveText}>{monitor.summary}</div>
          </div>
        )}

        {(silenceWarn || monitor.warnings.length > 0) && (
          <div className={styles.warningPanel}>
            {silenceWarn && <div>ASR 已 {formatDuration(lastAsrAgeMs)} 没有更新，适合检查 WhisperLive/连接是否卡住。</div>}
            {monitor.warnings.map(warning => <div key={warning}>{warning}</div>)}
          </div>
        )}

        <div className={styles.finalList}>
          <div className={styles.blockHeader}>
            <span>ASR final 累积</span>
            <span>{finalSegments.length} 条保留</span>
          </div>
          {finalSegments.length === 0 ? (
            <div className={styles.empty}>等待 ASR final</div>
          ) : finalSegments.map(segment => (
            <article key={segment.id} className={styles.finalItem}>
              <div className={styles.finalMeta}>
                {formatDuration(segment.atMs)} {segment.responseId ? ` · ${segment.responseId}` : ''} {segment.itemId ? ` · ${segment.itemId}` : ''}
              </div>
              <div className={styles.finalText}>{segment.text}</div>
            </article>
          ))}
        </div>

        <div className={styles.eventLog}>
          {eventLines.length === 0 ? (
            <div className={styles.eventLine}>暂无事件</div>
          ) : eventLines.slice(0, 16).map(line => <div key={line.id} className={styles.eventLine}>{line.text}</div>)}
        </div>
      </div>
    </section>
  );
};
