import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useApp } from '../context/App';
import { formatBs } from '../lib/format';

export const AsistenteFlotante: React.FC = () => {
  const { tenantSlug } = useApp();
  const sesionId = useRef(`web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);
  const [historial, setHistorial] = useState<
    Array<{
      autor: 'usuario' | 'ia';
      texto: string;
      proveedor?: string;
      sugerencias?: any[];
      fuentes?: string[];
      baseDatos?: boolean;
      modelo?: string | null;
      modoRespuesta?: string;
      diagnostico?: string;
      erroresProveedor?: Record<string, string>;
    }>
  >([
    {
      autor: 'ia',
      texto:
        '¡Hola! Soy el Asesor Virtual IA de tu boutique. Puedo ayudarte con combinaciones, tallas, recomendaciones y consultas sobre el catálogo y la operación de tu tienda.',
    },
  ]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mensaje.trim() || cargando) return;
    const textoUsuario = mensaje.trim();
    setMensaje('');
    setHistorial((prev) => [...prev, { autor: 'usuario', texto: textoUsuario }]);
    setCargando(true);
    try {
      const historialChat = historial.slice(-8).map((item) => ({
        role: item.autor === 'usuario' ? 'user' : 'assistant',
        content: item.texto.slice(0, 800),
      }));
      const res = await apiFetch('/ia/chat', {
        method: 'POST',
        tenantSlug,
        body: { mensaje: textoUsuario, sesion_id: sesionId.current, historial: historialChat },
      });
      setHistorial((prev) => [
        ...prev,
        {
          autor: 'ia',
          texto: res.respuesta,
          proveedor: res.proveedor || res.modo_ia || 'local_rules',
          modelo: res.modelo || null,
          modoRespuesta: res.modo_respuesta || '',
          diagnostico: res.diagnostico || '',
          erroresProveedor: res.errores_proveedor || {},
          sugerencias: res.sugerencias || res.productos_sugeridos || [],
          fuentes: res.datos_consultados?.fuentes || [],
          baseDatos: Boolean(res.datos_consultados?.base_datos),
        },
      ]);
    } catch {
      setHistorial((prev) => [
        ...prev,
        {
          autor: 'ia',
          texto: 'No pude conectar con el asistente en este momento. No pude verificar datos de la tienda; revisa tu conexión e inténtalo nuevamente.',
          proveedor: 'offline_fallback',
        },
      ]);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="fs-fab-assistant">
      {abierto ? (
        <div
          className="fs-card"
          style={{
            width: 360,
            maxHeight: 500,
            display: 'flex',
            flexDirection: 'column',
            padding: '1rem',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.22)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingBottom: '0.6rem',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div>
              <strong style={{ fontSize: '0.95rem' }}>✨ Asesor de Moda IA</strong>
              <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                Tienda: <code>{tenantSlug}</code> (Contexto aislado)
              </div>
            </div>
            <button className="fs-btn fs-btn-outline fs-btn-sm" onClick={() => setAbierto(false)}>
              ✕
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '0.75rem 0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
              maxHeight: 330,
            }}
          >
            {historial.map((m, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: m.autor === 'usuario' ? 'flex-end' : 'flex-start',
                  background: m.autor === 'usuario' ? '#1e293b' : '#f1f5f9',
                  color: m.autor === 'usuario' ? '#fff' : '#0f172a',
                  padding: '0.6rem 0.8rem',
                  borderRadius: 10,
                  maxWidth: '88%',
                  fontSize: '0.85rem',
                }}
              >
                <div>{m.texto}</div>
                {m.proveedor && (
                  <div style={{ fontSize: '0.68rem', opacity: 0.75, marginTop: 4 }}>
                    Motor: {m.proveedor === 'groq'
                      ? 'Groq'
                      : m.proveedor === 'gemini'
                        ? 'Gemini'
                        : m.proveedor === 'local_rules'
                          ? (m.modoRespuesta === 'datos_verificados' ? 'Consulta verificada en tienda' : 'Respaldo local · IA generativa no disponible')
                          : 'Sin conexión'}
                    {m.modelo ? ` · ${m.modelo}` : ''}
                  </div>
                )}
                {m.diagnostico && (
                  <div style={{ fontSize: '0.68rem', color: '#9a3412', marginTop: 3 }}>
                    Diagnóstico técnico: {m.diagnostico}
                  </div>
                )}
                {m.erroresProveedor && Object.entries(m.erroresProveedor).map(([motor, error]) => (
                  <div key={motor} style={{ fontSize: '0.68rem', color: '#9a3412', marginTop: 2 }}>
                    {motor}: {error}
                  </div>
                ))}
                {m.baseDatos !== undefined && (
                  <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 3 }}>
                    {m.baseDatos ? 'Base de datos consultada' : 'Base de datos no consultada'}
                  </div>
                )}
                {m.fuentes && m.fuentes.length > 0 && (
                  <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 3 }}>
                    Consulté: {m.fuentes.join(', ')}
                  </div>
                )}
                {m.sugerencias && m.sugerencias.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {m.sugerencias.map((p: any) => (
                      <Link
                        key={p.id}
                        to={`/producto/${p.id}`}
                        style={{
                          background: '#fff',
                          padding: '0.35rem 0.5rem',
                          borderRadius: 6,
                          fontSize: '0.78rem',
                          border: '1px solid #cbd5e1',
                          color: '#0f172a',
                        }}
                      >
                        👗 {p.nombre} — <strong>{formatBs(p.precio_base)}</strong>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={enviar} style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              className="fs-input"
              placeholder="Ej: Recomienda un vestido para gala..."
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
            />
            <button className="fs-btn fs-btn-accent" type="submit" disabled={cargando}>
              {cargando ? '...' : 'Enviar'}
            </button>
          </form>
        </div>
      ) : (
        <button
          className="fs-btn fs-btn-accent"
          style={{ borderRadius: 999, padding: '0.75rem 1.2rem', boxShadow: '0 8px 20px rgba(180,83,9,0.35)' }}
          onClick={() => setAbierto(true)}
        >
          ✨ Asistente IA
        </button>
      )}
    </div>
  );
};
