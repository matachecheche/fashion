import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../../api/client';
import { ModalReservarPrenda } from '../../components/Reservar';
import { useApp } from '../../context/App';
import { buildAssetUrl, formatBs } from '../../lib/format';

export const ProductoPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { tenantSlug, agregarAlCarrito } = useApp();
  const [producto, setProducto] = useState<any | null>(null);
  const [varianteSel, setVarianteSel] = useState<any | null>(null);
  const [recomendados, setRecomendados] = useState<any[]>([]);
  const [modalReserva, setModalReserva] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/catalogo/productos/${id}`, { tenantSlug })
      .then((res) => {
        setProducto(res);
        if (res?.variantes?.length > 0) {
          setVarianteSel(res.variantes[0]);
        }
      })
      .catch(() => setProducto(null));

    apiFetch(`/ia/recomendaciones?producto_id=${id}&limite=4`, { tenantSlug })
      .then((res) => setRecomendados(res?.recomendaciones || []))
      .catch(() => setRecomendados([]));
  }, [id, tenantSlug]);

  if (!producto) {
    return <div className="fs-card">Cargando detalle de la prenda...</div>;
  }

  const precioFinal =
    Number(producto.precio_base) + Number(varianteSel?.precio_adicional || 0);
  const imagenActiva = varianteSel?.foto_url || producto.imagen_url;

  return (
    <div className="fs-grid" style={{ gap: '2rem' }}>
      <div
        className="fs-card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
          gap: '2rem',
        }}
      >
        <div>
          <img
            src={buildAssetUrl(imagenActiva)}
            alt={producto.nombre}
            style={{
              width: '100%',
              maxHeight: 480,
              objectFit: 'contain',
              borderRadius: 12,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
            }}
          />
        </div>

        <div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            {producto.categoria_nombre} · Código {producto.codigo} · Material: {producto.material}
          </div>
          <h1 style={{ margin: '0.35rem 0', fontSize: '1.75rem' }}>{producto.nombre}</h1>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#b45309', marginBottom: '0.75rem' }}>
            {formatBs(precioFinal)}
          </div>
          <p style={{ color: '#334155', marginBottom: '1.25rem' }}>{producto.descripcion}</p>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ fontWeight: 700, fontSize: '0.88rem', display: 'block', marginBottom: 6 }}>
              Seleccionar Variante (Talla / Color / SKU):
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {(producto.variantes || []).map((v: any) => {
                const activa = varianteSel?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`fs-btn ${activa ? '' : 'fs-btn-outline'} fs-btn-sm`}
                    onClick={() => setVarianteSel(v)}
                  >
                    Talla {v.talla} · {v.color.toUpperCase()} ({v.disponible_total ?? 5} disp.)
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <button
              className="fs-btn fs-btn-accent"
              onClick={() => {
                if (!varianteSel) return;
                agregarAlCarrito({
                  variante_id: varianteSel.id,
                  producto_id: producto.id,
                  sku: varianteSel.sku,
                  nombre: producto.nombre,
                  talla: varianteSel.talla,
                  color: varianteSel.color,
                  precio_unitario: precioFinal,
                  cantidad: 1,
                  imagen_url: imagenActiva,
                });
              }}
            >
              🛒 Agregar al Carrito
            </button>

            <button
              className="fs-btn"
              onClick={() => setModalReserva(true)}
            >
              📅 Reservar en Sucursal
            </button>

            <Link
              to={`/vestidor?tipo=${producto.tipo_prenda}&color=${varianteSel?.color || 'rojo'}&producto=${producto.id}`}
              className="fs-btn fs-btn-outline"
            >
              🪞 Probar en Vestidor AR
            </Link>
          </div>

          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.92rem' }}>
            Disponibilidad en Tiempo Real por Sucursal
          </h4>
          <div className="fs-table-wrap">
            <table className="fs-table">
              <thead>
                <tr>
                  <th>Sucursal</th>
                  <th>SKU</th>
                  <th>Talla / Color</th>
                  <th>Disponible</th>
                </tr>
              </thead>
              <tbody>
                {(producto.disponibilidad_sucursales || []).map((d: any, idx: number) => (
                  <tr key={idx}>
                    <td>{d.sucursal_nombre}</td>
                    <td>{d.sku}</td>
                    <td>
                      {d.talla} / {d.color}
                    </td>
                    <td>
                      <strong>{d.disponible} u.</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {recomendados.length > 0 && (
        <section>
          <h3 style={{ margin: '0 0 0.85rem' }}>✨ Combina este look con estas prendas</h3>
          <div className="fs-grid fs-grid-catalog">
            {recomendados.map((r) => (
              <div key={r.id} className="fs-card">
                <img
                  src={buildAssetUrl(r.imagen_url)}
                  alt={r.nombre}
                  style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 8 }}
                />
                <h4 style={{ margin: '0.5rem 0 0.2rem' }}>{r.nombre}</h4>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 6 }}>
                  {r.motivo_recomendacion}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{formatBs(r.precio_base)}</strong>
                  <Link to={`/producto/${r.id}`} className="fs-btn fs-btn-outline fs-btn-sm">
                    Ver Prenda
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ModalReservarPrenda
        abierto={modalReserva}
        onCerrar={() => setModalReserva(false)}
        producto={producto}
        variante={varianteSel}
      />
    </div>
  );
};
export default ProductoPage;
