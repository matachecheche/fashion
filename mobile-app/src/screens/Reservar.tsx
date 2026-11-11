import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

export const ReservarScreen: React.FC<{ navParams?: any }> = ({ navParams }) => {
  const { tenantSlug, usuario, online, encolarReserva, mostrarToast } = useApp();
  const nav = useNav();
  const [sucursalId, setSucursalId] = useState(1);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [fecha, setFecha] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [hora, setHora] = useState('11:00');
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);

  const variante = navParams?.variante;
  const productoId = navParams?.productoId;

  useEffect(() => {
    apiFetch('/maestros/sucursales', { tenantSlug })
      .then((rows) => {
        if (Array.isArray(rows) && rows.length) {
          setSucursales(rows);
          setSucursalId(rows[0].id);
        }
      })
      .catch(() => setSucursales([]));
  }, [tenantSlug]);

  if (!usuario) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ textAlign: 'center', color: Colores.texto, marginBottom: 16 }}>
          Inicia sesión para reservar prendas en tienda.
        </Text>
        <Boton titulo="Ir a Ingresar" variante="acento" onPress={() => nav.push('Auth', { volver: 'Producto' })} />
      </View>
    );
  }

  const enviar = async () => {
    if (!variante) {
      mostrarToast('Elige una variante antes de reservar.');
      return;
    }
    setEnviando(true);
    const payload = {
      sucursal_id: sucursalId,
      tipo: 'prueba',
      fecha_cita: `${fecha}T${hora}:00`,
      notas,
      items: [{ variante_id: variante.id, cantidad: 1 }],
    };
    try {
      if (!online) {
        await encolarReserva(payload);
        nav.popToRoot();
        return;
      }
      const res = await apiFetch('/reservas', { method: 'POST', tenantSlug, body: payload });
      mostrarToast(`Reserva ${res?.codigo || ''} creada. Recibirás confirmación en la tienda.`);
      nav.popToRoot();
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (err?.status === undefined || msg.includes('Network request failed')) {
        await encolarReserva(payload);
        nav.popToRoot();
        return;
      }
      mostrarToast(msg || 'No se pudo crear la reserva.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
      <Encabezado
        titulo="📅 Reservar en Sucursal"
        subtitulo="El stock queda retenido temporalmente para tu cita de atención."
      />

      {variante && (
        <Tarjeta>
          <Text style={Estilos.h3}>Prenda seleccionada</Text>
          <Text style={Estilos.texto}>
            SKU {variante.sku} · Talla {variante.talla} · Color {String(variante.color).toUpperCase()}
          </Text>
        </Tarjeta>
      )}

      <Tarjeta>
        <Text style={Estilos.label}>Sucursal</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {(sucursales.length ? sucursales : [{ id: 1, nombre: 'Sucursal Principal' }]).map((s: any) => (
            <TouchableOpacity
              key={s.id}
              onPress={() => setSucursalId(Number(s.id))}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: sucursalId === Number(s.id) ? Colores.tinta : Colores.borde,
                backgroundColor: sucursalId === Number(s.id) ? Colores.tinta : '#fff',
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '700',
                  color: sucursalId === Number(s.id) ? '#fff' : Colores.texto,
                }}
              >
                {s.nombre}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={Estilos.label}>Fecha de cita (AAAA-MM-DD)</Text>
        <TextInput style={Estilos.input} value={fecha} onChangeText={setFecha} keyboardType="numbers-and-punctuation" />
        <View style={{ height: 10 }} />
        <Text style={Estilos.label}>Hora</Text>
        <TextInput style={Estilos.input} value={hora} onChangeText={setHora} placeholder="11:00" />
        <View style={{ height: 10 }} />
        <Text style={Estilos.label}>Notas para la tienda</Text>
        <TextInput
          style={[Estilos.input, { height: 70, textAlignVertical: 'top' }]}
          value={notas}
          onChangeText={setNotas}
          multiline
          placeholder="Ej: Quiero probarla antes de pagar"
          placeholderTextColor="#94a3b8"
        />
        <View style={{ height: 14 }} />
        <Boton
          titulo={enviando ? 'Enviando…' : online ? 'Confirmar reserva' : '📡 Guardar reserva para sincronizar'}
          variante="acento"
          onPress={enviar}
          deshabilitado={enviando}
        />
      </Tarjeta>
    </ScrollView>
  );
};
export default ReservarScreen;
