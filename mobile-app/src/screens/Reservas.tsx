import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const ReservasScreen: React.FC = () => {
  const { tenantSlug, cola, sincronizar, mostrarToast } = useApp();
  const [reservas, setReservas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const rows = await apiFetch('/reservas/mias', { tenantSlug });
      setReservas(Array.isArray(rows) ? rows : []);
    } catch {
      setReservas([]);
    } finally {
      setCargando(false);
    }
  }, [tenantSlug]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cancelar = async (id: number) => {
    try {
      await apiFetch(`/reservas/${id}/cancelar`, { method: 'POST', tenantSlug });
      mostrarToast('Reserva cancelada. Stock liberado.');
      cargar();
    } catch (err: any) {
      mostrarToast(err?.message || 'No se pudo cancelar.');
    }
  };

  const offlineReservas = cola.filter((x) => x.tipo === 'reserva');

  return (
    <ScrollView
      style={Estilos.contenedor}
      contentContainerStyle={Estilos.scroll}
      refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargar} tintColor={Colores.acento} />}
    >
      <Encabezado
        titulo="📅 Mis Reservas"
        subtitulo="Prendas apartadas para prueba física en tienda."
      />

      {offlineReservas.length > 0 && (
        <Tarjeta style={{ borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
          <Text style={{ fontWeight: '800', color: '#92400e', marginBottom: 8 }}>
            📡 {offlineReservas.length} reserva(s) en cola offline (SQLite)
          </Text>
          {offlineReservas.map((op) => (
            <Text key={op.id} style={{ fontSize: 11, color: '#92400e' }}>
              {op.id} · {op.estado.toUpperCase()}
            </Text>
          ))}
          <View style={{ height: 8 }} />
          <Boton titulo="Sincronizar ahora" variante="acento" onPress={sincronizar} />
        </Tarjeta>
      )}

      {reservas.length === 0 && !cargando && (
        <Text style={{ color: Colores.suave, textAlign: 'center', padding: 40 }}>
          No tienes reservas en esta tienda.
        </Text>
      )}

      {reservas.map((r) => (
        <Tarjeta key={r.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontWeight: '800', color: Colores.tinta }}>{r.codigo}</Text>
              <Text style={{ fontSize: 11, color: Colores.suave, marginTop: 4 }}>
                {r.sucursal_nombre || `Sucursal #${r.sucursal_id}`} · cita{' '}
                {r.fecha_cita ? new Date(r.fecha_cita).toLocaleString() : 'Fecha no disponible'}
              </Text>
              <Text style={{ fontSize: 11, color: Colores.suave, marginTop: 3 }}>Expira: {r.expira_en ? new Date(r.expira_en).toLocaleString() : 'No indicado'}</Text>
            </View>
            <BadgeEstado estado={r.estado} />
          </View>
          {(r.items || []).length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: Colores.borde, marginTop: 12, paddingTop: 10, gap: 6 }}>
              <Text style={Estilos.label}>PRENDAS RESERVADAS</Text>
              {(r.items || []).map((item: any, index: number) => (
                <View key={`${item.id || item.variante_id || index}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={[Estilos.texto, { flex: 1 }]}>{item.producto_nombre || 'Prenda'} · {item.sku || 'Sin SKU'} · Talla {item.talla || '—'} · {item.color || '—'} × {item.cantidad || 1}</Text>
                  <Text style={[Estilos.texto, { fontWeight: '800' }]}>Bs. {Number(item.precio_unitario || 0).toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}
          {['pendiente', 'preparada'].includes(r.estado) && (
            <View style={{ marginTop: 10 }}>
              <Boton titulo="Cancelar reserva" variante="outline" onPress={() => cancelar(r.id)} />
            </View>
          )}
        </Tarjeta>
      ))}
    </ScrollView>
  );
};
export default ReservasScreen;
