import { useState } from 'react';
import type { SignalDirection, SignalMonitorFrame } from '../sdk/protocol/SignalMonitor';
import styles from './SignalSidebar.module.scss';

export interface SignalSidebarRow extends SignalMonitorFrame {
  id: string;
  clock: string;
  packetCount: number;
}

type SignalSidebarMode = 'timeline' | 'direction';

interface SignalSidebarProps {
  collapsed: boolean;
  rows: SignalSidebarRow[];
  onToggle: () => void;
}

const DIRECTIONS: SignalDirection[] = ['up', 'down'];
const MODE_OPTIONS: Array<{ mode: SignalSidebarMode; label: string }> = [
  { mode: 'timeline', label: '聚合' },
  { mode: 'direction', label: '分向' },
];

const DIRECTION_LABEL: Record<SignalDirection, string> = {
  up: '上行',
  down: '下行',
};

const DIRECTION_MARK: Record<SignalDirection, string> = {
  up: '↑',
  down: '↓',
};

const emptyDirectionStats = () => ({
  rows: 0,
  packets: 0,
  bytes: 0,
});

const createDirectionStats = (rows: SignalSidebarRow[]) => {
  const stats: Record<SignalDirection, ReturnType<typeof emptyDirectionStats>> = {
    up: emptyDirectionStats(),
    down: emptyDirectionStats(),
  };

  rows.forEach(row => {
    const target = stats[row.direction];
    target.rows += 1;
    target.packets += row.packetCount;
    target.bytes += row.bytes ?? 0;
  });

  return stats;
};

const formatBytes = (bytes?: number) => {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
};

const formatMeta = (row: SignalSidebarRow) => {
  const parts = [
    row.transport,
    row.protocolName ?? (row.protocolId === undefined ? undefined : `p${row.protocolId}`),
    row.commandName ?? (row.commandId === undefined ? undefined : `c${row.commandId}`),
    row.audioSignal && row.packetCount > 1 ? `x${row.packetCount}` : undefined,
    formatBytes(row.bytes),
  ].filter(Boolean);

  return parts.join(' · ');
};

const renderRows = (rows: SignalSidebarRow[], emptyText: string, showDirection: boolean) => {
  if (rows.length === 0) {
    return <div className={styles.empty}>{emptyText}</div>;
  }

  return (
    <ol className={styles.traceList}>
      {rows.map(row => (
        <li
          key={row.id}
          className={`${styles.traceItem} ${row.direction === 'up' ? styles.traceItemUp : styles.traceItemDown}`}
        >
          <div className={styles.traceHeader}>
            <span className={styles.traceTitle}>
              {showDirection && (
                <span className={`${styles.directionPill} ${row.direction === 'up' ? styles.directionUp : styles.directionDown}`}>
                  {DIRECTION_MARK[row.direction]} {DIRECTION_LABEL[row.direction]}
                </span>
              )}
              <span className={styles.traceType}>{row.type}</span>
            </span>
            <span className={styles.traceTime}>{row.clock}</span>
          </div>
          <div className={styles.traceMeta}>{formatMeta(row)}</div>
          {row.sessionId && <div className={styles.traceSession}>{row.sessionId}</div>}
          {row.summary && <div className={styles.traceSummary}>{row.summary}</div>}
        </li>
      ))}
    </ol>
  );
};

export const SignalSidebar = ({
  collapsed,
  rows,
  onToggle,
}: SignalSidebarProps) => {
  const [mode, setMode] = useState<SignalSidebarMode>('timeline');
  const directionStats = createDirectionStats(rows);
  const totalRows = directionStats.up.rows + directionStats.down.rows;
  const upPercent = totalRows === 0 ? 50 : Math.round((directionStats.up.rows / totalRows) * 100);
  const downPercent = totalRows === 0 ? 50 : 100 - upPercent;

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`} data-testid="signal-sidebar">
      <button
        type="button"
        className={styles.toggleButton}
        aria-label={collapsed ? '展开信令侧边栏' : '收起信令侧边栏'}
        title={collapsed ? '展开信令侧边栏' : '收起信令侧边栏'}
        onClick={onToggle}
      >
        {collapsed ? '‹' : '›'}
      </button>

      {collapsed ? (
        <div className={styles.rail}>
          <span className={styles.railTitle}>信令</span>
          <span className={styles.railCount}>{rows.length}</span>
        </div>
      ) : (
        <div className={styles.content}>
          <header className={styles.header}>
            <div>
              <h2 className={styles.title}>信令</h2>
              <p className={styles.subtitle}>连续音频包合并展示</p>
            </div>
            <div className={styles.totalRows}>{rows.length}</div>
          </header>

          <div className={styles.directionCompare}>
            <div className={`${styles.compareMetric} ${styles.compareMetricUp}`}>
              <span>{DIRECTION_MARK.up} 上行</span>
              <strong>{directionStats.up.rows}</strong>
              <small>{directionStats.up.packets} 包 · {formatBytes(directionStats.up.bytes) ?? '0B'}</small>
            </div>
            <div className={`${styles.compareMetric} ${styles.compareMetricDown}`}>
              <span>{DIRECTION_MARK.down} 下行</span>
              <strong>{directionStats.down.rows}</strong>
              <small>{directionStats.down.packets} 包 · {formatBytes(directionStats.down.bytes) ?? '0B'}</small>
            </div>
          </div>

          <div className={styles.compareBar} aria-label="上下行信令比例">
            <span className={styles.compareBarUp} style={{ flexBasis: `${upPercent}%` }} />
            <span className={styles.compareBarDown} style={{ flexBasis: `${downPercent}%` }} />
          </div>

          <div className={styles.modeSwitch} role="group" aria-label="信令展示模式">
            {MODE_OPTIONS.map(option => (
              <button
                key={option.mode}
                type="button"
                className={`${styles.modeButton} ${mode === option.mode ? styles.modeButtonActive : ''}`}
                onClick={() => setMode(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === 'timeline' ? (
            <section className={styles.timelineSection}>
              {renderRows(rows, '暂无信令', true)}
            </section>
          ) : (
            <div className={styles.sections}>
              {DIRECTIONS.map(direction => (
                <section key={direction} className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <span>{DIRECTION_MARK[direction]} {DIRECTION_LABEL[direction]}</span>
                    <span>{directionStats[direction].rows} 行 / {directionStats[direction].packets} 包</span>
                  </div>
                  {renderRows(rows.filter(row => row.direction === direction), `暂无${DIRECTION_LABEL[direction]}信令`, false)}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
