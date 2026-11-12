import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

type MaestroTab = 'sucursales' | 'promociones' | 'categorias';
const TIPOS = ['blusa', 'camiseta', 'cartera', 'chaqueta', 'falda', 'pantalon', 'vestido', 'zapato'];

export const MaestrosScreen: React.FC = () => {
  const { tenantSlug, usuario, online, mostrarToast } = useApp();
  const nav = useNav();
  const [tab, setTab] = useState<MaestroTab>('sucursales');
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [promociones, setPromociones] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formSuc, setFormSuc] = useState({ nombre: '', direccion: '', ciudad: 'Santa Cruz de la Sierra', telefono: '' });
  const [formPromo, setFormPromo] = useState({ codigo: '', nombre: '', tipo_descuento: 'porcentaje', valor: '10', minimo_compra: '200' });
  const [formCat, setFormCat] = useState({ nombre: '', tipo_prenda: 'vestido' });

  const canManagePromos = ['admin', 'encargado'].includes(String(usuario?.rol));
  const isAdmin = usuario?.rol === 'admin';

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    const [branches, promos, cats] = await Promise.allSettled([
      apiFetch('/maestros/sucursales', { tenantSlug }),
      apiFetch('/maestros/promociones', { tenantSlug }),
      apiFetch('/maestros/categorias', { tenantSlug }),
    ]);
    if (branches.status === 'fulfilled') setSucursales(Array.isArray(branches.value) ? branches.value : []);
    if (promos.status === 'fulfilled') setPromociones(Array.isArray(promos.value) ? promos.value : []);
    if (cats.status === 'fulfilled') setCategorias(Array.isArray(cats.value) ? cats.value : []);
    if ([branches, promos, cats].every((result) => result.status === 'rejected')) {
      setError('No fue posible cargar los datos maestros. Comprueba tu conexión y permisos.');
    }
    setLoading(false);
  }, [tenantSlug]);

  useEffect(() => { void cargar(); }, [cargar]);

  const crear = async (path: string, body: Record<string, unknown>, success: string, reset: () => void) => {
    if (!online) {
      mostrarToast('Conéctate a internet para guardar cambios maestros.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch(path, { method: 'POST', tenantSlug, body });
      reset();
      mostrarToast(success);
      await cargar();
    } catch (cause: any) {
      const message = cause?.message || 'No se pudo guardar el registro.';
      setError(message);
      mostrarToast(message);
    } finally {
      setSaving(false);
    }
  };

  if (!usuario || !['admin', 'encargado'].includes(String(usuario.rol))) {
    return (
      <View style={{ flex: 1, padding: 20, justifyContent: 'center', backgroundColor: Colores.fondo }}>
        <Encabezado titulo="Maestros comerciales" subtitulo="Este módulo requiere permisos de administración o encargado." />
        <Boton titulo="Volver al panel" onPress={nav.pop} variante="outline" />
      </View>
    );
  }

  const tabs: Array<{ id: MaestroTab; title: string; icon: string; count: number }> = [
    { id: 'sucursales', title: 'Sucursales', icon: '⌂', count: sucursales.length },
    { id: 'promociones', title: 'Promociones', icon: '%', count: promociones.length },
    { id: 'categorias', title: 'Categorías', icon: '▦', count: categorias.length },
  ];

  return (
    <ScrollView
      style={Estilos.contenedor}
      contentContainerStyle={Estilos.scroll}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={cargar} tintColor={Colores.acento} />}
    >
      <Encabezado titulo="Maestros comerciales" subtitulo={`Sucursales, promociones y categorías · /${tenantSlug}`} />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => setTab(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{ flex: 1, minHeight: 66, padding: 9, borderRadius: 14, backgroundColor: active ? Colores.oscuro : '#FFFFFF', borderWidth: 1, borderColor: active ? Colores.oscuro : Colores.borde, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: active ? '#FFFFFF' : Colores.acento, fontSize: 17, fontWeight: '900' }}>{item.icon}</Text>
              <Text numberOfLines={1} style={{ color: active ? '#FFFFFF' : Colores.texto, fontSize: 10, fontWeight: '800', marginTop: 3 }}>{item.title}</Text>
              <Text style={{ color: active ? '#D6DEDC' : Colores.suave, fontSize: 9 }}>{item.count} registros</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? <Text accessibilityRole="alert" style={{ color: Colores.error, marginBottom: 12 }}>{error}</Text> : null}
      {loading && sucursales.length + promociones.length + categorias.length === 0 ? (
        <View style={{ padding: 32, alignItems: 'center' }}><ActivityIndicator color={Colores.acento} size="large" /></View>
      ) : null}

      {tab === 'sucursales' && (
        <>
          <Text style={[Estilos.label, { marginBottom: 10 }]}>SUCURSALES REGISTRADAS</Text>
          {sucursales.length ? sucursales.map((branch) => (
            <Tarjeta key={branch.id} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: Colores.tinta, fontWeight: '900', fontSize: 15, flex: 1 }}>{branch.nombre}</Text>
                <Text style={{ color: Colores.acentoOscuro, fontWeight: '800', fontSize: 11 }}>{branch.codigo || `#${branch.id}`}</Text>
              </View>
              <Text style={[Estilos.texto, { marginTop: 5 }]}>{branch.ciudad || 'Ciudad no indicada'} · {branch.direccion || 'Sin dirección'}</Text>
              <Text style={Estilos.subtitulo}>{branch.telefono || 'Sin teléfono'}{branch.horario ? ` · ${branch.horario}` : ''}</Text>
            </Tarjeta>
          )) : <Tarjeta><Text style={Estilos.texto}>No hay sucursales para mostrar.</Text></Tarjeta>}
          {isAdmin && (
            <Tarjeta>
              <Text style={Estilos.h3}>Crear sucursal</Text>
              <Text style={Estilos.label}>Nombre *</Text>
              <TextInput style={Estilos.input} value={formSuc.nombre} onChangeText={(v) => setFormSuc((s) => ({ ...s, nombre: v }))} placeholder="Sucursal Centro" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Dirección *</Text>
              <TextInput style={Estilos.input} value={formSuc.direccion} onChangeText={(v) => setFormSuc((s) => ({ ...s, direccion: v }))} placeholder="Av. principal #123" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Ciudad</Text>
              <TextInput style={Estilos.input} value={formSuc.ciudad} onChangeText={(v) => setFormSuc((s) => ({ ...s, ciudad: v }))} placeholder="Santa Cruz de la Sierra" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Teléfono</Text>
              <TextInput style={Estilos.input} value={formSuc.telefono} onChangeText={(v) => setFormSuc((s) => ({ ...s, telefono: v }))} keyboardType="phone-pad" placeholder="70000000" placeholderTextColor="#92999E" />
              <Boton titulo={saving ? 'Guardando…' : 'Guardar sucursal'} variante="acento" deshabilitado={saving || !formSuc.nombre.trim() || !formSuc.direccion.trim()} onPress={() => void crear('/maestros/sucursales', formSuc, 'Sucursal creada.', () => setFormSuc({ nombre: '', direccion: '', ciudad: 'Santa Cruz de la Sierra', telefono: '' }))} estilo={{ marginTop: 14 }} />
            </Tarjeta>
          )}
        </>
      )}

      {tab === 'promociones' && (
        <>
          <Text style={[Estilos.label, { marginBottom: 10 }]}>PROMOCIONES DE LA TIENDA</Text>
          {promociones.length ? promociones.map((promo) => (
            <Tarjeta key={promo.id} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: Colores.tinta, fontWeight: '900', fontSize: 15 }}>{promo.nombre}</Text>
                  <Text style={Estilos.subtitulo}>Código: {promo.codigo}</Text>
                </View>
                <Text style={{ color: promo.activa ? Colores.ok : Colores.suave, fontWeight: '900', fontSize: 12 }}>{promo.activa ? 'ACTIVA' : 'PAUSADA'}</Text>
              </View>
              <Text style={{ color: Colores.acentoOscuro, fontWeight: '900', fontSize: 17, marginTop: 10 }}>
                {promo.tipo_descuento === 'porcentaje' ? `${promo.valor}% de descuento` : `Bs. ${Number(promo.valor || 0).toFixed(2)} de descuento`}
              </Text>
              <Text style={Estilos.subtitulo}>Compra mínima: Bs. {Number(promo.minimo_compra || 0).toFixed(2)}</Text>
            </Tarjeta>
          )) : <Tarjeta><Text style={Estilos.texto}>No hay promociones registradas.</Text></Tarjeta>}
          {canManagePromos && (
            <Tarjeta>
              <Text style={Estilos.h3}>Crear promoción</Text>
              <Text style={Estilos.label}>Código</Text>
              <TextInput style={Estilos.input} value={formPromo.codigo} onChangeText={(v) => setFormPromo((s) => ({ ...s, codigo: v.toUpperCase() }))} autoCapitalize="characters" placeholder="MODA10" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Nombre</Text>
              <TextInput style={Estilos.input} value={formPromo.nombre} onChangeText={(v) => setFormPromo((s) => ({ ...s, nombre: v }))} placeholder="Descuento de temporada" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Tipo de descuento</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([{ id: 'porcentaje', label: 'Porcentaje' }, { id: 'monto_fijo', label: 'Monto fijo' }] as const).map((option) => (
                  <TouchableOpacity key={option.id} onPress={() => setFormPromo((s) => ({ ...s, tipo_descuento: option.id }))} style={{ flex: 1, padding: 11, borderRadius: 12, backgroundColor: formPromo.tipo_descuento === option.id ? Colores.acentoSuave : '#FFFFFF', borderWidth: 1, borderColor: formPromo.tipo_descuento === option.id ? Colores.acento : Colores.borde }}>
                    <Text style={{ textAlign: 'center', fontWeight: '800', color: Colores.texto, fontSize: 12 }}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[Estilos.label, { marginTop: 10 }]}>Valor</Text>
              <TextInput style={Estilos.input} value={formPromo.valor} onChangeText={(v) => setFormPromo((s) => ({ ...s, valor: v }))} keyboardType="decimal-pad" placeholder="10" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Compra mínima (Bs.)</Text>
              <TextInput style={Estilos.input} value={formPromo.minimo_compra} onChangeText={(v) => setFormPromo((s) => ({ ...s, minimo_compra: v }))} keyboardType="decimal-pad" placeholder="200" placeholderTextColor="#92999E" />
              <Boton titulo={saving ? 'Guardando…' : 'Guardar promoción'} variante="acento" deshabilitado={saving || !formPromo.codigo.trim() || !formPromo.nombre.trim() || !Number.isFinite(Number(formPromo.valor)) || Number(formPromo.valor) <= 0} onPress={() => void crear('/maestros/promociones', { ...formPromo, valor: Number(formPromo.valor), minimo_compra: Number(formPromo.minimo_compra || 0) }, 'Promoción creada.', () => setFormPromo({ codigo: '', nombre: '', tipo_descuento: 'porcentaje', valor: '10', minimo_compra: '200' }))} estilo={{ marginTop: 14 }} />
            </Tarjeta>
          )}
        </>
      )}

      {tab === 'categorias' && (
        <>
          <Text style={[Estilos.label, { marginBottom: 10 }]}>CATEGORÍAS DISPONIBLES</Text>
          {categorias.length ? categorias.map((category) => (
            <Tarjeta key={category.id} style={{ paddingVertical: 13, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: Colores.tinta, fontWeight: '800', fontSize: 14, flex: 1 }}>{category.nombre}</Text>
                <Text style={{ color: Colores.suave, fontSize: 11 }}>{category.slug}</Text>
              </View>
              <Text style={Estilos.subtitulo}>{String(category.tipo_prenda || '').toUpperCase()}</Text>
            </Tarjeta>
          )) : <Tarjeta><Text style={Estilos.texto}>No hay categorías registradas.</Text></Tarjeta>}
          {isAdmin && (
            <Tarjeta>
              <Text style={Estilos.h3}>Crear categoría</Text>
              <Text style={Estilos.label}>Nombre</Text>
              <TextInput style={Estilos.input} value={formCat.nombre} onChangeText={(v) => setFormCat((s) => ({ ...s, nombre: v }))} placeholder="Colección de verano" placeholderTextColor="#92999E" />
              <Text style={[Estilos.label, { marginTop: 10 }]}>Tipo de prenda</Text>
              <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 5 }}>
                {TIPOS.map((type) => {
                  const active = formCat.tipo_prenda === type;
                  return <TouchableOpacity key={type} onPress={() => setFormCat((s) => ({ ...s, tipo_prenda: type }))} style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? Colores.oscuro : Colores.superficie }}><Text style={{ color: active ? '#FFFFFF' : Colores.texto, fontSize: 11, fontWeight: '800' }}>{type.toUpperCase()}</Text></TouchableOpacity>;
                })}
              </ScrollView>
              <Boton titulo={saving ? 'Guardando…' : 'Guardar categoría'} variante="acento" deshabilitado={saving || !formCat.nombre.trim()} onPress={() => void crear('/maestros/categorias', formCat, 'Categoría creada.', () => setFormCat({ nombre: '', tipo_prenda: 'vestido' }))} estilo={{ marginTop: 12 }} />
            </Tarjeta>
          )}
        </>
      )}
      {!online && <Text style={[Estilos.subtitulo, { marginTop: 4 }]}>Modo sin conexión: puedes consultar los datos cargados; para guardar cambios necesitas internet.</Text>}
    </ScrollView>
  );
};

export default MaestrosScreen;
