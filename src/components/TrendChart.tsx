import React, { useMemo } from 'react';
import styles from '../App.module.scss';
import type { ResponseMetrics } from '../app/architectureDecisions';

interface TrendChartProps {
  responseMetrics: ResponseMetrics;
}

export const TrendChart = React.memo(({ responseMetrics }: TrendChartProps) => {
  const trendData = useMemo(() => {
    const times = responseMetrics.audioResponseTimes.slice(-10);
    return {
      times,
      minTime: Math.min(...responseMetrics.audioResponseTimes),
      maxTime: Math.max(...responseMetrics.audioResponseTimes),
    };
  }, [responseMetrics.audioResponseTimes]);

  return (
    <div className={styles.responseTrend}>
      <div className={styles.trendLabel}>音频响应延迟趋势（最近10次）</div>
      <div className={styles.trendBars}>
        {trendData.times.map((time: number, index: number) => (
          <div
            key={index}
            className={styles.trendBar}
            style={{
              height: `${Math.min(time / 20, 50)}px`,
              backgroundColor: time < 1000 ? '#4CAF50' : time < 2000 ? '#FF9800' : '#F44336',
            }}
            title={`第${responseMetrics.audioResponseTimes.length - 9 + index}次: ${time.toFixed(0)}ms`}
          />
        ))}
      </div>
      <div className={styles.trendStats}>
        <span>最快: {trendData.minTime.toFixed(1)}ms</span>
        <span>最慢: {trendData.maxTime.toFixed(1)}ms</span>
        <span>精度: 1ms</span>
      </div>
    </div>
  );
});

TrendChart.displayName = 'TrendChart';
