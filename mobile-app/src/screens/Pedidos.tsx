import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

type Row = Record<string, any>;
const money = (value: unknown) => `Bs. ${Number(value || 0).toFixed(2)}`;

export const PedidosScreen: React.FC = () => {
  const { tenantSlug, mostrarToast } = useApp();
  const [pedidos, setPedidos] = useState<Row[]>([]);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [comprobanteVentaId, setComprobanteVentaId] = useState<number | null>(null);
  const [comprobante, setComprobante] = useState<Row | null>(null);
  const [cargandoComprobante, setCargandoComprobante] = useState(false);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const rows = await apiFetch('/ventas/mias', { tenantSlug });
      setPedidos(Array.isArray(rows) ? rows : []);
    } catch (error: any) {
      setPedidos([]);
      mostrarToast(error?.message || 'No se pudieron cargar tus pedidos.');
    } finally {
      setCargando(false);
    }
  }, [tenantSlug, mostrarToast]);

  useEffect(() => { void cargar(); }, [cargar]);

  const verComprobante = async (ventaId: number) => {
    setExpandido(ventaId);
    setComprobanteVentaId(ventaId);
    setComprobante(null);
    setCargandoComprobante(true);
    try {
      const result = await apiFetch(`/ventas/${ventaId}/comprobante`, { tenantSlug });
      setComprobante(result);
    } catch (error: any) {
      mostrarToast(error?.message || 'No se pudo consultar el comprobante.');
    } finally {
      setCargandoComprobante(false);
    }
  };

  const renderPedido = ({ item }: { item: Row }) => {
    const abierto = expandido === Number(item.id);
    const datosComprobante = comprobanteVentaId === Number(item.id) ? comprobante?.comprobante : null;
    return (
      <Tarjeta style={{ padding: 0, overflow: 'hidden' }}>
        <TouchableOpacity
          onPress={() => setExpandido(abierto ? null : Number(item.id))}
          accessibilityRole="button"
          accessibilityState={{ expanded: abierto }}
          activeOpacity={0.82}
          style={{ padding: 16 }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '900', color: Colores.tinta, fontSize: 14 }}>{item.numero_comprobante || `Pedido #${item.id}`}</Text>
              <Text style={{ fontSize: 11, color: Colores.suave, marginTop: 4 }}>
                {item.creado_en ? new Date(item.creado_en).toLocaleString() : 'Fecha no disponible'} · {String(item.metodo_pago || '—').toUpperCase()}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 5 }}>
              <BadgeEstado estado={String(item.estado || 'pendiente')} />
              <Text style={{ fontWeight: '900', color: Colores.tinta }}>{money(item.total)}</Text>
            </View>
          </View>
          <Text style={{ color: Colores.acentoOscuro, fontSize: 11, fontWeight: '800', marginTop: 10 }}>
            {abierto ? 'Ocultar detalle  ↑' : 'Ver detalle  ↓'}
          </Text>
        </TouchableOpacity>

        {abierto && (
          <View style={{ borderTopWidth: 1, borderTopColor: Colores.borde, padding: 16, paddingTop: 13, gap: 9 }}>
            <Text style={Estilos.h3}>Detalle del pedido</Text>
            {(item.items || []).length ? (item.items || []).map((line: Row, index: number) => (
              <View key={`${line.id || line.variante_id || index}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 5 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colores.tinta, fontWeight: '700', fontSize: 12 }}>{line.producto_nombre || line.nombre || 'Prenda'} × {line.cantidad}</Text>
                  <Text style={Estilos.subtitulo}>{line.sku || ''} {line.talla ? `· ${line.talla}` : ''} {line.color ? `· ${line.color}` : ''}</Text>
                </View>
                <Text style={[Estilos.texto, { fontWeight: '800' }]}>{money(line.subtotal ?? (Number(line.precio_unitario || 0) * Number(line.cantidad || 0)))}</Text>
              </View>
            )) : <Text style={Estilos.texto}>El servidor no devolvió el desglose de prendas de este pedido.</Text>}
            <Text style={Estilos.subtitulo}>Estado de pago: {String(item.estado_pago || 'pendiente').replace(/_/g, ' ').toUpperCase()}</Text>
            <Boton titulo={cargandoComprobante && comprobanteVentaId === Number(item.id) ? 'Cargando comprobante…' : 'Ver comprobante de transacción'} variante="outline" deshabilitado={cargandoComprobante} onPress={() => void verComprobante(Number(item.id))} />

            {cargandoComprobante && comprobanteVentaId === Number(item.id) ? (
              <View style={{ alignItems: 'center', padding: 14 }}><ActivityIndicator color={Colores.acento} /><Text style={Estilos.subtitulo}>Consultando al servidor…</Text></View>
            ) : null}

            {datosComprobante ? (
              <View style={{ backgroundColor: '#FAF9F6', borderWidth: 1, borderColor: Colores.borde, borderRadius: 14, padding: 13, gap: 8 }}>
                <View style={{ borderBottomWidth: 1, borderBottomColor: Colores.borde, paddingBottom: 9, alignItems: 'center' }}>
                  <Text style={{ color: Colores.tinta, fontSize: 15, fontWeight: '900', textAlign: 'center' }}>{comprobante?.tienda?.nombre || 'FashionStore'}</Text>
                  <Text style={Estilos.subtitulo}>/{comprobante?.tienda?.slug || tenantSlug} · {datosComprobante.numero}</Text>
                  <BadgeEstado estado={String(datosComprobante.estado_pago || 'pendiente')} />
                  <Text style={{ color: Colores.texto, fontSize: 10, textAlign: 'center', marginTop: 4 }}>{datosComprobante.etiqueta_estado}</Text>
                </View>
                <Text style={Estilos.texto}>Cliente: {datosComprobante.cliente_nombre || '—'}</Text>
                <Text style={Estilos.texto}>NIT/CI: {datosComprobante.cliente_nit || '—'}</Text>
                <Text style={Estilos.texto}>Fecha: {datosComprobante.fecha ? new Date(datosComprobante.fecha).toLocaleString() : '—'}</Text>
                <Text style={Estilos.texto}>Método: {String(datosComprobante.metodo_pago || '—').toUpperCase()}</Text>
                {(datosComprobante.items || []).map((line: Row, index: number) => (
                  <View key={`receipt-${line.id || index}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={[Estilos.texto, { flex: 1 }]}>{line.producto_nombre} · {line.talla}/{line.color} × {line.cantidad}</Text>
                    <Text style={Estilos.texto}>{money(line.subtotal)}</Text>
                  </View>
                ))}
                <View style={{ borderTopWidth: 1, borderTopColor: Colores.borde, paddingTop: 8, alignItems: 'flex-end', gap: 3 }}>
                  <Text style={Estilos.texto}>Subtotal: {money(datosComprobante.subtotal)}</Text>
                  <Text style={Estilos.texto}>Descuento: −{money(datosComprobante.descuento)}</Text>
                  <Text style={{ color: Colores.tinta, fontSize: 17, fontWeight: '900' }}>Total: {money(datosComprobante.total)}</Text>
                </View>
                <Text style={[Estilos.subtitulo, { textAlign: 'center' }]}>Moneda: {datosComprobante.moneda || 'BOB'}</Text>
              </View>
            ) : null}
          </View>
        )}
      </Tarjeta>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colores.fondo }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Encabezado titulo="Mis pedidos y comprobantes" subtitulo="Historial de compras y estado de pago confirmado por el servidor." />
      </View>
      <FlatList
        data={pedidos}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingTop: 6, paddingBottom: 36, width: '100%', maxWidth: 980, alignSelf: 'center', flexGrow: 1 }}
        renderItem={renderPedido}
        refreshing={cargando}
        onRefresh={() => void cargar()}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: Colores.suave, padding: 40 }}>
            {cargando ? 'Cargando tus pedidos…' : 'Aún no tienes pedidos en esta tienda.'}
          </Text>
        }
      />
    </View>
  );
};
export default PedidosScreen;
