/** FashionStore Mobile — navegación adaptativa, segura para Android edge-to-edge. */
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import MaestrosScreen from './src/screens/Maestros';
import NotificacionesScreen from './src/screens/Notificaciones';
import OnboardingScreen from './src/screens/Onboarding';
import PagoScreen from './src/screens/Pago';
import PanelScreen from './src/screens/Panel';
import PedidosScreen from './src/screens/Pedidos';
import ProbadorARScreen from './src/screens/ProbadorAR';
import ProductoScreen from './src/screens/Producto';
import ReservaScreen from './src/screens/Reservar';
import ReservasScreen from './src/screens/Reservas';
import { Colores } from './src/ui';

const TITULOS: Record<string, string> = {
  Producto: 'Detalle del producto', ProbadorAR: 'Vestidor virtual', Reservar: 'Reservar una visita',
  Checkout: 'Finalizar compra', Pago: 'Pago', Pedidos: 'Mis pedidos', Reservas: 'Mis reservas',
  Auth: 'Tu cuenta', Asistente: 'Asistente de estilo', Ayuda: 'Centro de ayuda',
  Onboarding: 'Bienvenida', Panel: 'Panel de gestión', Maestros: 'Sucursales y promociones',
  Notificaciones: 'Notificaciones',
};

const TABS: Array<{ id: TabName; etiqueta: string; icono: string }> = [
  { id: 'inicio', etiqueta: 'Inicio', icono: '⌂' },
  { id: 'catalogo', etiqueta: 'Catálogo', icono: '◈' },
  { id: 'vestidor', etiqueta: 'Vestidor', icono: '✧' },
  { id: 'carrito', etiqueta: 'Carrito', icono: '▱' },
  { id: 'cuenta', etiqueta: 'Cuenta', icono: '◉' },
];

function ToastOverlay({ bottom }: { bottom: number }) {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={[estilos.toast, { bottom }]}>
      <Text style={estilos.toastTexto}>{toast}</Text>
    </View>
  );
}

function Root() {
  const {
    cargandoSesion,
    onboardingVisto,
    pendientes,
    online,
    factoryResetVersion,
    usuario,
    carrito,
    tenantSlug,
    sincronizar,
  } = useApp();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compacto = width < 370;
  const [tecladoVisible, setTecladoVisible] = useState(false);
  const totalCarrito = carrito.reduce((sum, item) => sum + Number(item.cantidad || 0), 0);

  useEffect(() => {
    if (factoryResetVersion > 0) {
      nav.setTab('inicio');
      nav.popToRoot();
    }
  }, [factoryResetVersion, nav.popToRoot, nav.setTab]);

  useEffect(() => {
    if (!cargandoSesion && !onboardingVisto) nav.push('Onboarding');
    // Solo al terminar la carga inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoSesion]);

  // La barra inferior desaparece mientras el teclado está abierto para dejar
  // espacio real a los formularios y evitar que tape botones o campos.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setTecladoVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setTecladoVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Botón Atrás de Android: cierra primero la pantalla secundaria, luego vuelve
  // a Inicio. Solo permite salir cuando ya estamos en la raíz de Inicio.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav.stack.length > 0) { nav.pop(); return true; }
      if (nav.tab !== 'inicio') { nav.setTab('inicio'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [nav.stack.length, nav.tab, nav.pop, nav.setTab]);

  if (cargandoSesion) {
    return (
      <SafeAreaView style={[estilos.safe, estilos.centro]} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={Colores.acento} />
        <Text style={{ color: Colores.suave, marginTop: 12 }}>Preparando FashionStore…</Text>
      </SafeAreaView>
    );
  }

  const renderTab = () => {
    switch (nav.tab) {
      case 'inicio': return <InicioScreen />;
      case 'catalogo': return <CatalogoScreen />;
      case 'vestidor': return <ProbadorARScreen />;
      case 'carrito': return <CarritoScreen />;
      case 'cuenta': return <CuentaScreen />;
      default: return <InicioScreen />;
    }
  };

  const renderStack = () => {
    const top = nav.stack[nav.stack.length - 1];
    if (!top) return null;
    const params = { navParams: top.params };
    switch (top.name) {
      case 'Producto': return <ProductoScreen {...params} />;
      case 'ProbadorAR': return <ProbadorARScreen {...params} />;
      case 'Reservar': return <ReservaScreen {...params} />;
      case 'Checkout': return <CheckoutScreen />;
      case 'Pago': return <PagoScreen {...params} />;
      case 'Pedidos': return <PedidosScreen />;
      case 'Reservas': return <ReservasScreen />;
      case 'Auth': return <AuthScreen {...params} />;
      case 'Asistente': return <AsistenteScreen />;
      case 'Ayuda': return <AyudaScreen />;
      case 'Onboarding': return <OnboardingScreen />;
      case 'Panel': return <PanelScreen />;
      case 'Maestros': return <MaestrosScreen />;
      case 'Notificaciones': return <NotificacionesScreen />;
      default: return null;
    }
  };

  const stackAbierto = nav.stack.length > 0;
  const nombreStack = nav.stack[nav.stack.length - 1]?.name;
  const tituloStack = nombreStack ? TITULOS[nombreStack] : undefined;
  const mostrarTabs = !stackAbierto && !tecladoVisible;
  const separacionToast = mostrarTabs ? 66 + Math.max(insets.bottom, 4) : 14 + (tecladoVisible ? 0 : Math.max(insets.bottom, 0));

  return (
    <SafeAreaView style={estilos.safe} edges={['top']}>
      <StatusBar style="light" backgroundColor={Colores.oscuro} />
      <View style={estilos.header}>
        <View style={estilos.headerIdentidad}>
          {stackAbierto ? (
            <TouchableOpacity
              onPress={nav.pop}
              accessibilityRole="button"
              accessibilityLabel="Volver a la pantalla anterior"
              hitSlop={8}
              style={estilos.backButton}
            >
              <Text style={estilos.backText}>‹</Text>
            </TouchableOpacity>
          ) : null}
          <View style={{ flexShrink: 1 }}>
            <Text style={estilos.headerBrand}>{stackAbierto ? tituloStack : 'FashionStore'}</Text>
            {!stackAbierto ? <Text style={estilos.headerTenant}>Tienda {tenantSlug}</Text> : null}
          </View>
        </View>
        <View style={estilos.headerAcciones}>
          <View style={[estilos.estadoConexion, { backgroundColor: online ? '#245D4A' : '#8C3E3E' }]}>
            <View style={[estilos.dot, { backgroundColor: online ? '#86D6AE' : '#F6A2A2' }]} />
            {!compacto && <Text style={estilos.pillText}>{online ? 'EN LÍNEA' : 'SIN RED'}</Text>}
          </View>
          {pendientes > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${pendientes} operaciones pendientes. Toca para sincronizar`}
              disabled={!online}
              onPress={() => { void sincronizar(); }}
              activeOpacity={0.8}
              style={[estilos.pendingPill, !online && { opacity: 0.6 }]}
            >
              <Text style={estilos.pillText}>↻ {pendientes}</Text>
            </TouchableOpacity>
          )}
          {usuario ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Ver notificaciones"
              onPress={() => nav.push('Notificaciones')}
              activeOpacity={0.8}
              hitSlop={4}
              style={estilos.headerIconButton}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 17 }}>🔔</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <KeyboardAvoidingView
        style={[estilos.contenido, stackAbierto && !tecladoVisible ? { paddingBottom: insets.bottom } : null]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {stackAbierto ? renderStack() : renderTab()}
      </KeyboardAvoidingView>

      {mostrarTabs && (
        <View style={[estilos.tabBar, { paddingBottom: Math.max(insets.bottom, 4) }]}>
          {TABS.map((tab) => {
            const activo = nav.tab === tab.id;
            const label = tab.id === 'carrito' && totalCarrito > 0 ? `Carrito · ${totalCarrito}` : tab.etiqueta;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[estilos.tabItem, compacto && { paddingHorizontal: 1 }]}
                onPress={() => nav.setTab(tab.id)}
                activeOpacity={0.78}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: activo }}
              >
                <View style={[estilos.tabIconWrap, activo && estilos.tabIconActivo]}>
                  <Text style={[estilos.tabIcon, activo && estilos.tabIconSelected]}>{tab.icono}</Text>
                  {tab.id === 'carrito' && totalCarrito > 0 ? (
                    <View style={estilos.cartCount}><Text style={estilos.cartCountText}>{totalCarrito > 99 ? '99+' : totalCarrito}</Text></View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={[estilos.tabEtiqueta, activo && estilos.tabEtiquetaActiva]}>{tab.etiqueta}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <ToastOverlay bottom={separacionToast} />
    </SafeAreaView>
  );
}


export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <NavProvider>
          <Root />
        </NavProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const estilos = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colores.oscuro },
  centro: { alignItems: 'center', justifyContent: 'center' },
  header: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colores.oscuro,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerIdentidad: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headerBrand: { color: '#FFFFFF', fontWeight: '900', fontSize: 14, letterSpacing: 1.15 },
  headerTenant: { color: '#AEB9B8', fontWeight: '700', fontSize: 9, letterSpacing: 1, marginTop: 3 },
  headerAcciones: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#FFFFFF', fontSize: 28, lineHeight: 30, marginTop: -3 },
  estadoConexion: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 30, paddingHorizontal: 9, paddingVertical: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pendingPill: { backgroundColor: '#87572F', borderRadius: 30, paddingHorizontal: 9, paddingVertical: 6 },
  pillText: { color: '#FFFFFF', fontWeight: '800', fontSize: 9, letterSpacing: 0.3 },
  headerIconButton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  cartCount: { position: 'absolute', top: -3, right: -4, minWidth: 19, height: 19, borderRadius: 11, backgroundColor: Colores.acento, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  cartCountText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  contenido: { flex: 1, backgroundColor: Colores.fondo },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingTop: 7,
    paddingBottom: 5,
    borderTopWidth: 1,
    borderTopColor: Colores.borde,
    shadowColor: '#17252B',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, minHeight: 56, gap: 3 },
  tabIconWrap: { position: 'relative', minWidth: 42, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabIconActivo: { backgroundColor: Colores.acentoSuave },
  tabIcon: { fontSize: 19, color: '#77818B', fontWeight: '700' },
  tabIconSelected: { color: Colores.acento },
  tabEtiqueta: { color: '#89929A', fontSize: 9, fontWeight: '700' },
  tabEtiquetaActiva: { color: Colores.acentoOscuro },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(23,37,43,0.97)',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 7,
  },
  toastTexto: { color: '#FFFFFF', fontSize: 13, textAlign: 'center', fontWeight: '600' },
});
