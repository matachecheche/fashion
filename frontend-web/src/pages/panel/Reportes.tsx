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

export const ReportesPage: React.FC = () => {
  const { tenantSlug, mostrarToast } = useApp();
  const [comando, setComando] = useState('Ventas confirmadas del mes por sucursal');
  const [resultado, setResultado] = useState<ReporteResultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ml, setMl] = useState<any | null>(null);
  const [vozActiva, setVozActiva] = useState(false);

  useEffect(() => {
    apiFetch('/ia/ml/metricas?seed=2026&holdout=0.25', { tenantSlug })
      .then(setMl)
      .catch(() => setMl(null));
  }, [tenantSlug]);

  const ejecutar = async (cmd?: string) => {
    const q = (cmd ?? comando).trim();
    if (!q) return;
    setCargando(true);
    try {
      const res = await apiFetch<ReporteResultado>('/reportes/ia/consultar', {
        method: 'POST',
        tenantSlug,
        body: { comando: q },
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
    if (!SR) {
      mostrarToast('Dictado por voz no soportado en este navegador. Escribe el comando.');
      return;
    }
    const rec = new SR();
    rec.lang = 'es-BO';
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const texto = Array.from(e.results)
        .map((r: any) => r[0]?.transcript || '')
        .join(' ')
        .trim();
      if (texto) {
        setComando(texto);
        ejecutar(texto);
      }
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
        subtitulo="Interpreta comandos en español con IA (FastAPI + fallback local) y exporta el resultado real en PDF, Excel (.xlsx) y CSV seguro."
      />

      <div className="fs-card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            className="fs-input"
            style={{ flex: '1 1 220px', minWidth: 0 }}
            value={comando}
            onChange={(e) => setComando(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ejecutar()}
            placeholder="Ej: Ventas confirmadas por sucursal del mes"
          />
          <button
            className={`fs-btn fs-btn-outline ${vozActiva ? 'voz-activa' : ''}`}
            onClick={dictarPorVoz}
            title="Dictar comando en español"
          >
            🎤 {vozActiva ? 'Escuchando…' : 'Voz'}
          </button>
          <button className="fs-btn fs-btn-accent" onClick={() => ejecutar()} disabled={cargando}>
            {cargando ? 'Analizando…' : 'Generar'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
          {COMANDOS_SUGERIDOS.map((c) => (
            <button key={c} className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => { setComando(c); ejecutar(c); }}>
              {c}
            </button>
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
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => exportar('pdf')}>
                📄 PDF
              </button>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => exportar('excel')}>
                📊 Excel
              </button>
              <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => exportar('csv')}>
                📑 CSV
              </button>
            </div>
          </div>

          {(resultado.kpis || []).length > 0 && (
            <div className="fs-grid-kpi">
              {resultado.kpis.map((k, i) => (
                <KpiCard key={i} titulo={k.etiqueta} valor={String(k.valor)} color="#b45309" />
              ))}
            </div>
          )}

          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  {(resultado.columnas || []).map((c) => (
                    <th key={c.key}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(resultado.filas || []).slice(0, 50).map((fila, idx) => (
                  <tr key={idx}>
                    {(resultado.columnas || []).map((c) => (
                      <td key={c.key}>{String(fila[c.key] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="fs-card">
        <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>🧪 Machine Learning — Métricas en Holdout (FastAPI)</h3>
        {!ml ? (
          <p style={{ color: '#64748b' }}>No se pudieron obtener las métricas ML (¿servicio FastAPI apagado?).</p>
        ) : (
          <div className="fs-grid" style={{ gap: '0.6rem', fontSize: '0.88rem' }}>
            <div>
              <strong>Regresión Logística (propensión de compra / quiebre de stock):</strong>
              <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '0.7rem', borderRadius: 8, overflow: 'auto' }}>
                {JSON.stringify(ml.regresion_logistica ?? ml.logistic_regression ?? ml.modelos ?? ml, null, 2)}
              </pre>
            </div>
            <div>
              <strong>K-Means (k=3, segmentación de clientes):</strong>
              <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: '0.7rem', borderRadius: 8, overflow: 'auto' }}>
                {JSON.stringify(ml.kmeans ?? ml.clustering ?? ml.modelos?.kmeans ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default ReportesPage;
