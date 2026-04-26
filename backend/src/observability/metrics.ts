type MetricValue = {
  count: number;
  totalMs: number;
};

const stageMetrics = new Map<string, MetricValue>();
const errorCounters = new Map<string, number>();

export const observeStageDuration = (stage: string, durationMs: number): void => {
  const current = stageMetrics.get(stage) ?? { count: 0, totalMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  stageMetrics.set(stage, current);
};

export const incrementErrorCounter = (key: string): void => {
  errorCounters.set(key, (errorCounters.get(key) ?? 0) + 1);
};

export const getMetricsSnapshot = (): Record<string, unknown> => {
  const stages = Array.from(stageMetrics.entries()).reduce<Record<string, unknown>>((acc, [stage, value]) => {
    acc[stage] = {
      count: value.count,
      avgMs: value.count > 0 ? Number((value.totalMs / value.count).toFixed(2)) : 0,
      totalMs: Number(value.totalMs.toFixed(2)),
    };
    return acc;
  }, {});

  return {
    stages,
    errors: Object.fromEntries(errorCounters.entries()),
  };
};
