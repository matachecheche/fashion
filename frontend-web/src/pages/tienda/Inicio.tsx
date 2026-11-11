import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, pullCatalogIncremental } from '../../api/client';
import { useApp } from '../../context/App';
import { buildAssetUrl, formatBs } from '../../lib/format';

export const InicioPage: React.FC = () => {
  const { slug } = useParams<{ slug?: string }>();
  const { tenantSlug, cambiarTenant, suscripcion, setAbrirModalOnboarding } = useApp();
  const [productos, setProductos] = useState<any[]>([]);
  const [recomendados, setRecomendados] = useState<any[]>([]);

  useEffect(() => {
    if (slug && slug.toLowerCase() !== tenantSlug) {
      cambiarTenant(slug.toLowerCase());
    }
  }, [slug]);

  useEffect(() => {
    const activeSlug = (slug || tenantSlug).toLowerCase();
    apiFetch('/catalogo/productos', { tenantSlug: activeSlug })
      .then((rows) => setProductos(Array.isArray(rows) ? rows.slice(0, 8) : []))
      .catch(async () => {
        const snap = await pullCatalogIncremental(activeSlug);
        if (snap?.snapshot?.productos) {
          setProductos(snap.snapshot.productos.slice(0, 8));
        }
      });

    apiFetch('/ia/recomendaciones?limite=4', { tenantSlug: activeSlug })
      .then((res) => setRecomendados(res?.recomendaciones || []))
      .catch(() => setRecomendados([]));
  }, [slug, tenantSlug]);

  return (
    <div className="fs-grid" style={{ gap: '2rem' }}>
      <div
        className="fs-card"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 65%, #78350f 100%)',
          color: '#ffffff',
          padding: '2.5rem 2rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
          alignItems: 'center',
        }}
      >
        <div>
          <span className="fs-badge fs-badge-sandbox" style={{ marginBottom: '0.75rem' }}>
            ✨ SaaS Multi-Tenant · Offline-First · Probador AR
          </span>
          <h1 style={{ fontSize: '2.1rem', margin: '0 0 0.75rem', lineHeight: 1.2 }}>
            {suscripcion?.tienda_nombre || `Boutique ${tenantSlug.toUpperCase()}`}
          </h1>
          <p style={{ color: '#cbd5e1', fontSize: '0.98rem', marginBottom: '1.25rem' }}>
            Explora colecciones exclusivas con disponibilidad por sucursal en tiempo real, prueba
            prendas en el Vestidor Virtual AR y reserva para atención personalizada en tienda.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to="/catalogo" className="fs-btn fs-btn-accent">
              Explorar Catálogo
            </Link>
            <Link
              to="/vestidor"
              className="fs-btn"
              style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)' }}
            >
              🪞 Abrir Vestidor AR
            </Link>
            <button
              className="fs-btn"
              style={{ background: '#334155' }}
              onClick={() => setAbrirModalOnboarding(true)}
            >
              🚀 Crear Mi Propia Tienda (Trial 14 Días)
            </button>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: '1.25rem',
            border: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Estado del Tenant Activo</h3>
          <div style={{ fontSize: '0.85rem', color: '#e2e8f0', display: 'grid', gap: 6 }}>
            <div>
              URL Canónica: <code>/tienda/{tenantSlug}</code>
            </div>
            <div>
              Plan Activo: <strong>{suscripcion?.plan_nombre || 'Trial Gratuito 14 Días'}</strong>
            </div>
            <div>
              Facturación: <strong>Modo Sandbox (Sin cobros reales)</strong>
            </div>
            <div>
              Aislamiento BD: <code>FORCE ROW LEVEL SECURITY</code>
            </div>
          </div>
        </div>
      </div>

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1.35rem' }}>Colección Destacada de la Tienda</h2>
          <Link to="/catalogo" style={{ color: '#b45309', fontWeight: 700, fontSize: '0.9rem' }}>
            Ver todo el catálogo →
          </Link>
        </div>

        {productos.length === 0 ? (
          <div className="fs-card" style={{ textAlign: 'center', padding: '2rem' }}>
            Esta tienda aún no tiene prendas cargadas. Si eres el administrador, ingresa al{' '}
            <Link to="/panel/productos" style={{ color: '#b45309', fontWeight: 700 }}>
              Panel de Productos
            </Link>{' '}
            para agregar tu primera colección.
          </div>
        ) : (
          <div className="fs-grid fs-grid-catalog">
            {productos.map((p) => (
              <div key={p.id} className="fs-card" style={{ display: 'flex', flexDirection: 'column' }}>
                <img
                  src={buildAssetUrl(p.imagen_url)}
                  alt={p.nombre}
                  style={{
                    width: '100%',
                    height: 240,
                    objectFit: 'cover',
                    borderRadius: 8,
                    marginBottom: '0.75rem',
                    background: '#f1f5f9',
                  }}
                />
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  {p.categoria_nombre || p.tipo_prenda} · Stock: {p.stock_disponible ?? 10} u.
                </div>
                <h3 style={{ margin: '0.25rem 0', fontSize: '1.02rem' }}>{p.nombre}</h3>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#b45309', marginBottom: '0.75rem' }}>
                  {formatBs(p.precio_base)}
                </div>
                <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem' }}>
                  <Link to={`/producto/${p.id}`} className="fs-btn" style={{ flex: 1 }}>
                    Ver Detalle
                  </Link>
                  <Link
                    to={`/vestidor?tipo=${p.tipo_prenda}&producto=${p.id}`}
                    className="fs-btn fs-btn-outline"
                    title="Probar en Vestidor AR"
                  >
                    🪞 AR
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {recomendados.length > 0 && (
        <section>
          <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem' }}>
            ✨ Recomendaciones del Motor Híbrido IA para Ti
          </h2>
          <div className="fs-grid fs-grid-catalog">
            {recomendados.map((r) => (
              <div key={r.id} className="fs-card">
                <span className="fs-badge fs-badge-ok" style={{ marginBottom: 6 }}>
                  Afinidad {r.score_afinidad || 92}%
                </span>
                <h4 style={{ margin: '0.25rem 0' }}>{r.nombre}</h4>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.25rem 0 0.6rem' }}>
                  {r.motivo_recomendacion || 'Prenda complementaria con stock inmediato'}
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{formatBs(r.precio_base)}</strong>
                  <Link to={`/producto/${r.id}`} className="fs-btn fs-btn-outline fs-btn-sm">
                    Descubrir
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
export default InicioPage;
