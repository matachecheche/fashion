import React, { useEffect, useState } from 'react';
import { EmptyState, PanelHeader } from '../../components/panel';
import { BadgeEstado } from '../../components/ui';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatBs, formatFecha } from '../../lib/format';

export const PropuestasPage: React.FC = () => {
  const { tenantSlug, usuario, mostrarToast } = useApp();
  const [propuestas, setPropuestas] = useState<any[]>([]);
  const [form, setForm] = useState({
    producto_nombre: '',
    tipo_prenda: 'vestido',
    tallas_sugeridas: 'S,M,L',
    costo_propuesto: '80',
    precio_sugerido: '220',
    cantidad_disponible: '24',
    descripcion: '',
  });

  const cargar = async () => {
    try {
      const rows = await apiFetch('/propuestas', { tenantSlug });
      setPropuestas(Array.isArray(rows) ? rows : []);
    } catch {
      setPropuestas([]);
    }
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const enviarPropuesta = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/propuestas', {
        method: 'POST',
        tenantSlug,
        body: {
          ...form,
          tallas_sugeridas: form.tallas_sugeridas.split(',').map((t) => t.trim()).filter(Boolean),
          costo_propuesto: Number(form.costo_propuesto),
          precio_sugerido: Number(form.precio_sugerido),
          cantidad_disponible: Number(form.cantidad_disponible),
        },
      });
      mostrarToast('Propuesta enviada al comité de compras de la boutique.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo enviar la propuesta.');
    }
  };

  const decidir = async (id: number, accion: 'aprobar' | 'rechazar') => {
    try {
      await apiFetch(`/propuestas/${id}/${accion}`, { method: 'POST', tenantSlug });
      mostrarToast(accion === 'aprobar' ? 'Propuesta aprobada.' : 'Propuesta rechazada.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo registrar la decisión.');
    }
  };

  const esComprador = usuario && ['admin', 'encargado'].includes(usuario.rol);

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="🤝 Portal de Proveedores y Propuestas"
        subtitulo="Proveedores proponen colecciones; el comité de compras (admin/encargado) aprueba o rechaza."
      />

      {usuario?.rol === 'proveedor' && (
        <form onSubmit={enviarPropuesta} className="fs-card fs-grid" style={{ gap: '0.65rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>+ Nueva Propuesta Comercial</h3>
          <input className="fs-input" required placeholder="Nombre del producto propuesto" value={form.producto_nombre} onChange={(e) => setForm({ ...form, producto_nombre: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
            <select className="fs-select" value={form.tipo_prenda} onChange={(e) => setForm({ ...form, tipo_prenda: e.target.value })}>
              {['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'].map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
            <input className="fs-input" placeholder="Tallas (S,M,L)" value={form.tallas_sugeridas} onChange={(e) => setForm({ ...form, tallas_sugeridas: e.target.value })} />
            <input type="number" className="fs-input" placeholder="Costo (BOB)" value={form.costo_propuesto} onChange={(e) => setForm({ ...form, costo_propuesto: e.target.value })} />
            <input type="number" className="fs-input" placeholder="Precio sugerido" value={form.precio_sugerido} onChange={(e) => setForm({ ...form, precio_sugerido: e.target.value })} />
            <input type="number" className="fs-input" placeholder="Cantidad disponible" value={form.cantidad_disponible} onChange={(e) => setForm({ ...form, cantidad_disponible: e.target.value })} />
          </div>
          <textarea className="fs-input" placeholder="Descripción / condiciones comerciales" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
          <button type="submit" className="fs-btn fs-btn-accent">
            Enviar Propuesta
          </button>
        </form>
      )}

      {propuestas.length === 0 ? (
        <EmptyState mensaje="No hay propuestas registradas." />
      ) : (
        <div className="fs-grid">
          {propuestas.map((p) => (
            <div key={p.id} className="fs-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>{p.producto_nombre}</strong> · {String(p.tipo_prenda || '').toUpperCase()}
                  <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                    Tallas: {Array.isArray(p.tallas_sugeridas) ? p.tallas_sugeridas.join(', ') : p.tallas_sugeridas} ·{' '}
                    Costo {formatBs(p.costo_propuesto)} · Sugerido {formatBs(p.precio_sugerido)} · Qty {p.cantidad_disponible}
                  </div>
                  <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                    Proveedor: {p.proveedor_nombre || p.usuario_nombre || 'Externo'} · {formatFecha(p.creado_en)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <BadgeEstado estado={p.estado} />
                  {esComprador && p.estado === 'pendiente' && (
                    <>
                      <button className="fs-btn fs-btn-sm" style={{ background: '#15803d' }} onClick={() => decidir(p.id, 'aprobar')}>
                        Aprobar
                      </button>
                      <button className="fs-btn fs-btn-danger fs-btn-sm" onClick={() => decidir(p.id, 'rechazar')}>
                        Rechazar
                      </button>
                    </>
                  )}
                </div>
              </div>
              {p.descripcion && <p style={{ marginBottom: 0, fontSize: '0.86rem', color: '#334155' }}>{p.descripcion}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
export default PropuestasPage;
