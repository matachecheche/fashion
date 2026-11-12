import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { apiFetch, pullCatalogSuite } from '../api';
import { apiAssetUrl } from '../config';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Colores, Encabezado, Estilos } from '../ui';

const TIPOS = ['todos', 'blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'] as const;

export const CatalogoScreen: React.FC = () => {
  const { tenantSlug } = useApp();
  const nav = useNav();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = Math.max(0, Math.min(windowWidth - 36, 944));
  const columns = windowWidth < 340 ? 1 : windowWidth < 760 ? 2 : 3;
  const gap = 12;
  const cardWidth = Math.max(132, (contentWidth - gap * (columns - 1)) / columns);
  const [productos, setProductos] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>('todos');
  const [cargando, setCargando] = useState(true);
  const [offline, setOffline] = useState(false);

  const cargar = async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (tipo !== 'todos') params.set('tipo_prenda', tipo);
    try {
      const rows = await apiFetch(`/catalogo/productos?${params.toString()}`, { tenantSlug });
      setProductos(Array.isArray(rows) ? rows : []);
      setOffline(false);
    } catch {
      try {
        const pull = await pullCatalogSuite(tenantSlug);
        let rows: any[] = pull?.snapshot?.productos || [];
        if (q.trim()) rows = rows.filter((p) => String(p.nombre).toLowerCase().includes(q.trim().toLowerCase()));
        if (tipo !== 'todos') rows = rows.filter((p) => p.tipo_prenda === tipo);
        setProductos(rows);
        setOffline(true);
      } catch {
        setProductos([]);
        setOffline(true);
      }
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tipo, tenantSlug]);

  return (
    <View style={Estilos.contenedor}>
      <View style={{ width: '100%', maxWidth: 980, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8 }}>
        <Encabezado
          titulo="👗 Catálogo"
          subtitulo={offline ? 'Caché local (offline)' : `Tenant: /tienda/${tenantSlug}`}
        />
        <TextInput
          style={Estilos.input}
          placeholder="Buscar prenda o tela…"
          placeholderTextColor="#94a3b8"
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
        />
        <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8, paddingRight: 6 }}>
          {TIPOS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTipo(t)}
              style={{
                minHeight: 38,
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderRadius: 999,
                backgroundColor: tipo === t ? Colores.oscuro : '#FFFFFF',
                borderWidth: 1,
                borderColor: tipo === t ? Colores.oscuro : Colores.borde,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  color: tipo === t ? '#fff' : Colores.texto,
                }}
              >
                {t.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {cargando ? (
        <View style={{ padding: 32, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={Colores.acento} />
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 980, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
            {productos.map((p) => (
              <TouchableOpacity
                key={p.id}
                activeOpacity={0.85}
                onPress={() => nav.push('Producto', { productoId: p.id })}
                style={{
                  width: cardWidth,
                  backgroundColor: '#FFFFFF',
                  borderRadius: 17,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: Colores.borde,
                }}
              >
                <Image
                  source={{ uri: apiAssetUrl(p.imagen_url) }}
                  style={{ width: '100%', height: Math.min(220, cardWidth * 1.08), backgroundColor: Colores.superficie }}
                  resizeMode="cover"
                />
                <View style={{ padding: 11 }}>
                  <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 18, fontWeight: '800', color: Colores.tinta }}>
                    {p.nombre}
                  </Text>
                  <Text style={{ fontSize: 10, color: Colores.suave, marginTop: 3 }}>
                    {(p.categoria_nombre || p.tipo_prenda || '').toString().toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: Colores.acentoOscuro, marginTop: 5 }}>
                    Bs. {Number(p.precio_base || 0).toFixed(2)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          {productos.length === 0 && (
            <Text style={{ color: Colores.suave, textAlign: 'center', padding: 32 }}>
              Sin resultados para esta búsqueda.
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
};
export default CatalogoScreen;
