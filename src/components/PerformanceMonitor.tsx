import styles from '../App.module.scss';
import type { ResponseMetrics } from '../app/architectureDecisions';
import { TrendChart } from './TrendChart';

interface PerformanceMonitorProps {
  enabled: boolean;
  visible: boolean;
  metrics: ResponseMetrics;
  onToggleEnabled: () => void;
  onToggleVisible: () => void;
}

const getLatencyColor = (latency: number): string => {
  if (latency === 0) return '';
  if (latency < 1000) return styles.excellent;
  if (latency < 2000) return styles.good;
  return styles.poor;
};

export const PerformanceMonitor = ({
  enabled,
  visible,
  metrics,
  onToggleEnabled,
  onToggleVisible,
}: PerformanceMonitorProps) => (
  <div className={`${styles.performanceMonitor} ${visible ? styles.visible : styles.hidden}`}>
    <div className={styles.performanceHeader}>
      <h4>实时响应监控</h4>
      <div className={styles.headerButtons}>
        <button
          className={`${styles.toggleButton} ${enabled ? styles.enabled : styles.disabled}`}
          onClick={onToggleEnabled}
          title={enabled ? '关闭性能监控' : '开启性能监控'}
          type="button"
        >
          {enabled ? '⏸' : '▶'}
        </button>
        <button
          className={styles.toggleButton}
          onClick={onToggleVisible}
          title="展开/收起"
          type="button"
        >
          {visible ? '−' : '+'}
        </button>
      </div>
    </div>

    {visible && (
      <div className={styles.performanceContent}>
        <div className={styles.metricsGrid}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>平均音频延迟</span>
            <span className={`${styles.metricValue} ${getLatencyColor(metrics.averageAudioLatency)}`}>
              {metrics.averageAudioLatency > 0 ? `${metrics.averageAudioLatency.toFixed(0)}ms` : '--'}
            </span>
          </div>

          <div className={styles.metric}>
            <span className={styles.metricLabel}>最近音频延迟</span>
            <span className={`${styles.metricValue} ${getLatencyColor(metrics.lastAudioLatency)}`}>
              {metrics.lastAudioLatency > 0 ? `${metrics.lastAudioLatency.toFixed(0)}ms` : '--'}
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>对话轮次</span>
            <span className={styles.metricValue}>{metrics.totalInteractions}</span>
          </div>

          <div className={styles.metric}>
            <span className={styles.metricLabel}>计时精度</span>
            <span className={`${styles.metricValue} ${metrics.isTimingActive ? styles.timing : styles.excellent}`}>
              {metrics.isTimingActive ? '高精度计时中...' : '1ms精度'}
            </span>
          </div>
        </div>

        {metrics.audioResponseTimes.length > 1 && (
          <TrendChart responseMetrics={metrics} />
        )}
      </div>
    )}
  </div>
);
