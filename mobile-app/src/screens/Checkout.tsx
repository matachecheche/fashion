import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const CheckoutScreen: React.FC = () => {
  const { tenantSlug, usuario, carrito, limpiarCarrito, online, mostrarToast } = useApp();
  const nav = useNav();
  const [metodoPago, setMetodoPago] = useState<'qr' | 'tarjeta'>('qr');
  const [nombre, setNombre] = useState(usuario?.nombre || 'Consumidor Final');
  const [nit, setNit] = useState('0');
  const [promocion, setPromocion] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripeCheckoutHabilitado, setStripeCheckoutHabilitado] = useState(false);

  useEffect(() => {
    let vigente = true;
    apiFetch('/pagos/config', { tenantSlug })
      .then((config) => { if (vigente) setStripeCheckoutHabilitado(Boolean(config?.stripe_checkout_habilitado)); })
      .catch(() => { if (vigente) setStripeCheckoutHabilitado(false); });
    return () => { vigente = false; };
  }, [tenantSlug]);

  const subtotal = carrito.reduce((acc, i) => acc + i.precio_unitario * i.cantidad, 0);

  if (carrito.length === 0) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: Colores.fondo }}>
        <Text style={{ textAlign: 'center', color: Colores.texto }}>Tu carrito está vacío.</Text>
        <View style={{ height: 12 }} />
        <Boton titulo="Ir al catálogo" variante="acento" onPress={() => nav.setTab('catalogo')} />
      </View>
    );
  }

  if (!usuario) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: Colores.fondo }}>
        <Text style={{ textAlign: 'center', color: Colores.texto, marginBottom: 14 }}>
          Inicia sesión para confirmar tu pedido.
        </Text>
        <Boton titulo="Ingresar / Registrarme" variante="acento" onPress={() => nav.push('Auth', { volver: 'Checkout' })} />
      </View>
    );
  }

  const confirmar = async () => {
    setProcesando(true);
    setError(null);
    const payload = {
      sucursal_id: 1,
      metodo_pago: metodoPago,
      origen: 'web',
      cliente_nombre: nombre,
      cliente_nit: nit,
      promocion_codigo: promocion.trim() || undefined,
      items: carrito.map((i) => ({ variante_id: i.variante_id, cantidad: i.cantidad })),
    };
    try {
      if (!online) {
        setError('Se requiere conexión para crear una orden y pagar con QR o tarjeta. Tu carrito se conserva en este dispositivo.');
        return;
      }
      const venta = await apiFetch('/ventas', { method: 'POST', tenantSlug, body: payload });
      limpiarCarrito();
      nav.push('Pago', {
        pagoId: venta?.pago?.id,
        ventaId: venta?.id,
        numero: venta?.numero_comprobante,
        pasarela: venta?.pago?.pasarela,
        total: venta?.total,
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      setError(
        err?.status === undefined || msg.includes('Network request failed')
          ? 'No hay conexión con el servidor. El carrito permanece guardado; los pagos requieren conexión.'
          : msg || 'No se pudo procesar el pedido.',
      );
    } finally {
      setProcesando(false);
    }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Encabezado
        titulo="💳 Checkout de prueba"
        subtitulo="Ningún pedido se marca pagado por una respuesta del teléfono; el backend valida la confirmación del proveedor."
      />

      <View
        style={{
          backgroundColor: '#fffbeb',
          borderColor: '#fde68a',
          borderWidth: 1,
          borderRadius: 10,
          padding: 10,
          marginBottom: 12,
        }}
      >
        <Text style={{ fontSize: 12, color: '#92400e' }}>
          El pedido quedará <Text style={{ fontWeight: '800' }}>PENDIENTE DE PAGO</Text>.{' '}
          {stripeCheckoutHabilitado
            ? 'Stripe abrirá su formulario alojado en modo de prueba; la venta espera el webhook firmado.'
            : 'Stripe aún no está conectado: la opción de tarjeta será una simulación y no validará una tarjeta.'}
        </Text>
      </View>

      {error && (
        <View
          style={{
            backgroundColor: '#fee2e2',
            borderRadius: 10,
            padding: 10,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: '#b91c1c', fontSize: 13 }}>{error}</Text>
        </View>
      )}

      <Tarjeta>
        <Text style={Estilos.label}>Nombre para factura</Text>
        <TextInput style={Estilos.input} value={nombre} onChangeText={setNombre} />
        <View style={{ height: 10 }} />
        <Text style={Estilos.label}>NIT / CI</Text>
        <TextInput style={Estilos.input} value={nit} onChangeText={setNit} keyboardType="numbers-and-punctuation" />
        <View style={{ height: 10 }} />
        <Text style={Estilos.label}>Cupón promocional (opcional)</Text>
        <TextInput style={Estilos.input} value={promocion} onChangeText={setPromocion} autoCapitalize="characters" placeholder="MODA2026" placeholderTextColor="#94a3b8" />
      </Tarjeta>

      <Tarjeta>
        <Text style={Estilos.label}>Pasarela Sandbox</Text>
        {([
          { id: 'qr', titulo: '📱 QR Simple Bolivia (Libélula)', desc: 'Retiene stock y espera confirmación del proveedor' },
          {
            id: 'tarjeta',
            titulo: stripeCheckoutHabilitado ? '💳 Tarjeta de prueba — Stripe Checkout' : '💳 Tarjeta — simulador Stripe',
            desc: stripeCheckoutHabilitado
              ? 'Formulario alojado por Stripe; solo usa tarjetas de prueba, sin cargos reales.'
              : 'No hay formulario de tarjeta conectado: esta opción solo permite simular aprobación o rechazo.',
          },
        ] as const).map((opcion) => (
          <TouchableOpacity
            key={opcion.id}
            onPress={() => setMetodoPago(opcion.id)}
            style={{
              borderWidth: 1,
              borderRadius: 10,
              borderColor: metodoPago === opcion.id ? Colores.acento : Colores.borde,
              backgroundColor: metodoPago === opcion.id ? '#fffbeb' : '#fff',
              padding: 12,
              marginBottom: 8,
            }}
          >
            <Text style={{ fontWeight: '800', color: Colores.tinta }}>{opcion.titulo}</Text>
            <Text style={{ fontSize: 11, color: Colores.suave }}>{opcion.desc}</Text>
          </TouchableOpacity>
        ))}
      </Tarjeta>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: Colores.texto }}>Total</Text>
        <Text style={{ fontSize: 22, fontWeight: '900', color: Colores.tinta }}>Bs. {subtotal.toFixed(2)}</Text>
      </View>

      <Boton
        titulo={procesando ? 'Generando orden…' : online ? 'Generar orden y pasar al pago' : 'Requiere conexión para pagar'}
        variante="acento"
        onPress={confirmar}
        deshabilitado={procesando || !online}
      />
    </ScrollView>
  );
};
export default CheckoutScreen;
