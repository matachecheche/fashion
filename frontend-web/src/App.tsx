import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './context/App';
import { TiendaLayout, PanelLayout } from './components/Layouts';

import { InicioPage } from './pages/tienda/Inicio';
import { CatalogoPage } from './pages/tienda/Catalogo';
import { ProductoPage } from './pages/tienda/Producto';
import { VestidorPage } from './pages/tienda/Vestidor';
import { CarritoPage } from './pages/tienda/Carrito';
import { CheckoutPage } from './pages/tienda/Checkout';
import { PagoPage } from './pages/tienda/Pago';
import { AuthPage } from './pages/tienda/Auth';
import { AyudaPage } from './pages/tienda/Ayuda';
import { MisPedidosPage } from './pages/tienda/MisPedidos';
import { MisReservasPage } from './pages/tienda/MisReservas';
import { PerfilPage } from './pages/tienda/Perfil';

import { DashboardPage } from './pages/panel/Dashboard';
import { PosPage } from './pages/panel/POS';
import { VentasPage } from './pages/panel/Ventas';
import { ReservasPanelPage } from './pages/panel/Reservas';
import { InventarioPage } from './pages/panel/Inventario';
import { ProductosPage } from './pages/panel/Productos';
import { MaestrosPage } from './pages/panel/Maestros';
import { PropuestasPage } from './pages/panel/Propuestas';
import { ReportesPage } from './pages/panel/Reportes';
import { SuscripcionPage } from './pages/panel/Suscripcion';
import { UsuariosPage } from './pages/panel/Usuarios';

const RequiereStaff: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { usuario } = useApp();
  const autorizado = usuario && ['admin', 'encargado', 'cajero', 'proveedor'].includes(usuario.rol);
  if (!autorizado) {
    return <Navigate to="/auth" replace state={{ from: '/panel' }} />;
  }
  return children;
};

export const App: React.FC = () => {
  const { tenantSlug } = useApp();

  return (
    <Routes>
      {/* Tienda SaaS Multi-Tenant (/tienda/:slug) */}
      <Route path="/tienda/:slug" element={<TiendaLayout />}>
        <Route index element={<InicioPage />} />
        <Route path="catalogo" element={<CatalogoPage />} />
        <Route path="producto/:id" element={<ProductoPage />} />
        <Route path="vestidor" element={<VestidorPage />} />
        <Route path="carrito" element={<CarritoPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="pago/:id" element={<PagoPage />} />
        <Route path="auth" element={<AuthPage />} />
        <Route path="ayuda" element={<AyudaPage />} />
        <Route path="mis-pedidos" element={<MisPedidosPage />} />
        <Route path="mis-reservas" element={<MisReservasPage />} />
        <Route path="perfil" element={<PerfilPage />} />
      </Route>

      {/* Rutas absolutas de conveniencia que reusan la tienda activa */}
      <Route path="/" element={<TiendaLayout />}>
        <Route index element={<Navigate to={`/tienda/${tenantSlug}`} replace />} />
        <Route path="catalogo" element={<CatalogoPage />} />
        <Route path="producto/:id" element={<ProductoPage />} />
        <Route path="vestidor" element={<VestidorPage />} />
        <Route path="carrito" element={<CarritoPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="pago/:id" element={<PagoPage />} />
        <Route path="auth" element={<AuthPage />} />
        <Route path="ayuda" element={<AyudaPage />} />
        <Route path="mis-pedidos" element={<MisPedidosPage />} />
        <Route path="mis-reservas" element={<MisReservasPage />} />
        <Route path="perfil" element={<PerfilPage />} />
      </Route>

      {/* Panel operativo Staff (admin / encargado / cajero / proveedor) */}
      <Route
        path="/panel"
        element={
          <RequiereStaff>
            <PanelLayout />
          </RequiereStaff>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="ventas" element={<VentasPage />} />
        <Route path="reservas" element={<ReservasPanelPage />} />
        <Route path="inventario" element={<InventarioPage />} />
        <Route path="productos" element={<ProductosPage />} />
        <Route path="maestros" element={<MaestrosPage />} />
        <Route path="propuestas" element={<PropuestasPage />} />
        <Route path="reportes" element={<ReportesPage />} />
        <Route path="suscripcion" element={<SuscripcionPage />} />
        <Route path="usuarios" element={<UsuariosPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
export default App;
