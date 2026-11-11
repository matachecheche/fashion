import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const NotificacionesScreen: React.FC = () => {
  const { tenantSlug, usuario, online, mostrarToast } = useApp();
  const nav = useNav();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    if (!usuario) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const rows = await apiFetch('/notificaciones', { tenantSlug });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (error: any) {
      mostrarToast(error?.message || 'No se pudieron cargar las notificaciones.');
    } finally { setLoading(false); }
  }, [tenantSlug, usuario, mostrarToast]);

  useEffect(() => { void cargar(); }, [cargar]);

  const noLeidas = items.filter((item) => !item.leida).length;
  const marcarUna = async (id: number) => {
    if (!online) { mostrarToast('Conéctate para actualizar notificaciones.'); return; }
    try {
      await apiFetch(`/notificaciones/${id}/leer`, { method: 'PATCH', tenantSlug });
      setItems((prev) => prev.map((item) => item.id === id ? { ...item, leida: true } : item));
    } catch (error: any) { mostrarToast(error?.message || 'No se pudo actualizar la notificación.'); }
  };
  const marcarTodas = async () => {
    if (!online || noLeidas === 0) return;
    setSaving(true);
    try {
      await apiFetch('/notificaciones/leer-todas', { method: 'PATCH', tenantSlug });
      setItems((prev) => prev.map((item) => ({ ...item, leida: true })));
      mostrarToast('Todas las notificaciones están marcadas como leídas.');
    } catch (error: any) { mostrarToast(error?.message || 'No se pudieron actualizar.'); }
    finally { setSaving(false); }
  };

  if (!usuario) {
    return <View style={{ flex: 1, justifyContent: 'center', padding: 22, backgroundColor: Colores.fondo }}><Encabezado titulo="Notificaciones" subtitulo="Inicia sesión para consultar tus avisos." /><Boton titulo="Iniciar sesión" variante="acento" onPress={() => nav.push('Auth')} /></View>;
  }

  return (
    <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={cargar} tintColor={Colores.acento} />}>
      <Encabezado titulo="Notificaciones" subtitulo={`${noLeidas} sin leer · Avisos de tu tienda y de tu cuenta.`} />
      {noLeidas > 0 && <Boton titulo={saving ? 'Actualizando…' : 'Marcar todas como leídas'} variante="outline" deshabilitado={saving || !online} onPress={() => void marcarTodas()} estilo={{ marginBottom: 14 }} />}
      {loading && items.length === 0 ? <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator size="large" color={Colores.acento} /></View> : null}
      {!loading && items.length === 0 ? <Tarjeta style={{ alignItems: 'center', paddingVertical: 28 }}><Text style={{ fontSize: 30, marginBottom: 10 }}>♧</Text><Text style={Estilos.h3}>Todo al día</Text><Text style={[Estilos.texto, { textAlign: 'center' }]}>No tienes notificaciones recientes.</Text></Tarjeta> : null}
      {items.map((item) => (
        <Tarjeta key={item.id} style={{ marginBottom: 10, borderColor: item.leida ? Colores.borde : '#E3C7B3', backgroundColor: item.leida ? '#FFFFFF' : '#FFFCF8' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: Colores.tinta, flex: 1 }}>{item.titulo || 'Aviso de FashionStore'}</Text>
            <BadgeEstado estado={item.leida ? 'leida' : 'pendiente'} />
          </View>
          <Text style={[Estilos.texto, { marginTop: 8 }]}>{item.mensaje}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 8 }}>
            <Text style={Estilos.subtitulo}>{item.creado_en ? new Date(item.creado_en).toLocaleString() : ''}</Text>
            {!item.leida && <Boton titulo="Marcar leída" variante="outline" onPress={() => void marcarUna(Number(item.id))} estilo={{ minHeight: 38, paddingVertical: 7, paddingHorizontal: 12 }} />}
          </View>
        </Tarjeta>
      ))}
    </ScrollView>
  );
};

export default NotificacionesScreen;
