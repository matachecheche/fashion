import React, { useEffect, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { BadgeEstado, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const PedidosScreen: React.FC = () => {
  const { tenantSlug } = useApp();
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [expandido, setExpandido] = useState<number | null>(null);

  useEffect(() => {
    apiFetch('/ventas/mias', { tenantSlug })
      .then((rows) => setPedidos(Array.isArray(rows) ? rows : []))
      .catch(() => setPedidos([]));
  }, [tenantSlug]);

  return (
    <View style={{ flex: 1, backgroundColor: Colores.fondo }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Encabezado titulo="📦 Mis Pedidos" subtitulo="Estado validado contra la pasarela Sandbox." />
      </View>
      <FlatList
        data={pedidos}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => setExpandido(expandido === item.id ? null : item.id)}>
            <Tarjeta>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ fontWeight: '800', color: Colores.tinta }}>{item.numero_comprobante}</Text>
                  <Text style={{ fontSize: 11, color: Colores.suave }}>
                    {new Date(item.creado_en || Date.now()).toLocaleString()} · {String(item.metodo_pago || '').toUpperCase()}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <BadgeEstado estado={item.estado} />
                  <Text style={{ fontWeight: '900', marginTop: 4, color: Colores.tinta }}>
                    Bs. {Number(item.total || 0).toFixed(2)}
                  </Text>
                </View>
              </View>
              {expandido === item.id && (
                <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 }}>
                  {(item.items || []).map((it: any, idx: number) => (
                    <Text key={idx} style={[Estilos.texto, { marginBottom: 2 }]}>
                      · {it.producto_nombre || it.nombre || 'Prenda'} × {it.cantidad} — Bs.{' '}
                      {Number(it.precio_unitario || 0).toFixed(2)}
                    </Text>
                  ))}
                  <Text style={{ fontSize: 11, color: Colores.suave, marginTop: 4 }}>
                    Estado de pago: {String(item.estado_pago || 'pendiente').toUpperCase()}
                  </Text>
                </View>
              )}
            </Tarjeta>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ textAlign: 'center', color: Colores.suave, padding: 40 }}>
            Aún no tienes pedidos en esta tienda.
          </Text>
        }
      />
    </View>
  );
};
export default PedidosScreen;
