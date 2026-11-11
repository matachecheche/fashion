/**
 * FashionStore Mobile — React Native + Expo + SQLite (offline-first)
 * Navegación interna: 5 tabs + stack propio para pantallas de detalle.
 */
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppProvider, useApp } from './src/context';
import { NavProvider, TabName, useNav } from './src/navigation';
import AsistenteScreen from './src/screens/Asistente';
import AuthScreen from './src/screens/Auth';
import AyudaScreen from './src/screens/Ayuda';
import CarritoScreen from './src/screens/Carrito';
import CatalogoScreen from './src/screens/Catalogo';
import CheckoutScreen from './src/screens/Checkout';
import CuentaScreen from './src/screens/Cuenta';
import InicioScreen from './src/screens/Inicio';
import OnboardingScreen from './src/screens/Onboarding';
import PagoScreen from './src/screens/Pago';
import PanelScreen from './src/screens/Panel';
import PedidosScreen from './src/screens/Pedidos';
import ProbadorARScreen from './src/screens/ProbadorAR';
import ProductoScreen from './src/screens/Producto';
import ReservaScreen from './src/screens/Reservar';
import ReservasScreen from './src/screens/Reservas';
import { Colores } from './src/ui';

const TABS: Array<{ id: TabName; etiqueta: string; icono: string }> = [
  { id: 'inicio', etiqueta: 'Inicio', icono: '🏠' },
  { id: 'catalogo', etiqueta: 'Catálogo', icono: '👗' },
  { id: 'vestidor', etiqueta: 'AR', icono: '🪞' },
  { id: 'carrito', etiqueta: 'Carrito', icono: '🛒' },
  { id: 'cuenta', etiqueta: 'Cuenta', icono: '👤' },
];

function ToastOverlay() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={estilos.toast}>
      <Text style={estilos.toastTexto}>{toast}</Text>
    </View>
  );
}

function Root() {
  const { cargandoSesion, onboardingVisto, pendientes, online, factoryResetVersion } = useApp();
  const nav = useNav();

  useEffect(() => {
    if (factoryResetVersion > 0) {
      nav.setTab('inicio');
      nav.popToRoot();
    }
  }, [factoryResetVersion, nav.popToRoot, nav.setTab]);

  useEffect(() => {
    if (!cargandoSesion && !onboardingVisto) {
      nav.push('Onboarding');
    }
    // Solo al terminar la carga inicial
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoSesion]);

  if (cargandoSesion) {
    return (
      <SafeAreaView style={[estilos.pantalla, estilos.centro]}>
        <ActivityIndicator size="large" color={Colores.acento} />
        <Text style={{ color: Colores.suave, marginTop: 12 }}>Preparando FashionStore…</Text>
      </SafeAreaView>
    );
  }

  const renderTab = () => {
    switch (nav.tab) {
      case 'inicio':
        return <InicioScreen />;
      case 'catalogo':
        return <CatalogoScreen />;
      case 'vestidor':
        return <ProbadorARScreen />;
      case 'carrito':
        return <CarritoScreen />;
      case 'cuenta':
        return <CuentaScreen />;
      default:
        return <InicioScreen />;
    }
  };

  const renderStack = () => {
    const top = nav.stack[nav.stack.length - 1];
    if (!top) return null;
    const params = { navParams: top.params };
    switch (top.name) {
      case 'Producto':
        return <ProductoScreen {...params} />;
      case 'ProbadorAR':
        return <ProbadorARScreen {...params} />;
      case 'Reservar':
        return <ReservaScreen {...params} />;
      case 'Checkout':
        return <CheckoutScreen />;
      case 'Pago':
        return <PagoScreen {...params} />;
      case 'Pedidos':
        return <PedidosScreen />;
      case 'Reservas':
        return <ReservasScreen />;
      case 'Auth':
        return <AuthScreen {...params} />;
      case 'Asistente':
        return <AsistenteScreen />;
      case 'Ayuda':
        return <AyudaScreen />;
      case 'Onboarding':
        return <OnboardingScreen />;
      case 'Panel':
        return <PanelScreen />;
      default:
        return null;
    }
  };

  const stackAbierto = nav.stack.length > 0;

  return (
    <SafeAreaView style={estilos.pantalla}>
      <StatusBar style="light" />
      {/* Barra superior con tenant y estado de cola offline */}
      <View style={estilos.header}>
        <Text style={estilos.headerBrand}>👗 FashionStore</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[estilos.estadoConexion, { backgroundColor: online ? '#166534' : '#991b1b' }]}>
            <Text style={estilos.offlinePillText}>{online ? 'ONLINE' : 'OFFLINE'}</Text>
          </View>
          {pendientes > 0 && (
            <View style={estilos.offlinePill}>
              <Text style={estilos.offlinePillText}>📡 {pendientes}</Text>
            </View>
          )}
          {stackAbierto && (
            <TouchableOpacity onPress={nav.pop} accessibilityRole="button" accessibilityLabel="Volver">
              <Text style={estilos.headerVolver}>‹ Volver</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {stackAbierto ? renderStack() : renderTab()}
      </View>

      {/* Barra de pestañas inferior (visible solo sin stack abierto) */}
      {!stackAbierto && (
        <View style={estilos.tabBar}>
          {TABS.map((tab) => {
            const activo = nav.tab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={estilos.tabItem}
                onPress={() => nav.setTab(tab.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: activo }}
              >
                <Text style={{ fontSize: 19 }}>{tab.icono}</Text>
                <Text style={[estilos.tabEtiqueta, activo && { color: '#fbbf24' }]}>
                  {tab.etiqueta}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <ToastOverlay />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppProvider>
      <NavProvider>
        <Root />
      </NavProvider>
    </AppProvider>
  );
}

const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: Colores.fondo },
  centro: { alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBrand: { color: '#fff', fontWeight: '900', fontSize: 16 },
  headerVolver: { color: '#fbbf24', fontWeight: '800', fontSize: 15 },
  estadoConexion: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  offlinePill: {
    backgroundColor: '#b45309',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  offlinePillText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    paddingBottom: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 2 },
  tabEtiqueta: { color: '#94a3b8', fontSize: 10, fontWeight: '700', marginTop: 2 },
  toast: {
    position: 'absolute',
    bottom: 84,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15,23,42,0.94)',
    borderRadius: 12,
    padding: 12,
  },
  toastTexto: { color: '#fff', fontSize: 13, textAlign: 'center' },
});
