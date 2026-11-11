import React, { useEffect, useState } from 'react';
import { PanelHeader } from '../../components/panel';
import { apiFetch } from '../../api/client';
import { useApp } from '../../context/App';
import { formatBs, formatFecha } from '../../lib/format';

export const MaestrosPage: React.FC = () => {
  const { tenantSlug, usuario, mostrarToast } = useApp();
  const [tab, setTab] = useState<'sucursales' | 'promociones' | 'categorias'>('sucursales');
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [promociones, setPromociones] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [formSuc, setFormSuc] = useState({ nombre: '', direccion: '', ciudad: 'Santa Cruz de la Sierra', telefono: '' });
  const [formPromo, setFormPromo] = useState({
    codigo: '',
    nombre: '',
    tipo_descuento: 'porcentaje',
    valor: '10',
    minimo_compra: '200',
  });
  const [formCat, setFormCat] = useState({ nombre: '', tipo_prenda: 'vestido' });

  const cargar = async () => {
    const [s, p, c] = await Promise.allSettled([
      apiFetch('/maestros/sucursales', { tenantSlug }),
      apiFetch('/maestros/promociones', { tenantSlug }),
      apiFetch('/maestros/categorias', { tenantSlug }),
    ]);
    if (s.status === 'fulfilled') setSucursales(s.value || []);
    if (p.status === 'fulfilled') setPromociones(p.value || []);
    if (c.status === 'fulfilled') setCategorias(c.value || []);
  };

  useEffect(() => {
    cargar();
  }, [tenantSlug]);

  const esAdmin = usuario?.rol === 'admin';

  const crearSucursal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/maestros/sucursales', { method: 'POST', tenantSlug, body: formSuc });
      mostrarToast('Sucursal creada.');
      setFormSuc({ nombre: '', direccion: '', ciudad: 'Santa Cruz de la Sierra', telefono: '' });
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear la sucursal (¿límite del plan alcanzado?).');
    }
  };

  const crearPromocion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/maestros/promociones', {
        method: 'POST',
        tenantSlug,
        body: {
          ...formPromo,
          valor: Number(formPromo.valor),
          minimo_compra: Number(formPromo.minimo_compra),
        },
      });
      mostrarToast('Promoción creada.');
      setFormPromo({ codigo: '', nombre: '', tipo_descuento: 'porcentaje', valor: '10', minimo_compra: '200' });
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear la promoción.');
    }
  };

  const crearCategoria = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/maestros/categorias', { method: 'POST', tenantSlug, body: formCat });
      mostrarToast('Categoría creada.');
      setFormCat({ nombre: '', tipo_prenda: 'vestido' });
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo crear la categoría.');
    }
  };

  return (
    <div className="fs-grid" style={{ gap: '1.25rem' }}>
      <PanelHeader
        titulo="🏷️ Maestros Comerciales"
        subtitulo="Sucursales, promociones y categorías del tenant (límites del plan SaaS aplicados por cuotas)."
      />

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {(['sucursales', 'promociones', 'categorias'] as const).map((t) => (
          <button
            key={t}
            className={`fs-btn fs-btn-sm ${tab === t ? '' : 'fs-btn-outline'}`}
            onClick={() => setTab(t)}
          >
            {t === 'sucursales' ? '🏬 Sucursales' : t === 'promociones' ? '🎟️ Promociones' : '🗂️ Categorías'}
          </button>
        ))}
      </div>

      {tab === 'sucursales' && (
        <>
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Ciudad</th>
                  <th>Dirección</th>
                  <th>Horario</th>
                </tr>
              </thead>
              <tbody>
                {sucursales.map((s) => (
                  <tr key={s.id}>
                    <td>{s.codigo}</td>
                    <td>{s.nombre}</td>
                    <td>{s.ciudad}</td>
                    <td>{s.direccion}</td>
                    <td>{s.horario}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <form onSubmit={crearSucursal} className="fs-card fs-grid" style={{ gap: '0.6rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.98rem' }}>+ Nueva Sucursal (admin)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem' }}>
                <input className="fs-input" required placeholder="Nombre" value={formSuc.nombre} onChange={(e) => setFormSuc({ ...formSuc, nombre: e.target.value })} />
                <input className="fs-input" required placeholder="Dirección" value={formSuc.direccion} onChange={(e) => setFormSuc({ ...formSuc, direccion: e.target.value })} />
                <input className="fs-input" placeholder="Ciudad" value={formSuc.ciudad} onChange={(e) => setFormSuc({ ...formSuc, ciudad: e.target.value })} />
                <input className="fs-input" placeholder="Teléfono" value={formSuc.telefono} onChange={(e) => setFormSuc({ ...formSuc, telefono: e.target.value })} />
              </div>
              <button type="submit" className="fs-btn fs-btn-accent">
                Crear Sucursal
              </button>
            </form>
          )}
        </>
      )}

      {tab === 'promociones' && (
        <>
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Valor</th>
                  <th>Mínimo compra</th>
                  <th>Activa</th>
                </tr>
              </thead>
              <tbody>
                {promociones.map((p) => (
                  <tr key={p.id}>
                    <td>{p.codigo}</td>
                    <td>{p.nombre}</td>
                    <td>{p.tipo_descuento}</td>
                    <td>{p.tipo_descuento === 'porcentaje' ? `${p.valor}%` : formatBs(p.valor)}</td>
                    <td>{formatBs(p.minimo_compra)}</td>
                    <td>{p.activa ? '✅' : '⏸️'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {usuario && ['admin', 'encargado'].includes(usuario.rol) && (
            <form onSubmit={crearPromocion} className="fs-card fs-grid" style={{ gap: '0.6rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.98rem' }}>+ Nueva Promoción</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
                <input className="fs-input" required placeholder="Código" value={formPromo.codigo} onChange={(e) => setFormPromo({ ...formPromo, codigo: e.target.value })} />
                <input className="fs-input" required placeholder="Nombre" value={formPromo.nombre} onChange={(e) => setFormPromo({ ...formPromo, nombre: e.target.value })} />
                <select className="fs-select" value={formPromo.tipo_descuento} onChange={(e) => setFormPromo({ ...formPromo, tipo_descuento: e.target.value })}>
                  <option value="porcentaje">% Porcentaje</option>
                  <option value="monto">Bs. Monto fijo</option>
                </select>
                <input type="number" className="fs-input" required placeholder="Valor" value={formPromo.valor} onChange={(e) => setFormPromo({ ...formPromo, valor: e.target.value })} />
                <input type="number" className="fs-input" placeholder="Mínimo compra" value={formPromo.minimo_compra} onChange={(e) => setFormPromo({ ...formPromo, minimo_compra: e.target.value })} />
              </div>
              <button type="submit" className="fs-btn fs-btn-accent">
                Crear Promoción
              </button>
            </form>
          )}
        </>
      )}

      {tab === 'categorias' && (
        <>
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Slug</th>
                  <th>Tipo prenda</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nombre}</td>
                    <td>{c.slug}</td>
                    <td>{c.tipo_prenda}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {esAdmin && (
            <form onSubmit={crearCategoria} className="fs-card fs-grid" style={{ gap: '0.6rem' }}>
              <h3 style={{ margin: 0, fontSize: '0.98rem' }}>+ Nueva Categoría (admin)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem' }}>
                <input className="fs-input" required placeholder="Nombre" value={formCat.nombre} onChange={(e) => setFormCat({ ...formCat, nombre: e.target.value })} />
                <select className="fs-select" value={formCat.tipo_prenda} onChange={(e) => setFormCat({ ...formCat, tipo_prenda: e.target.value })}>
                  {['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'].map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="fs-btn fs-btn-accent">
                Crear Categoría
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
};
export default MaestrosPage;
