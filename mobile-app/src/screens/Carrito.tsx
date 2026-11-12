import React from 'react';
import {
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiAssetUrl } from '../config';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const CarritoScreen: React.FC = () => {
  const { carrito, agregarAlCarrito, quitarDelCarrito, limpiarCarrito } = useApp();
  const nav = useNav();

  const total = carrito.reduce((acc, i) => acc + i.precio_unitario * i.cantidad, 0);

  if (carrito.length === 0) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: Colores.fondo }}>
        <Text style={{ textAlign: 'center', fontSize: 44 }}>🛒</Text>
        <Text style={{ textAlign: 'center', color: Colores.texto, marginVertical: 12 }}>
          Tu carrito está vacío.
        </Text>
        <Boton titulo="Explorar catálogo" variante="acento" onPress={() => nav.setTab('catalogo')} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colores.fondo }}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Encabezado titulo="🛒 Carrito" subtitulo="Los precios se recalculan en el servidor al confirmar." />
      </View>

      <FlatList keyboardShouldPersistTaps="handled"
        data={carrito}
        keyExtractor={(item) => String(item.variante_id)}
        contentContainerStyle={{ padding: 16, width: '100%', maxWidth: 980, alignSelf: 'center', flexGrow: 1 }}
        renderItem={({ item }) => (
          <Tarjeta style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
            <Image
              source={{ uri: apiAssetUrl(item.imagen_url) }}
              style={{ width: 70, height: 96, borderRadius: 8, backgroundColor: '#f1f5f9' }}
            />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: Colores.tinta }} numberOfLines={2}>
                {item.nombre}
              </Text>
              <Text style={{ fontSize: 11, color: Colores.suave }}>
                {item.sku} · {item.talla}/{item.color}
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <Text style={{ fontWeight: '900', color: Colores.acento }}>
                  Bs. {item.precio_unitario.toFixed(2)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Reducir cantidad de ${item.nombre}`}
                    hitSlop={6}
                    onPress={() =>
                      item.cantidad <= 1
                        ? quitarDelCarrito(item.variante_id)
                        : agregarAlCarrito({ ...item, cantidad: -1 })
                    }
                    style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: Colores.superficie }}
                  >
                    <Text style={{ fontSize: 20, fontWeight: '900', color: Colores.texto }}>−</Text>
                  </TouchableOpacity>
                  <Text style={{ fontWeight: '900', color: Colores.tinta, minWidth: 18, textAlign: 'center' }}>{item.cantidad}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Aumentar cantidad de ${item.nombre}`}
                    hitSlop={6}
                    onPress={() => agregarAlCarrito({ ...item, cantidad: 1 })}
                    style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: Colores.acentoSuave }}
                  >
                    <Text style={{ fontSize: 20, fontWeight: '900', color: Colores.acentoOscuro }}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            <TouchableOpacity onPress={() => quitarDelCarrito(item.variante_id)}>
              <Text style={{ color: Colores.error, fontWeight: '700' }}>Quitar</Text>
            </TouchableOpacity>
          </Tarjeta>
        )}
      />

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: Colores.borde,
          backgroundColor: '#fff',
          padding: 16,
        }}
      >
        <View style={{ width: '100%', maxWidth: 948, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontWeight: '700', color: Colores.texto }}>Total</Text>
          <Text style={{ fontWeight: '900', fontSize: 20, color: Colores.tinta }}>
            Bs. {total.toFixed(2)}
          </Text>
        </View>
        <Boton titulo="Continuar al Checkout →" variante="acento" onPress={() => nav.push('Checkout')} />
        <View style={{ height: 6 }} />
        <TouchableOpacity onPress={limpiarCarrito} accessibilityRole="button" style={{ minHeight: 42, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ textAlign: 'center', color: Colores.suave, fontSize: 12, fontWeight: '700' }}>Vaciar carrito</Text>
        </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};
export default CarritoScreen;
