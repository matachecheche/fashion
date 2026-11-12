import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { apiFetch } from '../api';
import { apiAssetUrl } from '../config';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Cargando, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const ProductoScreen: React.FC<{ navParams?: any }> = ({ navParams }) => {
  const productoId: number = Number(navParams?.productoId);
  const { tenantSlug, agregarAlCarrito } = useApp();
  const nav = useNav();
  const { width: windowWidth } = useWindowDimensions();
  const imageHeight = Math.min(480, Math.max(220, windowWidth * 0.88));
  const [producto, setProducto] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [varianteSel, setVarianteSel] = useState<any | null>(null);

  useEffect(() => {
    if (!productoId) return;
    apiFetch(`/catalogo/productos/${productoId}`, { tenantSlug })
      .then((res) => {
        setProducto(res);
        if (res?.variantes?.length) setVarianteSel(res.variantes[0]);
      })
      .catch((e) => setError(e?.message || 'No se pudo cargar el producto'));
  }, [productoId, tenantSlug]);

  const precioFinal = useMemo(
    () => Number(producto?.precio_base || 0) + Number(varianteSel?.precio_adicional || 0),
    [producto, varianteSel],
  );

  if (error) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ color: Colores.error, textAlign: 'center' }}>{error}</Text>
        <View style={{ height: 12 }} />
        <Boton titulo="Volver" onPress={nav.pop} variante="outline" />
      </View>
    );
  }
  if (!producto) return <Cargando texto="Cargando prenda…" />;

  const imagen = varianteSel?.foto_url || producto.imagen_url;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Image
        source={{ uri: apiAssetUrl(imagen) }}
        style={{
          width: '100%',
          height: imageHeight,
          borderRadius: 16,
          backgroundColor: '#f1f5f9',
          borderWidth: 1,
          borderColor: Colores.borde,
        }}
        resizeMode="contain"
      />

      <Encabezado
        titulo={producto.nombre}
        subtitulo={`${producto.codigo} · ${String(producto.material || '').slice(0, 60)}`}
      />

      <Text style={{ fontSize: 24, fontWeight: '900', color: Colores.acento, marginBottom: 12 }}>
        Bs. {precioFinal.toFixed(2)}
      </Text>

      <Text style={Estilos.label}>Selecciona variante:</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {(producto.variantes || []).map((v: any) => {
          const activa = varianteSel?.id === v.id;
          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => setVarianteSel(v)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: activa ? Colores.tinta : Colores.borde,
                backgroundColor: activa ? Colores.tinta : '#fff',
              }}
            >
              <Text style={{ color: activa ? '#fff' : Colores.texto, fontWeight: '700', fontSize: 12 }}>
                {v.talla} / {String(v.color).toUpperCase()}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <Boton
          titulo="🛒 Agregar al carrito"
          variante="acento"
          onPress={() => {
            if (!varianteSel) return;
            agregarAlCarrito({
              variante_id: varianteSel.id,
              producto_id: producto.id,
              sku: varianteSel.sku,
              nombre: producto.nombre,
              talla: varianteSel.talla,
              color: varianteSel.color,
              precio_unitario: precioFinal,
              cantidad: 1,
              imagen_url: imagen,
            });
          }}
        />
        <Boton
          titulo="📅 Reservar en sucursal"
          onPress={() => nav.push('Reservar', { productoId: producto.id, variante: varianteSel })}
        />
        <Boton
          titulo="🪞 Probar en Probador AR"
          variante="outline"
          onPress={() =>
            nav.push('ProbadorAR', {
              tipo: producto.tipo_prenda,
              color: varianteSel?.color || 'rojo',
              productoId: producto.id,
            })
          }
        />
      </View>

      <Tarjeta style={{ marginTop: 14 }}>
        <Text style={Estilos.h3}>Disponibilidad por sucursal</Text>
        {(producto.disponibilidad_sucursales || []).length === 0 && (
          <Text style={Estilos.texto}>Sin desglose de stock (requiere backend activo).</Text>
        )}
        {(producto.disponibilidad_sucursales || []).map((d: any, idx: number) => (
          <View
            key={idx}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingVertical: 6,
              borderBottomWidth: 1,
              borderBottomColor: '#f1f5f9',
            }}
          >
            <Text style={Estilos.texto}>{d.sucursal_nombre}</Text>
            <Text style={[Estilos.texto, { fontWeight: '800' }]}>{d.disponible} u.</Text>
          </View>
        ))}
      </Tarjeta>
    </ScrollView>
  );
};
export default ProductoScreen;
