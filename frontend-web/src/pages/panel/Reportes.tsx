import React, { useEffect, useState } from 'react';
import { PanelHeader } from '../../components/panel';
import { KpiCard } from '../../components/ui';
import { apiFetch, descargarReporteBinario } from '../../api/client';
import { useApp } from '../../context/App';

const COMANDOS_SUGERIDOS = [
  'Ventas confirmadas del mes por sucursal',
  'Stock crítico con alertas de reposición',
  'Top productos más vendidos',
  'Ventas pendientes de pago',
];

type JsonRecord = Record<string, any>;
interface ReporteResultado {
  titulo: string;
  subtitulo: string;
  interpretacion_ia: string;
  modo_ia: string;
  parametros: Record<string, any>;
  kpis: Array<{ etiqueta: string; valor: string | number }>;
  columnas: Array<{ key: string; header: string; width?: number }>;
  filas: Array<Record<string, any>>;
}

const asRecord = (value: unknown): JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
const asArray = (value: unknown): JsonRecord[] => Array.isArray(value)
  ? value.filter((item): item is JsonRecord => typeof item === 'object' && item !== null && !Array.isArray(item))
  : [];
const numeric = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const percent = (metrics: JsonRecord, key: string): string => {
  const pct = numeric(metrics[`${key}_pct`]);
  if (pct !== null) return `${pct.toFixed(1)}%`;
  const ratio = numeric(metrics[key]);
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`;
};
const count = (value: unknown): string => {
  const parsed = numeric(value);
  return parsed === null ? '—' : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 }).format(parsed);
};
const bs = (value: unknown): string => {
  const parsed = numeric(value);
  return parsed === null ? '—' : `Bs. ${parsed.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const LABELS: Record<string, string> = {
  dias_desde_compra: 'Días desde la última compra',
  compras_12m: 'Compras en 12 meses',
  gasto_12m_bs: 'Gasto en 12 meses',
  interacciones_30d: 'Interacciones en 30 días',
  stock_disponible: 'Stock disponible',
  ventas_30d: 'Ventas en 30 días',
  rotacion_diaria: 'Rotación diaria',
  plazo_reposicion_dias: 'Plazo de reposición',
  indice_temporada: 'Índice de temporada',
};
const readableCell = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(readableCell).filter((part) => part !== '—').join(' · ') || '—';
  const entries = Object.entries(asRecord(value)).filter(([, item]) =>
    item === null || ['string', 'number', 'boolean'].includes(typeof item),
  );
  return entries.map(([key, item]) => `${LABELS[key] || key.replace(/_/g, ' ')}: ${readableCell(item)}`).join(' · ') || 'Detalle disponible';
};

const MetricasClasificacion: React.FC<{
  titulo: string;
  descripcion: string;
  metricas: JsonRecord;
  positiveLabel: string;
}> = ({ titulo, descripcion, metricas, positiveLabel }) => {
  const matrix = asRecord(metricas.matriz_confusion);
  const hasMetrics = Object.keys(metricas).length > 0;
  return (
    <section className="fs-card" style={{ display: 'grid', gap: '0.85rem' }}>
      <div>
        <h3 style={{ margin: '0 0 0.2rem', fontSize: '1rem' }}>{titulo}</h3>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>{descripcion}</p>
      </div>
      {!hasMetrics ? <p style={{ margin: 0, color: '#64748b' }}>No hay métricas disponibles para este modelo.</p> : (
        <>
          <div className="fs-grid-kpi">
            <KpiCard titulo="Exactitud" valor={percent(metricas, 'accuracy')} color="#0f766e" />
            <KpiCard titulo="Precisión" valor={percent(metricas, 'precision')} color="#1d4ed8" />
            <KpiCard titulo="Sensibilidad (recall)" valor={percent(metricas, 'recall')} color="#7c3aed" />
            <KpiCard titulo="Puntuación F1" valor={percent(metricas, 'f1')} color="#b45309" />
            <KpiCard titulo="Muestras evaluadas" valor={count(metricas.muestras_evaluadas)} color="#334155" />
          </div>
          <div>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Matriz de confusión</h4>
            <div className="fs-table-wrap">
              <table className="fs-table">
                <thead><tr><th>Resultado real</th><th>Predijo {positiveLabel}</th><th>Predijo no {positiveLabel.toLowerCase()}</th></tr></thead>
                <tbody>
                  <tr><th>{positiveLabel}</th><td>{count(matrix.tp)}</td><td>{count(matrix.fn)}</td></tr>
                  <tr><th>No {positiveLabel.toLowerCase()}</th><td>{count(matrix.fp)}</td><td>{count(matrix.tn)}</td></tr>
                </tbody>
              </table>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.76rem', margin: '0.4rem 0 0' }}>
              TP: aciertos positivos · FP: falsas alarmas · TN: aciertos negativos · FN: casos positivos no detectados.
            </p>
          </div>
        </>
      )}
    </section>
  );
};

const AnaliticaML: React.FC<{ data: JsonRecord | null; loading: boolean; error: string | null }> = ({ data, loading, error }) => {
  if (loading) return <section className="fs-card"><h3 style={{ marginTop: 0 }}>🧪 Analítica y aprendizaje automático</h3><p style={{ color: '#64748b' }}>Cargando métricas de evaluación…</p></section>;
  if (error || !data) return <section className="fs-card"><h3 style={{ marginTop: 0 }}>🧪 Analítica y aprendizaje automático</h3><p style={{ color: '#64748b' }}>{error || 'No se pudieron obtener las métricas.'}</p></section>;

  const modelos = asRecord(data.modelos);
  const supervisado = asRecord(data.supervisado);
  const propension = asRecord(asRecord(modelos.propension_compra).holdout_metrics);
  const riesgoStock = asRecord(asRecord(modelos.riesgo_quiebre_stock).holdout_metrics);
  const metricasCompra = Object.keys(propension).length ? propension : asRecord(supervisado.metricas_holdout);
  const auxiliarStock = asRecord(supervisado.modelo_auxiliar_quiebre_stock);
  const metricasStock = Object.keys(riesgoStock).length ? riesgoStock : asRecord(auxiliarStock.metricas_holdout);
  const segmentacion = asRecord(modelos.segmentacion_clientes);
  const noSupervisado = asRecord(data.no_supervisado);
  const segmentos = asArray(segmentacion.segmentos).length ? asArray(segmentacion.segmentos) : asArray(noSupervisado.segmentos);
  const k = numeric(segmentacion.k_seleccionado ?? noSupervisado.k_elegido) ?? 3;
  const muestras = numeric(noSupervisado.muestras_analizadas) ?? segmentos.reduce((sum, item) => sum + (numeric(item.tamano) ?? 0), 0);

  return (
    <section className="fs-grid" style={{ gap: '1rem' }}>
      <div className="fs-card">
        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem' }}>🧪 Machine Learning — Evaluación de modelos</h3>
        <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>
          Resultados de validación con muestras separadas para evaluación. Semilla reproducible: {count(data.semilla)}.
        </p>
        <div style={{ marginTop: '0.65rem', padding: '0.7rem 0.85rem', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: '0.82rem' }}>
          Datos demostrativos sintéticos: estas métricas sirven para evaluar el ejemplo académico; no describen predicciones sobre clientes o inventario real.
        </div>
      </div>

      <MetricasClasificacion
        titulo="Propensión de recompra"
        descripcion="Regresión logística · estima la probabilidad de recompra en los próximos 30 días."
        metricas={metricasCompra}
        positiveLabel="recompra"
      />
      <MetricasClasificacion
        titulo="Riesgo de quiebre de stock"
        descripcion="Clasificador auxiliar · identifica muestras con riesgo de quedarse sin existencias."
        metricas={metricasStock}
        positiveLabel="quiebre"
      />

      <div className="fs-card" style={{ display: 'grid', gap: '0.75rem' }}>
        <div>
          <h3 style={{ margin: '0 0 0.2rem', fontSize: '1rem' }}>Segmentación de clientes (K-Means)</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem' }}>Agrupación demostrativa de perfiles de compra en {k} segmentos, sobre {count(muestras)} muestras.</p>
        </div>
        {segmentos.length === 0 ? <p style={{ color: '#64748b' }}>No hay segmentos disponibles.</p> : (
          <div className="fs-grid-kpi">
            {segmentos.map((segmento, index) => {
              const centro = asRecord(segmento.centroide_original);
              return (
                <article key={`${segmento.cluster_id ?? index}-${index}`} className="fs-card" style={{ border: '1px solid #e2e8f0', boxShadow: 'none' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 5 }}>{readableCell(segmento.nombre_segmento || `Segmento ${index + 1}`)}</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#92400e' }}>{count(segmento.tamano)} <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>personas</span></div>
                  <div style={{ color: '#475569', fontSize: '0.82rem' }}>{numeric(segmento.porcentaje)?.toFixed(1) ?? '—'}% del conjunto</div>
                  <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8, display: 'grid', gap: 4, fontSize: '0.78rem', color: '#475569' }}>
                    <span>Compras/año: {count(centro.compras_12m)}</span>
                    <span>Gasto/año: {bs(centro.gasto_12m_bs)}</span>
                    <span>Última compra: {count(centro.dias_desde_compra)} días</span>
                  </div>
                  {segmento.decision_negocio ? <p style={{ fontSize: '0.78rem', lineHeight: 1.45, color: '#334155', margin: '0.55rem 0 0' }}>{readableCell(segmento.decision_negocio)}</p> : null}
                </article>
              );
            })}
          </div>
        )}
        <p style={{ color: '#64748b', fontSize: '0.76rem', margin: 0 }}>La segmentación es orientativa y sintética. Requiere validación humana antes de tomar decisiones comerciales.</p>
      </div>
    </section>
  );
};

export const ReportesPage: React.FC = () => {
  const { tenantSlug, mostrarToast } = useApp();
  const [comando, setComando] = useState('Ventas confirmadas del mes por sucursal');
  const [resultado, setResultado] = useState<ReporteResultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ml, setMl] = useState<JsonRecord | null>(null);
  const [mlLoading, setMlLoading] = useState(true);
  const [mlError, setMlError] = useState<string | null>(null);
  const [vozActiva, setVozActiva] = useState(false);

  useEffect(() => {
    let mounted = true;
    setMlLoading(true);
    setMlError(null);
    apiFetch<JsonRecord>('/ia/ml/metricas?seed=2026&holdout=0.25', { tenantSlug })
      .then((data) => { if (mounted) setMl(data); })
      .catch((err: unknown) => { if (mounted) setMlError(err instanceof Error ? err.message : 'No se pudieron cargar las métricas ML.'); })
      .finally(() => { if (mounted) setMlLoading(false); });
    return () => { mounted = false; };
  }, [tenantSlug]);

  const ejecutar = async (cmd?: string) => {
    const q = (cmd ?? comando).trim();
    if (!q) return;
    setCargando(true);
    try {
      const res = await apiFetch<ReporteResultado>('/reportes/ia/consultar', {
        method: 'POST', tenantSlug, body: { comando: q },
      });
      setResultado(res);
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo generar el reporte.');
    } finally {
      setCargando(false);
    }
  };

  const exportar = async (formato: 'pdf' | 'excel' | 'csv') => {
    try {
      await descargarReporteBinario(comando, formato, tenantSlug);
      mostrarToast(`Reporte exportado en formato ${formato.toUpperCase()}.`);
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo descargar el archivo.');
    }
  };

  const dictarPorVoz = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { mostrarToast('Dictado por voz no soportado en este navegador. Escribe el comando.'); return; }
    const rec = new SR();
    rec.lang = 'es-BO';
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const texto = Array.from(e.results).map((r: any) => r[0]?.transcript || '').join(' ').trim();
      if (texto) { setComando(texto); ejecutar(texto); }
    };
    rec.onend = () => setVozActiva(false);
    rec.onerror = () => setVozActiva(false);
    setVozActiva(true);
    rec.start();
  };

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="🎙️ Reportes por Voz / Texto y Ciencia de Datos"
        subtitulo="Interpreta comandos en español con IA (FastAPI + fallback local) y exporta resultados en PDF, Excel (.xlsx) y CSV."
      />

      <div className="fs-card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input className="fs-input" style={{ flex: '1 1 220px', minWidth: 0 }} value={comando}
            onChange={(e) => setComando(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ejecutar()}
            placeholder="Ej: Ventas confirmadas por sucursal del mes" />
          <button className={`fs-btn fs-btn-outline ${vozActiva ? 'voz-activa' : ''}`} onClick={dictarPorVoz} title="Dictar comando en español">
            🎤 {vozActiva ? 'Escuchando…' : 'Voz'}
          </button>
          <button className="fs-btn fs-btn-accent" onClick={() => ejecutar()} disabled={cargando}>
            {cargando ? 'Analizando…' : 'Generar'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
          {COMANDOS_SUGERIDOS.map((c) => (
            <button key={c} className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => { setComando(c); ejecutar(c); }}>{c}</button>
          ))}
        </div>
      </div>

      {resultado && (
        <div className="fs-card fs-grid" style={{ gap: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.15rem' }}>{resultado.titulo}</h2>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{resultado.subtitulo}</div>
              <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
                <span className="fs-badge fs-badge-ok">IA: {resultado.modo_ia}</span>{' '}
                <span style={{ color: '#475569' }}>{resultado.interpretacion_ia}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => exportar('pdf')}>📄 PDF</button>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => exportar('excel')}>📊 Excel</button>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => exportar('csv')}>📑 CSV</button>
            </div>
          </div>
          {(resultado.kpis || []).length > 0 && (
            <div className="fs-grid-kpi">
              {resultado.kpis.map((k, i) => <KpiCard key={i} titulo={k.etiqueta} valor={readableCell(k.valor)} color="#b45309" />)}
            </div>
          )}
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead><tr>{(resultado.columnas || []).map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
              <tbody>
                {(resultado.filas || []).slice(0, 50).map((fila, idx) => (
                  <tr key={idx}>{(resultado.columnas || []).map((c) => <td key={c.key}>{readableCell(fila[c.key])}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {(resultado.filas || []).length === 0 && <p style={{ color: '#64748b', padding: '0.75rem' }}>La consulta no devolvió registros.</p>}
          </div>
        </div>
      )}

      <AnaliticaML data={ml} loading={mlLoading} error={mlError} />
    </div>
  );
};
export default ReportesPage;
