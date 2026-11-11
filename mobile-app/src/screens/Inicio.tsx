import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiFetch, pullCatalogSuite } from '../api';
import { apiAssetUrl } from '../config';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Estilos, Tarjeta } from '../ui';

export const InicioScreen: React.FC = () => {
  const { tenantSlug, usuario, pendientes, sincronizar, mostrarToast } = useApp();
  const nav = useNav();
  const [destacados, setDestacados] = useState<any[]>([]);
  const [refrescando, setRefrescando] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);

  const cargar = async () => {
    try {
      const rows = await apiFetch('/catalogo/productos', { tenantSlug });
      setDestacados(Array.isArray(rows) ? rows.slice(0, 10) : []);
      setOfflineMode(false);
    } catch {
      // Fallback a caché SQLite
      try {
        const pull = await pullCatalogSuite(tenantSlug);
        setDestacados((pull?.snapshot?.productos || []).slice(0, 10));
        setOfflineMode(true);
      } catch {
        setDestacados([]);
        setOfflineMode(true);
      }
    }
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  const onRefresh = async () => {
    setRefrescando(true);
    await sincronizar();
    await cargar();
    setRefrescando(false);
  };

  return (
    <ScrollView
      style={Estilos.contenedor}
      contentContainerStyle={Estilos.scroll}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={Colores.acento} />}
    >
      <View
        style={{
          backgroundColor: '#0f172a',
          borderRadius: 18,
          padding: 18,
          marginBottom: 14,
        }}
      >
        <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>
          FASHIONSTORE SAAS MULTI-TENANT
        </Text>
        <Text style={{ color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 6 }}>
          Hola{usuario?.nombre ? `, ${usuario.nombre.split(' ')[0]}` : ''} 👋
        </Text>
        <Text style={{ color: '#cbd5e1', fontSize: 12, marginTop: 4 }}>
          /tienda/{tenantSlug} · Colecciones exclusivas, Vestidor AR y compra con reserva en sucursal.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => nav.setTab('catalogo')}
            style={{ backgroundColor: Colores.acento, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Explorar catálogo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => nav.setTab('vestidor')}
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>🪞 Probador AR</Text>
          </TouchableOpacity>
        </View>
      </View>

      {pendientes > 0 && (
        <Tarjeta style={{ borderColor: '#fcd34d', backgroundColor: '#fffbeb' }}>
          <Text style={{ fontWeight: '800', color: '#92400e' }}>
            📡 {pendientes} operación(es) pendiente(s) de sincronizar (SQLite offline)
          </Text>
          <View style={{ height: 8 }} />
          <Boton titulo="Sincronizar ahora" onPress={sincronizar} variante="acento" />
        </Tarjeta>
      )}

      {offlineMode && (
        <Text style={{ fontSize: 11, color: Colores.suave, marginBottom: 8 }}>
          Mostrando datos de la caché local. Algunas funciones requieren conexión.
        </Text>
      )}

      <Text style={Estilos.h3}>✨ Colección destacada</Text>
      <FlatList
        data={destacados}
        horizontal
        keyExtractor={(item, idx) => String(item.id ?? idx)}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => nav.push('Producto', { productoId: item.id })}
            style={{
              width: 170,
              marginRight: 12,
              backgroundColor: '#fff',
              borderRadius: 14,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: Colores.borde,
            }}
          >
            <Image
              source={{ uri: apiAssetUrl(item.imagen_url) }}
              style={{ width: '100%', height: 170, backgroundColor: '#f1f5f9' }}
              resizeMode="cover"
            />
            <View style={{ padding: 10 }}>
              <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 13, color: Colores.tinta }}>
                {item.nombre}
              </Text>
              <Text style={{ color: Colores.acento, fontWeight: '900', marginTop: 2 }}>
                Bs. {Number(item.precio_base || 0).toFixed(2)}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ color: Colores.suave, paddingVertical: 24 }}>
            No se pudieron cargar productos. Desliza para reintentar.
          </Text>
        }
      />
    </ScrollView>
  );
};
export default InicioScreen;
