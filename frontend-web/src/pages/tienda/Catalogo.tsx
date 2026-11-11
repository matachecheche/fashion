import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, pullCatalogIncremental } from '../../api/client';
import { useApp } from '../../context/App';
import { buildAssetUrl, formatBs } from '../../lib/format';

export const CatalogoPage: React.FC = () => {
  const { tenantSlug } = useApp();
  const [productos, setProductos] = useState<any[]>([]);
  const [filtrosDisponibles, setFiltrosDisponibles] = useState<any>({
    categorias: [],
    sucursales: [],
    tallas: [],
    colores: [],
  });
  const [q, setQ] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [tipoPrenda, setTipoPrenda] = useState('');
  const [talla, setTalla] = useState('');
  const [color, setColor] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [modoCacheOffline, setModoCacheOffline] = useState(false);

  useEffect(() => {
    apiFetch('/catalogo/filtros', { tenantSlug })
      .then((res) => setFiltrosDisponibles(res))
      .catch(() => undefined);
  }, [tenantSlug]);

  const buscar = async () => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set('q', q.trim());
    if (categoriaId) qs.set('categoria_id', categoriaId);
    if (tipoPrenda) qs.set('tipo_prenda', tipoPrenda);
    if (talla) qs.set('talla', talla);
    if (color) qs.set('color', color);
    if (sucursalId) qs.set('sucursal_id', sucursalId);

    try {
      const rows = await apiFetch(`/catalogo/productos?${qs.toString()}`, { tenantSlug });
      setProductos(Array.isArray(rows) ? rows : []);
      setModoCacheOffline(false);
    } catch {
      const snap = await pullCatalogIncremental(tenantSlug);
      setProductos(snap?.snapshot?.productos || []);
      setModoCacheOffline(true);
    }
  };

  useEffect(() => {
    buscar();
  }, [tenantSlug, categoriaId, tipoPrenda, talla, color, sucursalId]);

  return (
    <div className="fs-grid" style={{ gap: '1.5rem' }}>
      <div className="fs-card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '1.45rem' }}>Catálogo Inteligente Multi-Sucursal</h1>
            <div style={{ fontSize: '0.84rem', color: '#64748b' }}>
              Filtra por prenda, talla, color y disponibilidad en tiempo real por sucursal.
            </div>
          </div>
          {modoCacheOffline && (
            <span className="fs-badge fs-badge-warn">
              📡 Mostrando snapshot offline de IndexedDB
            </span>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <input
            className="fs-input"
            placeholder="Buscar prenda o tela..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && buscar()}
          />
          <select
            className="fs-select"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Todas las categorías</option>
            {(filtrosDisponibles.categorias || []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <select
            className="fs-select"
            value={tipoPrenda}
            onChange={(e) => setTipoPrenda(e.target.value)}
          >
            <option value="">Todos los tipos AR</option>
            {['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'].map(
              (t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ),
            )}
          </select>
          <select className="fs-select" value={talla} onChange={(e) => setTalla(e.target.value)}>
            <option value="">Todas las tallas</option>
            {(filtrosDisponibles.tallas || ['S', 'M', 'L', 'XL', 'U', '37', '38']).map((t: string) => (
              <option key={t} value={t}>
                Talla {t}
              </option>
            ))}
          </select>
          <select className="fs-select" value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">Todos los colores</option>
            {(filtrosDisponibles.colores || []).map((c: any) => (
              <option key={c.color} value={c.color}>
                {c.color.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            className="fs-select"
            value={sucursalId}
            onChange={(e) => setSucursalId(e.target.value)}
          >
            <option value="">Todas las sucursales</option>
            {(filtrosDisponibles.sucursales || []).map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="fs-grid fs-grid-catalog">
        {productos.map((p) => (
          <div key={p.id} className="fs-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <img
              src={buildAssetUrl(p.imagen_url)}
              alt={p.nombre}
              style={{
                width: '100%',
                height: 250,
                objectFit: 'cover',
                borderRadius: 8,
                marginBottom: '0.75rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                {p.codigo} · {p.tipo_prenda?.toUpperCase()}
              </span>
              <span className="fs-badge fs-badge-ok">{p.stock_disponible ?? 10} disp.</span>
            </div>
            <h3 style={{ margin: '0.35rem 0', fontSize: '1.05rem' }}>{p.nombre}</h3>
            <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 0.75rem' }}>
              {p.descripcion || p.material}
            </p>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#b45309', marginBottom: '0.75rem' }}>
              {formatBs(p.precio_base)}
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem' }}>
              <Link to={`/producto/${p.id}`} className="fs-btn" style={{ flex: 1 }}>
                Elegir Talla / Color
              </Link>
              <Link
                to={`/vestidor?tipo=${p.tipo_prenda}&producto=${p.id}`}
                className="fs-btn fs-btn-outline"
              >
                🪞 AR
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default CatalogoPage;
