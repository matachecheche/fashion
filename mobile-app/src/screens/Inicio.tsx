import React, { useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { apiFetch, pullCatalogSuite } from '../api';
import { apiAssetUrl } from '../config';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Estilos, Seccion, Tarjeta } from '../ui';

export const InicioScreen: React.FC = () => {
  const { tenantSlug, usuario, pendientes, sincronizar } = useApp();
  const nav = useNav();
  const [destacados, setDestacados] = useState<any[]>([]);
  const [recomendados, setRecomendados] = useState<any[]>([]);
  const [refrescando, setRefrescando] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);

  const cargar = async () => {
    try {
      const rows = await apiFetch('/catalogo/productos', { tenantSlug });
      setDestacados(Array.isArray(rows) ? rows.slice(0, 10) : []);
      setOfflineMode(false);
    } catch {
      try {
        const pull = await pullCatalogSuite(tenantSlug);
        setDestacados((pull?.snapshot?.productos || []).slice(0, 10));
      } catch { setDestacados([]); }
      setOfflineMode(true);
    }
    try {
      const result = await apiFetch('/ia/recomendaciones?limite=4', { tenantSlug });
      setRecomendados(Array.isArray(result?.recomendaciones) ? result.recomendaciones : []);
    } catch { setRecomendados([]); }
  };

  useEffect(() => { void cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantSlug]);

  const onRefresh = async () => {
    setRefrescando(true);
    try { await sincronizar(); await cargar(); }
    finally { setRefrescando(false); }
  };

  const renderProduct = (item: any, recommended = false) => (
    <TouchableOpacity
      key={`${recommended ? 'rec' : 'featured'}-${item.id}`}
      activeOpacity={0.86}
      onPress={() => nav.push('Producto', { productoId: item.id })}
      style={{ width: recommended ? 210 : 178, marginRight: 12, backgroundColor: '#FFFFFF', borderRadius: 17, overflow: 'hidden', borderWidth: 1, borderColor: Colores.borde }}
    >
      <Image source={{ uri: apiAssetUrl(item.imagen_url) }} style={{ width: '100%', height: 184, backgroundColor: Colores.superficie }} resizeMode="cover" />
      <View style={{ padding: 12 }}>
        {recommended && <Text style={{ color: Colores.ok, fontSize: 9, fontWeight: '900', letterSpacing: 0.5, marginBottom: 4 }}>RECOMENDADO PARA TI</Text>}
        <Text numberOfLines={2} style={{ color: Colores.tinta, fontSize: 13, lineHeight: 18, fontWeight: '800' }}>{item.nombre}</Text>
        {!!item.motivo_recomendacion && recommended ? <Text numberOfLines={2} style={{ color: Colores.suave, fontSize: 10, marginTop: 4 }}>{item.motivo_recomendacion}</Text> : null}
        <Text style={{ color: Colores.acentoOscuro, fontWeight: '900', fontSize: 14, marginTop: 7 }}>Bs. {Number(item.precio_base || 0).toFixed(2)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView keyboardShouldPersistTaps="handled"
      style={Estilos.contenedor}
      contentContainerStyle={Estilos.scroll}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={Colores.acento} />}
    >
      <View style={{ backgroundColor: Colores.oscuro, borderRadius: 22, padding: 22, marginBottom: 18, overflow: 'hidden' }}>
        <View style={{ alignSelf: 'flex-start', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(224,190,160,0.38)', backgroundColor: 'rgba(168,107,67,0.18)', paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: '#E8C9B2', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>MODA · ESTILO · EXPERIENCIA</Text>
        </View>
        <Text style={{ color: '#FFFFFF', fontSize: 27, lineHeight: 34, fontWeight: '900', marginTop: 16, letterSpacing: -0.5 }}>
          Hola{usuario?.nombre ? `, ${usuario.nombre.split(' ')[0]}` : ''}. {'\n'}Tu estilo empieza aquí.
        </Text>
        <Text style={{ color: '#D5DEDC', fontSize: 13, lineHeight: 20, marginTop: 8 }}>
          Descubre la colección, prueba tus prendas en el vestidor virtual y reserva tu visita a tienda.
        </Text>
        <View style={{ flexDirection: 'row', gap: 9, marginTop: 18 }}>
          <View style={{ flex: 1 }}><Boton titulo="Ver catálogo" onPress={() => nav.setTab('catalogo')} variante="acento" /></View>
          <View style={{ flex: 1 }}><Boton titulo="Vestidor AR" onPress={() => nav.setTab('vestidor')} variante="outline" estilo={{ backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.3)' }} /></View>
        </View>
        <Text style={{ color: '#AAB8B5', fontSize: 10, marginTop: 16 }}>TIENDA ACTIVA · /{tenantSlug}</Text>
      </View>

      {pendientes > 0 && (
        <Tarjeta style={{ borderColor: '#E8D2B2', backgroundColor: '#FFFAF2' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Text style={{ fontSize: 20 }}>↻</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colores.tinta, fontWeight: '900', fontSize: 13 }}>{pendientes} operación(es) esperando sincronización</Text>
              <Text style={Estilos.subtitulo}>Se enviarán al recuperar la conexión.</Text>
            </View>
          </View>
          <Boton titulo="Sincronizar ahora" onPress={sincronizar} variante="acento" estilo={{ marginTop: 12 }} />
        </Tarjeta>
      )}

      {offlineMode && <Text style={{ color: Colores.warn, fontSize: 11, marginBottom: 12 }}>Estás viendo la última colección guardada en el dispositivo. Algunas funciones necesitan conexión.</Text>}

      <Seccion titulo="Colección destacada" accion={<TouchableOpacity onPress={() => nav.setTab('catalogo')}><Text style={{ color: Colores.acentoOscuro, fontSize: 11, fontWeight: '900' }}>VER TODO →</Text></TouchableOpacity>}>
        {destacados.length ? (
          <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 4 }}>
            {destacados.map((product) => renderProduct(product))}
          </ScrollView>
        ) : (
          <Tarjeta><Text style={Estilos.texto}>Esta tienda todavía no tiene prendas publicadas. Vuelve a intentarlo al actualizar el catálogo.</Text></Tarjeta>
        )}
      </Seccion>

      {recomendados.length > 0 && (
        <Seccion titulo="Selección para ti">
          <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 4 }}>
            {recomendados.map((product) => renderProduct(product, true))}
          </ScrollView>
        </Seccion>
      )}

      <Seccion titulo="Tu FashionStore">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {[
            { title: 'Mis pedidos', desc: 'Consulta tus compras', icon: '▤', action: () => nav.push('Pedidos') },
            { title: 'Mis reservas', desc: 'Gestiona tus citas', icon: '▣', action: () => nav.push('Reservas') },
            { title: 'Asistente IA', desc: 'Resuelve tus dudas', icon: '✧', action: () => nav.push('Asistente') },
            { title: 'Ayuda', desc: 'Guías y consejos', icon: '?', action: () => nav.push('Ayuda') },
          ].map((shortcut) => (
            <TouchableOpacity key={shortcut.title} onPress={shortcut.action} activeOpacity={0.85} style={{ width: '48%', minHeight: 88, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colores.borde, borderRadius: 16, padding: 13 }}>
              <Text style={{ color: Colores.acento, fontSize: 19, fontWeight: '900' }}>{shortcut.icon}</Text>
              <Text style={{ color: Colores.tinta, fontWeight: '900', fontSize: 12, marginTop: 5 }}>{shortcut.title}</Text>
              <Text style={{ color: Colores.suave, fontSize: 10, marginTop: 2 }}>{shortcut.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Seccion>
    </ScrollView>
  );
};
export default InicioScreen;
