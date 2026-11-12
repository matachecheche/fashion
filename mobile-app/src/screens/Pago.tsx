import React, { useEffect, useState } from 'react';
import { AppState, Image, Linking, ScrollView, Text, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const PagoScreen: React.FC<{ navParams?: any }> = ({ navParams }) => {
  const { tenantSlug, mostrarToast } = useApp();
  const nav = useNav();
  const [pago, setPago] = useState<any | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [stripeCheckoutHabilitado, setStripeCheckoutHabilitado] = useState(false);

  const pagoId: number | undefined = navParams?.pagoId;
  const ventaId: number | undefined = navParams?.ventaId;

  const cargar = async (pagoIdOverride?: number) => {
    const idActual = pagoIdOverride || pagoId;
    try {
      if (idActual) {
        const res = await apiFetch(`/pagos/${idActual}`, { tenantSlug });
        setPago(res);
        return;
      }
      if (ventaId) {
        const v = await apiFetch(`/ventas/${ventaId}`, { tenantSlug });
        if (v?.pagos?.[0]) setPago({ ...v.pagos[0], numero_comprobante: v.numero_comprobante });
      }
    } catch {
      setPago({
        id: pagoId,
        venta_id: ventaId,
        pasarela: navParams?.pasarela || 'sandbox',
        estado: 'no_confirmado',
        monto: navParams?.total ?? 0,
        referencia_externa: 'PENDIENTE',
        numero_comprobante: navParams?.numero,
      });
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagoId, ventaId]);

  useEffect(() => {
    let vigente = true;
    apiFetch('/pagos/config', { tenantSlug })
      .then((config) => { if (vigente) setStripeCheckoutHabilitado(Boolean(config?.stripe_checkout_habilitado)); })
      .catch(() => { if (vigente) setStripeCheckoutHabilitado(false); });
    return () => { vigente = false; };
  }, [tenantSlug]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void cargar();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagoId, ventaId, tenantSlug]);

  useEffect(() => {
    if (!pago || !['no_confirmado', 'pendiente'].includes(String(pago.estado))) return;
    const timer = setInterval(() => void cargar(Number(pago.id)), 15000);
    return () => clearInterval(timer);
  }, [pago?.id, pago?.estado, tenantSlug]);

  const abrirStripeCheckout = async () => {
    if (!pago?.id || !stripeCheckoutHabilitado) {
      mostrarToast('Stripe Checkout en modo test todavía no está configurado.');
      return;
    }
    setProcesando(true);
    try {
      const checkout = await apiFetch(`/pagos/${pago.id}/stripe/checkout`, {
        method: 'POST',
        tenantSlug,
      });
      if (!checkout?.checkout_url) {
        await cargar(Number(pago.id));
        mostrarToast('Stripe recibió el intento. El servidor espera el webhook firmado para confirmar el pedido.');
        return;
      }
      await Linking.openURL(String(checkout.checkout_url));
      mostrarToast('Se abrió Stripe Checkout de prueba. Al terminar, vuelve a FashionStore; el estado se verifica en el servidor.');
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo abrir Stripe Checkout de prueba.');
    } finally {
      setProcesando(false);
    }
  };

  const simular = async (accion: 'aprobar' | 'rechazar') => {
    if (!pago?.id) {
      mostrarToast('Pago aún no sincronizado con el servidor.');
      return;
    }
    setProcesando(true);
    try {
      await apiFetch('/pagos/sandbox/simular-webhook', {
        method: 'POST',
        tenantSlug,
        body: {
          pago_id: pago.id,
          estado: accion === 'aprobar' ? 'aprobado' : 'rechazado',
          webhook_id: `WH-APP-${Date.now()}`,
          motivo: accion === 'rechazar' ? 'Rechazo simulado en la app (sandbox)' : undefined,
        },
      });
      await cargar();
      mostrarToast(
        accion === 'aprobar'
          ? '✅ Pago confirmado por proveedor Sandbox. Stock descontado.'
          : '❌ Pago rechazado. El stock retenido fue liberado.',
      );
    } catch (err: any) {
      mostrarToast(err?.message || 'Error al procesar el pago sandbox.');
    } finally {
      setProcesando(false);
    }
  };

  const reintentarPago = async () => {
    if (!pago?.venta_id) {
      mostrarToast('No se encontró la venta asociada para crear otro intento.');
      return;
    }
    setProcesando(true);
    try {
      const nuevo = await apiFetch(`/pagos/venta/${pago.venta_id}/reintentar`, {
        method: 'POST',
        tenantSlug,
        body: { metodo_pago: pago.metodo },
      });
      mostrarToast('Nuevo intento de pago sandbox generado. No se realizó un cobro real.');
      nav.pop();
      nav.push('Pago', { pagoId: nuevo.id, ventaId: pago.venta_id });
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo reintentar el pago.');
    } finally {
      setProcesando(false);
    }
  };

  if (!pago) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colores.fondo }}>
        <Text style={{ color: Colores.texto }}>Cargando pasarela Sandbox…</Text>
      </View>
    );
  }

  const confirmado = pago.estado === 'aprobado' && Boolean(pago.confirmado_proveedor);
  const requiereIntervencion = ['aprobado_sin_venta', 'reembolso_pendiente'].includes(String(pago.estado));
  const pagoExpirado = pago.estado === 'expirado' || Boolean(pago.qr_expirado);
  const esPagoStripe = String(pago.pasarela) === 'stripe_sandbox';
  const stripeTestActivo = esPagoStripe && stripeCheckoutHabilitado;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Encabezado
        titulo={stripeTestActivo ? 'Tarjeta de prueba — Stripe Checkout' : `Simulador de pago (${String(pago.pasarela || '').toUpperCase()})`}
        subtitulo={`Comprobante: ${pago.numero_comprobante || `#${ventaId}`} · Ref: ${pago.referencia_externa}`}
      />

      <Tarjeta style={{ borderColor: confirmado ? '#86efac' : requiereIntervencion ? '#fca5a5' : pagoExpirado ? '#cbd5e1' : '#fde68a', backgroundColor: confirmado ? '#f0fdf4' : requiereIntervencion ? '#fef2f2' : pagoExpirado ? '#f1f5f9' : '#fffbeb' }}>
        <BadgeEstado estado={pago.estado} />
        <View style={{ height: 8 }} />
        <Text style={{ fontWeight: '800', color: Colores.tinta, fontSize: 15 }}>
          {confirmado
            ? '✅ PAGO CONFIRMADO POR EL PROVEEDOR SANDBOX'
            : requiereIntervencion
              ? '⚠️ PAGO CONFIRMADO, PERO LA VENTA REQUIERE INTERVENCIÓN. NO ENTREGUES EL PEDIDO.'
              : pagoExpirado
                ? '⌛ INTENTO VENCIDO — no pagues el QR anterior; la orden está en conciliación.'
                : pago.estado === 'rechazado'
                  ? '❌ RECHAZADO — stock liberado'
                  : '⏳ PENDIENTE DE CONFIRMACIÓN DEL PROVEEDOR'}
        </Text>
        <Text style={[Estilos.texto, { marginTop: 6 }]}>
          Monto: Bs. {Number(pago.monto || 0).toFixed(2)} (BOB)
        </Text>
      </Tarjeta>

      {stripeTestActivo && !confirmado && !requiereIntervencion && !pagoExpirado && pago.estado !== 'rechazado' && (
        <Tarjeta>
          <Text style={Estilos.h3}>Paga con una tarjeta de prueba</Text>
          <Text style={[Estilos.texto, { fontSize: 12, marginBottom: 10 }]}>
            Se abrirá el Checkout seguro alojado por Stripe. El pedido solo se confirma al recibir y validar el webhook del proveedor; no ingreses datos de una tarjeta real.
          </Text>
          <Boton
            titulo={procesando ? 'Abriendo Stripe…' : '💳 Abrir Stripe Checkout (TEST)'}
            variante="acento"
            onPress={abrirStripeCheckout}
            deshabilitado={procesando}
          />
        </Tarjeta>
      )}

      {esPagoStripe && !stripeCheckoutHabilitado && !confirmado && (
        <Tarjeta style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
          <Text style={[Estilos.texto, { fontSize: 12, color: '#92400e' }]}>
            Stripe Checkout todavía no está configurado en el servidor. Los botones de abajo son únicamente una simulación y no validan datos de tarjeta.
          </Text>
        </Tarjeta>
      )}

      {pago.qr_data_url && !confirmado && !requiereIntervencion && !pagoExpirado && (
        <Tarjeta>
          <Text style={Estilos.h3}>QR dinámico de referencia — sandbox</Text>
          <Image source={{ uri: pago.qr_data_url }} style={{ width: 224, height: 224, alignSelf: 'center', marginVertical: 10 }} />
          <Text style={[Estilos.texto, { fontSize: 12, color: '#64748b' }]}>{pago.qr_aviso}</Text>
        </Tarjeta>
      )}

      {pagoExpirado && (
        <Tarjeta style={{ borderColor: '#cbd5e1', backgroundColor: '#f1f5f9' }}>
          <Text style={Estilos.texto}>{pago.qr_aviso || 'El intento venció y la orden está siendo conciliada. No pagues un QR anterior.'}</Text>
        </Tarjeta>
      )}

      {!confirmado && !requiereIntervencion && !pagoExpirado && pago.estado !== 'rechazado' && !stripeTestActivo && (
        <Tarjeta>
          <Text style={Estilos.h3}>Simulación de proveedor — no valida una tarjeta</Text>
          <Boton
            titulo={procesando ? 'Procesando…' : '✅ Simular aprobación'}
            variante="ok"
            onPress={() => simular('aprobar')}
            deshabilitado={procesando}
          />
          <View style={{ height: 8 }} />
          <Boton
            titulo="❌ Simular rechazo"
            variante="peligro"
            onPress={() => simular('rechazar')}
            deshabilitado={procesando}
          />
        </Tarjeta>
      )}

      {['rechazado', 'expirado'].includes(String(pago.estado)) && (
        <Tarjeta>
          <Boton
            titulo={procesando ? 'Creando intento…' : '🔄 Reintentar pago sandbox'}
            variante="acento"
            onPress={reintentarPago}
            deshabilitado={procesando}
          />
        </Tarjeta>
      )}

      <View style={{ height: 8 }} />
      <Boton titulo="Ver mis pedidos" variante="outline" onPress={() => nav.push('Pedidos')} />
      <View style={{ height: 8 }} />
      <Boton titulo="Seguir comprando" variante="acento" onPress={() => nav.popToRoot()} />
    </ScrollView>
  );
};
export default PagoScreen;
