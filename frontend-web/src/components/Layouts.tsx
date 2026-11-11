import React, { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../context/App';
import { AsistenteFlotante } from './Asistente';
import { CampanaNotificaciones } from './Campana';
import ModalsOnboardingYManual from './Onboarding';

export const TopTrialBanner: React.FC = () => {
  const { suscripcion, tenantSlug, cambiarTenant, setAbrirModalOnboarding, setAbrirManual } = useApp();
  const [slugInput, setSlugInput] = useState(tenantSlug);
  const navigate = useNavigate();

  const irATenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slugInput.trim()) return;
    const clean = slugInput.trim().toLowerCase();
    cambiarTenant(clean);
    navigate(`/tienda/${clean}`);
  };

  return (
    <>
      <div className="fs-banner-trial">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <span className="fs-badge fs-badge-sandbox">
            {suscripcion && !['demo', 'trial'].includes(suscripcion.plan_actual) ? 'MODO SANDBOX' : 'TRIAL DE 14 DÍAS'}
          </span>
          <span>
            Tienda activa: <strong>{suscripcion?.tienda_nombre || tenantSlug}</strong> (
            <code>/tienda/{tenantSlug}</code>)
          </span>
          {suscripcion && (
            <span>
              · Plan: <strong>{suscripcion.plan_nombre}</strong> ·{' '}
              {suscripcion.solo_lectura ? (
                <strong style={{ color: '#fca5a5' }}>EXPIRADO (SOLO LECTURA)</strong>
              ) : suscripcion.dias_restantes !== null ? (
                <>Restan <strong>{suscripcion.dias_restantes} días</strong></>
              ) : (
                <>Sin vencimiento de Trial configurado</>
              )}{' '}
              · Usuarios {suscripcion.cuotas.usuarios.usado}/{suscripcion.cuotas.usuarios.maximo} ·
              Sucursales {suscripcion.cuotas.sucursales.usado}/{suscripcion.cuotas.sucursales.maximo} ·
              Productos {suscripcion.cuotas.productos.usado}/{suscripcion.cuotas.productos.maximo < 0 ? '∞' : suscripcion.cuotas.productos.maximo}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <form onSubmit={irATenant} style={{ display: 'flex', gap: '0.3rem' }}>
            <input
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder="Cambiar slug..."
              style={{
                padding: '0.22rem 0.5rem',
                borderRadius: 6,
                border: '1px solid #475569',
                background: '#0f172a',
                color: '#fff',
                fontSize: '0.78rem',
                width: 125,
              }}
            />
            <button type="submit" className="fs-btn fs-btn-sm" style={{ background: '#334155' }}>
              Ir
            </button>
          </form>
          <button
            className="fs-btn fs-btn-accent fs-btn-sm"
            onClick={() => setAbrirModalOnboarding(true)}
          >
            + Crear Tienda SaaS
          </button>
          <button
            className="fs-btn fs-btn-sm"
            style={{ background: '#475569' }}
            onClick={() => setAbrirManual(true)}
          >
            📖 Manual
          </button>
        </div>
      </div>

      {suscripcion?.solo_lectura && (
        <div className="fs-banner-readonly">
          ⚠️ El periodo Trial de 14 días de esta tienda ha vencido. Las operaciones de escritura están
          bloqueadas, pero todos tus datos están intactos y puedes consultarlos o exportarlos en PDF,
          Excel y CSV.
        </div>
      )}
    </>
  );
};

export const TiendaLayout: React.FC = () => {
  const {
    tenantSlug,
    usuario,
    cerrarSesion,
    carrito,
    colaOffline,
    online,
    sincronizarColaOffline,
    toast,
  } = useApp();

  const totalItemsCarrito = carrito.reduce((acc, item) => acc + item.cantidad, 0);
  const pendientesOffline = colaOffline.filter((x) => x.estado === 'pendiente').length;
  const esStaff = usuario && ['admin', 'encargado', 'cajero', 'proveedor'].includes(usuario.rol);

  return (
    <div>
      <TopTrialBanner />
      <header className="fs-header">
        <div className="fs-container fs-header-inner">
          <Link to={`/tienda/${tenantSlug}`} className="fs-brand">
            <span>👗 FashionStore</span>
            <span
              style={{
                fontSize: '0.75rem',
                background: 'rgba(255,255,255,0.14)',
                padding: '0.15rem 0.5rem',
                borderRadius: 6,
              }}
            >
              {tenantSlug}
            </span>
          </Link>

          <nav className="fs-nav">
            <NavLink to={`/tienda/${tenantSlug}`} end className="fs-nav-link">
              Inicio
            </NavLink>
            <NavLink to="/catalogo" className="fs-nav-link">
              Catálogo
            </NavLink>
            <NavLink to="/vestidor" className="fs-nav-link">
              🪞 Vestidor AR
            </NavLink>
            {usuario && (
              <>
                <NavLink to="/mis-reservas" className="fs-nav-link">
                  Mis Reservas
                </NavLink>
                <NavLink to="/mis-pedidos" className="fs-nav-link">
                  Mis Pedidos
                </NavLink>
              </>
            )}
            <NavLink to="/ayuda" className="fs-nav-link">
              Ayuda
            </NavLink>
            {esStaff && (
              <NavLink
                to="/panel"
                className="fs-nav-link"
                style={{ background: '#b45309', color: '#fff', fontWeight: 700 }}
              >
                ⚙️ Panel ({usuario.rol})
              </NavLink>
            )}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <button
              className="fs-btn fs-btn-sm"
              style={{ background: online ? 'rgba(255,255,255,0.14)' : '#b91c1c' }}
              onClick={() => void sincronizarColaOffline()}
              disabled={!online || pendientesOffline === 0}
              title={online ? 'Sincroniza la cola persistente de este dispositivo' : 'La conexión se detecta automáticamente'}
            >
              {online ? '🌐 Conectado' : '📡 Sin conexión'}
              {pendientesOffline > 0 && ` · ${pendientesOffline} pendiente(s)`}
            </button>

            <CampanaNotificaciones />

            <Link to="/carrito" className="fs-btn fs-btn-sm" style={{ background: '#334155' }}>
              🛒 Carrito ({totalItemsCarrito})
            </Link>

            {usuario ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Link to="/perfil" className="fs-nav-link" style={{ fontSize: '0.82rem' }}>
                  👤 {usuario.nombre}
                </Link>
                <button
                  className="fs-btn fs-btn-sm"
                  style={{ background: 'rgba(255,255,255,0.14)' }}
                  onClick={cerrarSesion}
                >
                  Salir
                </button>
              </div>
            ) : (
              <Link to="/auth" className="fs-btn fs-btn-accent fs-btn-sm">
                Ingresar
              </Link>
            )}
          </div>
        </div>
      </header>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.25rem',
            left: '1.25rem',
            background: '#0f172a',
            color: '#fff',
            padding: '0.75rem 1.1rem',
            borderRadius: 10,
            zIndex: 90,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            fontSize: '0.88rem',
          }}
        >
          {toast}
        </div>
      )}

      <main className="fs-container" style={{ padding: '1.5rem 1.25rem 4rem' }}>
        <Outlet />
      </main>

      <AsistenteFlotante />
      <ModalsOnboardingYManual />
    </div>
  );
};

export const PanelLayout: React.FC = () => {
  const { tenantSlug, usuario, colaOffline, sincronizarColaOffline, toast } = useApp();
  const pendientes = colaOffline.filter((x) => x.estado === 'pendiente').length;

  return (
    <div>
      <TopTrialBanner />
      <header className="fs-header">
        <div className="fs-container fs-header-inner">
          <div className="fs-brand">
            <span>⚙️ Panel Operativo FashionStore</span>
            <span className="fs-badge fs-badge-sandbox">{tenantSlug}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {pendientes > 0 && (
              <button className="fs-btn fs-btn-accent fs-btn-sm" onClick={sincronizarColaOffline}>
                🔄 Sincronizar Cola Offline ({pendientes})
              </button>
            )}
            <Link to={`/tienda/${tenantSlug}`} className="fs-btn fs-btn-sm" style={{ background: '#334155' }}>
              ← Volver a la Tienda
            </Link>
          </div>
        </div>
      </header>

      <div className="fs-panel-layout">
        <aside className="fs-sidebar">
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', padding: '0 0.85rem 0.4rem' }}>
            USUARIO: {usuario?.nombre || 'Invitado'} ({usuario?.rol || 'sin rol'})
          </div>
          <NavLink to="/panel" end className="fs-sidebar-link">
            📊 Dashboard KPI
          </NavLink>
          <NavLink to="/panel/pos" className="fs-sidebar-link">
            🖥️ Caja POS Offline-First
          </NavLink>
          <NavLink to="/panel/ventas" className="fs-sidebar-link">
            🧾 Ventas y Devoluciones
          </NavLink>
          <NavLink to="/panel/reservas" className="fs-sidebar-link">
            📅 Atención de Reservas
          </NavLink>
          <NavLink to="/panel/inventario" className="fs-sidebar-link">
            📦 Inventario Multi-Almacén
          </NavLink>
          <NavLink to="/panel/productos" className="fs-sidebar-link">
            👗 Productos y Variantes
          </NavLink>
          <NavLink to="/panel/maestros" className="fs-sidebar-link">
            🏷️ Sucursales y Promociones
          </NavLink>
          <NavLink to="/panel/propuestas" className="fs-sidebar-link">
            🤝 Portal Proveedores
          </NavLink>
          <NavLink to="/panel/reportes" className="fs-sidebar-link">
            🎙️ Reportes IA &amp; ML
          </NavLink>
          <NavLink to="/panel/suscripcion" className="fs-sidebar-link">
            💎 Suscripción &amp; Cuotas Trial
          </NavLink>
          <NavLink to="/panel/usuarios" className="fs-sidebar-link">
            👥 Usuarios y Roles
          </NavLink>
        </aside>

        <section style={{ padding: '1.5rem', overflowX: 'hidden' }}>
          <Outlet />
        </section>
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.25rem',
            left: '1.25rem',
            background: '#0f172a',
            color: '#fff',
            padding: '0.75rem 1.1rem',
            borderRadius: 10,
            zIndex: 90,
          }}
        >
          {toast}
        </div>
      )}

      <ModalsOnboardingYManual />
    </div>
  );
};
