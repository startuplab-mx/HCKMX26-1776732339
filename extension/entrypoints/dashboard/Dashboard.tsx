import { useEffect, useState } from 'preact/hooks';
import './Dashboard.css';

type SeverityKey = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type DashboardState = {
  todayOccurrences: number;
  weekOccurrences: number;
  avgPerDay: number;
  onlineMinutesToday: number;
  limitHours: number;
  activeAlerts: number;
  needReview: number;
  occurrencesBySeverity: Record<SeverityKey, number>;
  recentAlerts: Array<{ ts: string; url: string; risk: SeverityKey; totalScore: number }>;
  recentSites: Array<{ host: string; count: number }>;
  recentUsers: Array<{ label: string; count: number }>;
};

const pillClass = (risk: SeverityKey) =>
  risk === 'HIGH' || risk === 'CRITICAL'
    ? 'pill pillHigh'
    : risk === 'MEDIUM'
      ? 'pill pillMed'
      : 'pill pillLow';

export default function Dashboard() {
  // Quick v0: read from storage (populated by background/content)
  const [state, setState] = useState<DashboardState | null>(null);

  useEffect(() => {
    const load = async () => {
      const result = await browser.storage.local.get('lumihover.dashboard.v1');
      setState((result['lumihover.dashboard.v1'] as DashboardState) ?? null);
    };
    void load();

    const onChanged = (changes: Record<string, any>, area: string) => {
      if (area !== 'local') return;
      if (!changes['lumihover.dashboard.v1']) return;
      setState(changes['lumihover.dashboard.v1'].newValue ?? null);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  const data: DashboardState =
    state ??
    ({
      todayOccurrences: 0,
      weekOccurrences: 0,
      avgPerDay: 0,
      onlineMinutesToday: 0,
      limitHours: 2,
      activeAlerts: 0,
      needReview: 0,
      occurrencesBySeverity: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      recentAlerts: [],
      recentSites: [],
      recentUsers: [],
    } satisfies DashboardState);

  const chart = [
    { key: 'LOW' as const, label: 'Low', value: data.occurrencesBySeverity.LOW, fill: 'barFill barFillLow' },
    {
      key: 'MEDIUM' as const,
      label: 'Medium',
      value: data.occurrencesBySeverity.MEDIUM,
      fill: 'barFill barFillMed',
    },
    { key: 'HIGH' as const, label: 'High', value: data.occurrencesBySeverity.HIGH, fill: 'barFill barFillHigh' },
  ];
  const max = Math.max(1, ...chart.map((c) => c.value));

  return (
    <main className="dash">
      <header className="dashHeader">
        <h1 className="dashTitle">Control parental</h1>
        <p className="dashMeta">Datos basados en keywords/ocurrencias detectadas</p>
      </header>

      <section className="grid">
        <div className="panel">
          <h2 className="panelTitle">Resumen</h2>
          <div className="kpis">
            <div className="kpi">
              <p className="kpiLabel">Ocurrencias hoy</p>
              <p className="kpiValue">{data.todayOccurrences}</p>
            </div>
            <div className="kpi">
              <p className="kpiLabel">Total esta semana</p>
              <p className="kpiValue">{data.weekOccurrences}</p>
            </div>
            <div className="kpi">
              <p className="kpiLabel">Promedio</p>
              <p className="kpiValue">{data.avgPerDay}</p>
              <p className="kpiSub">por día</p>
            </div>
            <div className="kpi">
              <p className="kpiLabel">Tiempo en línea hoy</p>
              <p className="kpiValue">{Math.round(data.onlineMinutesToday / 60)}h</p>
              <p className="kpiSub">{data.onlineMinutesToday} min</p>
            </div>
            <div className="kpi">
              <p className="kpiLabel">Límite (horas)</p>
              <p className="kpiValue">{data.limitHours}</p>
            </div>
            <div className="kpi">
              <p className="kpiLabel">Alertas activas</p>
              <p className="kpiValue">{data.activeAlerts}</p>
              <p className="kpiSub">Requieren revisión: {data.needReview}</p>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2 className="panelTitle">Ocurrencias por riesgo</h2>
          <div className="chartRows">
            {chart.map((row) => (
              <div className="chartRow" key={row.key}>
                <div className="chartLabel">{row.label}</div>
                <div className="barTrack">
                  <div
                    className={row.fill}
                    style={{ width: `${Math.round((row.value / max) * 100)}%` }}
                  />
                </div>
                <div className="chartLabel" style={{ textAlign: 'right' }}>
                  {row.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2 className="panelTitle">Alertas recientes</h2>
          <div className="list">
            {data.recentAlerts.length === 0 ? (
              <div className="item">
                <div className="itemTop">
                  <div className="itemTitle">Sin alertas</div>
                  <span className="pill pillLow">OK</span>
                </div>
                <div className="itemSub">Cuando haya alertas MEDIUM/HIGH aparecerán aquí.</div>
              </div>
            ) : (
              data.recentAlerts.slice(0, 6).map((a) => (
                <div className="item" key={`${a.ts}-${a.url}`}>
                  <div className="itemTop">
                    <div className="itemTitle">{new URL(a.url).host}</div>
                    <span className={pillClass(a.risk)}>{a.risk}</span>
                  </div>
                  <div className="itemSub">
                    {new Date(a.ts).toLocaleString()} · score {a.totalScore.toFixed(1)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <h2 className="panelTitle">Sitios y juegos visitados</h2>
          <div className="list">
            {(data.recentSites.length ? data.recentSites : [{ host: '—', count: 0 }]).slice(0, 6).map((s) => (
              <div className="item" key={s.host}>
                <div className="itemTop">
                  <div className="itemTitle">{s.host}</div>
                  <span className="pill pillLow">{s.count}</span>
                </div>
                <div className="itemSub">conteo (v0)</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2 className="panelTitle">Usuarios con los que interactúa</h2>
          <div className="list">
            {(data.recentUsers.length ? data.recentUsers : [{ label: '—', count: 0 }]).slice(0, 6).map((u) => (
              <div className="item" key={u.label}>
                <div className="itemTop">
                  <div className="itemTitle">{u.label}</div>
                  <span className="pill pillLow">{u.count}</span>
                </div>
                <div className="itemSub">detección por keywords (v0)</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

