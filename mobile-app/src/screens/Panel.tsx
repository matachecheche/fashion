import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { API_BASE } from '../config';
import { apiFetch, getAuthToken } from '../api';
import { useApp } from '../context';
import { useNav } from '../navigation';
import { BadgeEstado, Boton, Colores, Encabezado, Estilos, Tarjeta } from '../ui';

type Row = Record<string, unknown>;
type ModuleId =
  | 'dashboard'
  | 'pos'
  | 'ventas'
  | 'reservas'
  | 'inventario'
  | 'productos'
  | 'propuestas'
  | 'reportes'
  | 'suscripcion'
  | 'usuarios'
  | 'ml'
  | 'conflictos';

type PanelModule = {
  id: ModuleId;
  titulo: string;
  icono: string;
  roles: string[];
};

type PosLine = { varianteId: number; nombre: string; sku: string; cantidad: number };
type ReportColumn = { key: string; header: string };
type ReportResult = {
  titulo?: string;
  subtitulo?: string;
  interpretacion_ia?: string;
  modo_ia?: string;
  columnas?: ReportColumn[];
  filas?: Row[];
  kpis?: Array<{ etiqueta: string; valor: string | number }>;
};

const MODULES: PanelModule[] = [
  { id: 'dashboard', titulo: 'Resumen', icono: '📊', roles: ['admin', 'encargado', 'cajero'] },
  { id: 'pos', titulo: 'Punto de venta', icono: '🧾', roles: ['admin', 'encargado', 'cajero'] },
  { id: 'ventas', titulo: 'Ventas', icono: '🛍️', roles: ['admin', 'encargado', 'cajero'] },
  { id: 'reservas', titulo: 'Reservas', icono: '📅', roles: ['admin', 'encargado', 'cajero'] },
  { id: 'inventario', titulo: 'Inventario', icono: '📦', roles: ['admin', 'encargado', 'cajero'] },
  { id: 'productos', titulo: 'Productos', icono: '👗', roles: ['admin', 'encargado'] },
  { id: 'propuestas', titulo: 'Propuestas', icono: '🤝', roles: ['admin', 'encargado', 'proveedor'] },
  { id: 'reportes', titulo: 'Reportes', icono: '📈', roles: ['admin', 'encargado'] },
  { id: 'suscripcion', titulo: 'Suscripción', icono: '💳', roles: ['admin'] },
  { id: 'usuarios', titulo: 'Usuarios', icono: '👥', roles: ['admin'] },
  { id: 'ml', titulo: 'Analítica ML', icono: '🧠', roles: ['admin', 'encargado'] },
  { id: 'conflictos', titulo: 'Sync y conflictos', icono: '🔄', roles: ['admin', 'encargado'] },
];

const isRecord = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Row => (isRecord(value) ? value : {});
const rowsOf = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const textOf = (value: unknown, fallback = '—'): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
};
const numberOf = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const money = (value: unknown): string => `Bs. ${numberOf(value).toFixed(2)}`;
const formatRows = (value: unknown): string => JSON.stringify(value ?? {}, null, 2);

export const PanelScreen: React.FC = () => {
  const { tenantSlug, usuario, online, encolarVenta, mostrarToast } = useApp();
  const nav = useNav();
  const role = textOf(usuario?.rol, '');
  const allowedModules = useMemo(() => MODULES.filter((item) => item.roles.includes(role)), [role]);
  const [module, setModule] = useState<ModuleId | 'menu'>('menu');
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row | null>(null);
  const [extra, setExtra] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [posCart, setPosCart] = useState<PosLine[]>([]);
  const [closeAmount, setCloseAmount] = useState('');
  const [productName, setProductName] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [inventoryStoreId, setInventoryStoreId] = useState('');
  const [inventoryVariantId, setInventoryVariantId] = useState('');
  const [inventoryQuantity, setInventoryQuantity] = useState('');
  const [inventoryReason, setInventoryReason] = useState('');
  const [transferOriginId, setTransferOriginId] = useState('');
  const [transferDestinationId, setTransferDestinationId] = useState('');
  const [transferVariantId, setTransferVariantId] = useState('');
  const [transferQuantity, setTransferQuantity] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState('cajero');
  const [reportText, setReportText] = useState('Ventas confirmadas del mes por sucursal');
  const [report, setReport] = useState<ReportResult | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);

  const loadModule = useCallback(async (selected: ModuleId) => {
    setLoading(true);
    setError(null);
    try {
      let nextRows: Row[] = [];
      let nextSummary: Row | null = null;
      let nextExtra: unknown = null;

      switch (selected) {
        case 'dashboard': {
          nextSummary = record(await apiFetch('/reportes/dashboard', { tenantSlug }));
          nextRows = rowsOf(nextSummary.alertas_stock_bajo);
          break;
        }
        case 'pos': {
          const [products, activeCash] = await Promise.all([
            apiFetch('/catalogo/productos', { tenantSlug }),
            apiFetch('/pos/caja-activa', { tenantSlug }).catch(() => null),
          ]);
          nextRows = rowsOf(products);
          nextSummary = { caja_activa: activeCash };
          break;
        }
        case 'ventas':
          nextRows = rowsOf(await apiFetch('/ventas', { tenantSlug }));
          break;
        case 'reservas':
          nextRows = rowsOf(await apiFetch('/reservas', { tenantSlug }));
          break;
        case 'inventario': {
          const [stock, alerts] = await Promise.all([
            apiFetch('/inventario', { tenantSlug }),
            apiFetch('/inventario/alertas', { tenantSlug }).catch(() => []),
          ]);
          nextRows = rowsOf(stock);
          nextExtra = alerts;
          break;
        }
        case 'productos': {
          const [products, filters] = await Promise.all([
            apiFetch('/catalogo/productos', { tenantSlug }),
            apiFetch('/catalogo/filtros', { tenantSlug }).catch(() => null),
          ]);
          nextRows = rowsOf(products);
          nextExtra = filters;
          const categories = rowsOf(record(filters).categorias);
          if (!categoryId && categories.length) setCategoryId(textOf(categories[0].id, ''));
          break;
        }
        case 'propuestas':
          nextRows = rowsOf(await apiFetch('/propuestas', { tenantSlug }));
          break;
        case 'reportes':
          nextRows = [];
          break;
        case 'suscripcion': {
          const [state, plansResponse] = await Promise.all([
            apiFetch('/suscripcion/estado', { tenantSlug }),
            apiFetch('/suscripcion/planes', { tenantSlug }).catch(() => null),
          ]);
          nextSummary = record(state);
          nextRows = rowsOf(record(plansResponse).planes);
          nextExtra = plansResponse;
          break;
        }
        case 'usuarios':
          nextRows = rowsOf(await apiFetch('/usuarios', { tenantSlug }));
          break;
        case 'ml': {
          const [analysis, models, predictions] = await Promise.all([
            apiFetch('/ia/ml/analisis?seed=42', { tenantSlug }),
            apiFetch('/ia/ml/modelos?limit=20', { tenantSlug }).catch(() => null),
            apiFetch('/ia/ml/predicciones?limit=10', { tenantSlug }).catch(() => null),
          ]);
          nextSummary = record(analysis);
          nextExtra = { modelos: models, predicciones: predictions };
          break;
        }
        case 'conflictos': {
          const [operations, sagas] = await Promise.all([
            apiFetch('/sync/operaciones', { tenantSlug }),
            apiFetch('/pagos/sagas', { tenantSlug }).catch(() => []),
          ]);
          nextRows = rowsOf(operations).filter((row) => {
            const state = textOf(row.estado, '').toLowerCase();
            const resolution = textOf(row.estado_resolucion, '').toUpperCase();
            return (state === 'conflicto' || state === 'rechazada' || state === 'rechazado') &&
              !['RESUELTO', 'DESCARTADO'].includes(resolution);
          });
          nextExtra = sagas;
          break;
        }
      }
      setRows(nextRows);
      setSummary(nextSummary);
      setExtra(nextExtra);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.';
      setError(message);
      setRows([]);
      setSummary(null);
      setExtra(null);
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, categoryId]);

  useEffect(() => {
    if (module !== 'menu') void loadModule(module);
  }, [module, loadModule]);

  const visibleModule = allowedModules.find((item) => item.id === module);
  const openModule = (next: ModuleId) => {
    setError(null);
    setModule(next);
  };
  const reload = () => {
    if (module !== 'menu') void loadModule(module);
  };

  const act = async (path: string, body?: Row, message = 'Cambios guardados.') => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch<Row>(path, {
        method: 'POST',
        tenantSlug,
        ...(body ? { body } : {}),
      });
      mostrarToast(textOf(record(response).mensaje, message));
      if (module !== 'menu') await loadModule(module);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'No se pudo completar la acción.';
      setError(text);
      mostrarToast(text);
    } finally {
      setSaving(false);
    }
  };

  const crearProducto = async () => {
    const name = productName.trim();
    const price = Number(productPrice);
    const category = Number(categoryId);
    if (!name || !Number.isFinite(price) || price < 0 || !Number.isInteger(category) || category < 1) {
      setError('Ingresa nombre, precio válido y categoría existente.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/catalogo/productos', {
        method: 'POST',
        tenantSlug,
        body: { nombre: name, categoria_id: category, precio_base: price, tipo_prenda: 'blusa' },
      });
      setProductName('');
      setProductPrice('');
      mostrarToast('Producto creado.');
      await loadModule('productos');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el producto.');
    } finally {
      setSaving(false);
    }
  };

  const crearUsuario = async () => {
    if (!userName.trim() || !userEmail.includes('@') || userPassword.length < 8) {
      setError('Completa nombre, correo válido y contraseña de al menos 8 caracteres.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/usuarios', {
        method: 'POST',
        tenantSlug,
        body: { nombre: userName.trim(), email: userEmail.trim(), password: userPassword, rol: userRole },
      });
      setUserName('');
      setUserEmail('');
      setUserPassword('');
      mostrarToast('Usuario creado.');
      await loadModule('usuarios');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const registrarMovimiento = async () => {
    const warehouseId = Number(inventoryStoreId);
    const variantId = Number(inventoryVariantId);
    const quantity = Number(inventoryQuantity);
    if (!Number.isInteger(warehouseId) || warehouseId < 1 || !Number.isInteger(variantId) || variantId < 1 || !Number.isFinite(quantity) || quantity === 0) {
      setError('Ingresa almacén, variante y una cantidad distinta de cero.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/inventario/movimientos', {
        method: 'POST', tenantSlug,
        body: { almacen_id: warehouseId, variante_id: variantId, tipo: quantity < 0 ? 'salida' : 'entrada', cantidad: Math.abs(quantity), motivo: inventoryReason.trim() || 'Ajuste desde aplicación móvil' },
      });
      setInventoryQuantity('');
      setInventoryReason('');
      mostrarToast('Movimiento registrado.');
      await loadModule('inventario');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar el movimiento.');
    } finally {
      setSaving(false);
    }
  };

  const transferirInventario = async () => {
    const originId = Number(transferOriginId);
    const destinationId = Number(transferDestinationId);
    const variantId = Number(transferVariantId);
    const quantity = Number(transferQuantity);
    if (!Number.isInteger(originId) || originId < 1 || !Number.isInteger(destinationId) || destinationId < 1 || originId === destinationId || !Number.isInteger(variantId) || variantId < 1 || !Number.isInteger(quantity) || quantity < 1) {
      setError('Ingresa dos almacenes distintos, una variante y una cantidad entera positiva.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch('/inventario/transferencias', {
        method: 'POST', tenantSlug,
        body: { almacen_origen_id: originId, almacen_destino_id: destinationId, variante_id: variantId, cantidad: quantity },
      });
      setTransferQuantity('');
      mostrarToast(`Transferencia ${textOf(record(result).referencia, 'registrada')} aplicada.`);
      await loadModule('inventario');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo transferir el inventario.');
    } finally {
      setSaving(false);
    }
  };

  const addToPos = (product: Row) => {
    const variants = rowsOf(product.variantes);
    const variant = variants.find((item) => Number(item.id) > 0);
    if (!variant) {
      setError(`El producto ${textOf(product.nombre)} no tiene una variante disponible.`);
      return;
    }
    const variantId = numberOf(variant.id);
    setPosCart((current) => {
      const found = current.find((line) => line.varianteId === variantId);
      if (found) return current.map((line) => line.varianteId === variantId ? { ...line, cantidad: line.cantidad + 1 } : line);
      return [...current, { varianteId: variantId, nombre: textOf(product.nombre), sku: textOf(variant.sku), cantidad: 1 }];
    });
  };

  const finishPosSale = async (method: 'efectivo' | 'qr') => {
    if (!posCart.length) {
      setError('Agrega al menos una variante a la venta.');
      return;
    }
    const payload = {
      sucursal_id: numberOf(usuario?.sucursal_id, 1),
      metodo_pago: method,
      origen: 'pos',
      pos: true,
      items: posCart.map((line) => ({ variante_id: line.varianteId, cantidad: line.cantidad })),
    };
    if (!online && method === 'efectivo') {
      try {
        await encolarVenta({ ...payload, creado_en: new Date().toISOString() });
        setPosCart([]);
        return;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo guardar la venta offline.');
        return;
      }
    }
    if (!online) {
      setError('Los cobros QR requieren conexión. Solo se permite efectivo offline.');
      return;
    }
    setSaving(true);
    try {
      const sale = record(await apiFetch('/ventas', { method: 'POST', tenantSlug, body: payload }));
      setPosCart([]);
      mostrarToast('Venta enviada al servidor.');
      if (method === 'qr') {
        const payment = record(sale.pago);
        nav.push('Pago', { pagoId: payment.id, ventaId: sale.id, numero: sale.numero_comprobante, total: sale.total });
      } else {
        await loadModule('pos');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la venta.');
    } finally {
      setSaving(false);
    }
  };

  const createReport = async (query = reportText) => {
    const command = query.trim();
    if (!command) {
      setError('Escribe o dicta una consulta para generar el reporte.');
      return;
    }
    if (!online) {
      setError('La generación del reporte requiere conexión al servidor.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<ReportResult>('/reportes/ia/consultar', {
        method: 'POST', tenantSlug, body: { comando: command },
      });
      setReport(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el reporte.');
    } finally {
      setSaving(false);
    }
  };

  useSpeechRecognitionEvent('start', () => setVoiceActive(true));
  useSpeechRecognitionEvent('end', () => setVoiceActive(false));
  useSpeechRecognitionEvent('error', (event) => {
    setVoiceActive(false);
    if (event.error !== 'aborted') {
      setError(`No se pudo reconocer la voz: ${event.message || event.error}.`);
    }
  });
  useSpeechRecognitionEvent('result', (event) => {
    if (!event.isFinal) return;
    const transcript = event.results.map((result) => result.transcript).join(' ').trim();
    if (!transcript) return;
    setReportText(transcript);
    void createReport(transcript);
  });

  const toggleReportVoice = async () => {
    if (voiceActive) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    if (!online) {
      setError('El dictado del reporte necesita conexión.');
      return;
    }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        throw new Error('El dispositivo no tiene un servicio de reconocimiento de voz disponible.');
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Concede permiso al micrófono/reconocimiento de voz en los ajustes del dispositivo.');
      }
      setError(null);
      ExpoSpeechRecognitionModule.start({
        lang: 'es-BO',
        interimResults: false,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: true,
      });
    } catch (cause) {
      setVoiceActive(false);
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el dictado.');
    }
  };

  const exportReport = async (format: 'pdf' | 'excel' | 'csv') => {
    if (!online) {
      setError('La exportación necesita conexión al servidor.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAuthToken(tenantSlug);
      const query = `comando=${encodeURIComponent(reportText.trim())}&formato=${encodeURIComponent(format)}`;
      const ext = format === 'excel' ? 'xlsx' : format;
      const mime = format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === 'pdf' ? 'application/pdf' : 'text/csv';
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) throw new Error('No está disponible la carpeta temporal para exportar.');
      const destination = `${cacheDir}fashionstore-reporte-${Date.now()}.${ext}`;
      const result = await FileSystem.downloadAsync(`${API_BASE}/reportes/ia/exportar?${query}`, destination, {
        headers: { 'X-Tenant-Slug': tenantSlug, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (result.status < 200 || result.status >= 300) throw new Error(`El servidor respondió HTTP ${result.status} al exportar.`);
      if (!(await Sharing.isAvailableAsync())) throw new Error('La función de compartir no está disponible en este dispositivo.');
      await Sharing.shareAsync(result.uri, { mimeType: mime, dialogTitle: 'Compartir reporte FashionStore' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo exportar el reporte.');
    } finally {
      setSaving(false);
    }
  };

  const updateUserActive = (row: Row) => {
    const id = Number(row.id);
    if (!Number.isInteger(id) || id < 1) return;
    void (async () => {
      setSaving(true);
      try {
        await apiFetch(`/usuarios/${id}`, { method: 'PATCH', tenantSlug, body: { activo: !Boolean(row.activo) } });
        mostrarToast(Boolean(row.activo) ? 'Usuario desactivado.' : 'Usuario activado.');
        await loadModule('usuarios');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el usuario.');
      } finally {
        setSaving(false);
      }
    })();
  };

  const reportRowLabel = (row: Row): string => {
    const name = textOf(row.nombre || row.producto_nombre || row.cliente_nombre || row.sku || row.numero_comprobante || row.codigo || row.id || row.operacion_id, 'Registro');
    const state = textOf(row.estado || row.estado_pago, '');
    const detail = textOf(row.nombre_producto || row.sucursal_nombre || row.email || row.detalle || row.motivo_error, '');
    return [name, detail && detail !== name ? detail : '', state].filter(Boolean).join(' · ');
  };

  const renderRow = ({ item }: { item: Row }) => {
    const id = textOf(item.id || item.operacion_id || item.sku || item.variante_id, 'row');
    const estado = textOf(item.estado || item.estado_pago, '');
    const reservationActions = module === 'reservas' && !['cancelada', 'vencida', 'finalizada'].includes(estado);
    const saleActions = module === 'ventas' && !['reembolsada', 'cancelada'].includes(estado);
    const proposalActions = module === 'propuestas' && textOf(item.estado).toLowerCase() === 'pendiente';

    return (
      <Tarjeta key={id}>
        <Text style={Estilos.h3}>{reportRowLabel(item)}</Text>
        {estado ? <BadgeEstado estado={estado} /> : null}
        {module === 'productos' && (
          <Text style={Estilos.texto}>{money(item.precio_base)} · Stock {textOf(item.stock_disponible, '0')} · {rowsOf(item.variantes).length} variante(s)</Text>
        )}
        {module === 'inventario' && (
          <Text style={Estilos.texto}>Sucursal: {textOf(item.sucursal_nombre)} · Almacén: {textOf(item.almacen_nombre)} · Disponible: {textOf(item.disponible)} · Mínimo: {textOf(item.stock_minimo)}</Text>
        )}
        {module === 'ventas' && (
          <Text style={Estilos.texto}>{money(item.total)} · {textOf(item.sucursal_nombre)} · {textOf(item.fecha || item.creado_en)}</Text>
        )}
        {module === 'reservas' && (
          <Text style={Estilos.texto}>{textOf(item.cliente_email || item.email)} · {textOf(item.sucursal_nombre)} · {textOf(item.fecha_cita)}</Text>
        )}
        {module === 'propuestas' && (
          <Text style={Estilos.texto}>{textOf(item.tipo_prenda)} · {money(item.precio_sugerido)} · {textOf(item.proveedor_nombre)}</Text>
        )}
        {module === 'usuarios' && (
          <Text style={Estilos.texto}>{textOf(item.email)} · {textOf(item.sucursal_nombre)} · {Boolean(item.activo) ? 'Activo' : 'Inactivo'}</Text>
        )}
        {module === 'conflictos' && (
          <Text style={Estilos.texto}>Tipo: {textOf(item.tipo, 'operación')} · Código: {textOf(item.codigo_conflicto, 'no indicado')} · Último error: {textOf(item.motivo_error || item.ultimo_error)}. Reintentar vuelve a validar stock y crea la venta solo si aún hay existencias.</Text>
        )}

        {module === 'pos' && (
          <View style={{ marginTop: 8 }}>
            <Text style={Estilos.texto}>{money(item.precio_base)} · Disponible: {textOf(item.stock_disponible, '0')}</Text>
            <View style={{ height: 8 }} />
            <Boton titulo="Agregar primera variante" variante="outline" onPress={() => addToPos(item)} deshabilitado={saving} />
          </View>
        )}
        {module === 'productos' && role !== 'cajero' && (
          <View style={{ marginTop: 8 }}>
            <Boton titulo="Desactivar producto" variante="peligro" onPress={() => Alert.alert('Desactivar producto', 'El producto dejará de aparecer en el catálogo.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Desactivar', style: 'destructive', onPress: () => void (async () => {
              try { await apiFetch(`/catalogo/productos/${Number(item.id)}`, { method: 'DELETE', tenantSlug }); mostrarToast('Producto desactivado.'); await loadModule('productos'); }
              catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo desactivar.'); }
            })() }])} deshabilitado={saving} />
          </View>
        )}
        {module === 'usuarios' && (
          <View style={{ marginTop: 8 }}>
            <Boton titulo={Boolean(item.activo) ? 'Desactivar usuario' : 'Activar usuario'} variante="outline" onPress={() => updateUserActive(item)} deshabilitado={saving} />
          </View>
        )}
        {saleActions && Number(item.id) > 0 && (
          <View style={{ gap: 8, marginTop: 10 }}>
            {item.estado_pago === 'aprobado' && item.estado !== 'entregada' && (
              <Boton titulo="Marcar entregada" variante="ok" onPress={() => void act(`/ventas/${Number(item.id)}/entregar`, undefined, 'Venta marcada como entregada.')} deshabilitado={saving} />
            )}
            {['pagada', 'entregada'].includes(estado) && (
              <Boton titulo="Registrar devolución" variante="outline" onPress={() => Alert.alert('Registrar devolución', '¿Confirmas registrar la devolución de esta venta?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => void act(`/ventas/${Number(item.id)}/devolucion`, { motivo: 'Devolución registrada desde aplicación móvil' }, 'Devolución registrada.') }])} deshabilitado={saving} />
            )}
          </View>
        )}
        {reservationActions && Number(item.id) > 0 && (
          <View style={{ gap: 8, marginTop: 10 }}>
            {estado === 'pendiente' && <Boton titulo="Preparar" variante="outline" onPress={() => void act(`/reservas/${Number(item.id)}/preparar`, undefined, 'Reserva preparada.')} deshabilitado={saving} />}
            {['pendiente', 'preparada'].includes(estado) && <Boton titulo="Confirmar atención" variante="outline" onPress={() => void act(`/reservas/${Number(item.id)}/confirmar-atencion`, undefined, 'Atención confirmada.')} deshabilitado={saving} />}
            <Boton titulo="Finalizar reserva" variante="ok" onPress={() => void act(`/reservas/${Number(item.id)}/finalizar`, undefined, 'Reserva finalizada.')} deshabilitado={saving} />
            <Boton titulo="Cancelar reserva" variante="peligro" onPress={() => Alert.alert('Cancelar reserva', '¿Confirmas cancelar y liberar el stock reservado?', [{ text: 'Volver', style: 'cancel' }, { text: 'Cancelar reserva', style: 'destructive', onPress: () => void act(`/reservas/${Number(item.id)}/cancelar`, undefined, 'Reserva cancelada y stock liberado.') }])} deshabilitado={saving} />
          </View>
        )}
        {proposalActions && ['admin', 'encargado'].includes(role) && Number(item.id) > 0 && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}><Boton titulo="Aprobar" variante="ok" onPress={() => void act(`/propuestas/${Number(item.id)}/aprobar`, {}, 'Propuesta aprobada y producto creado.')} deshabilitado={saving} /></View>
            <View style={{ flex: 1 }}><Boton titulo="Rechazar" variante="peligro" onPress={() => void act(`/propuestas/${Number(item.id)}/rechazar`, { motivo: 'Rechazada desde aplicación móvil' }, 'Propuesta rechazada.')} deshabilitado={saving} /></View>
          </View>
        )}
        {module === 'conflictos' && (
          <View style={{ gap: 8, marginTop: 8 }}>
            {estado === 'conflicto' && textOf(item.codigo_conflicto).toUpperCase() === 'STOCK_INSUFICIENTE' && (
              <Boton titulo="Reintentar tras reponer stock" variante="acento" onPress={() => void act('/sync/resolver-conflicto', { operacion_id: id, accion: 'reintentar' }, 'Venta sincronizada tras validar stock actual.')} deshabilitado={saving || !online} />
            )}
            {['conflicto', 'rechazada', 'rechazado'].includes(estado.toLowerCase()) && (
              <Boton titulo="Descartar operación" variante="peligro" onPress={() => Alert.alert('Descartar operación', 'La operación local dejará de poder reintentarse con esta clave. ¿Continuar?', [{ text: 'Volver', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: () => void act('/sync/resolver-conflicto', { operacion_id: id, accion: 'descartar', nota_resolucion: 'Descartada por operador desde FashionStore móvil.' }, 'Operación descartada y auditada.') }])} deshabilitado={saving || !online} />
            )}
          </View>
        )}
      </Tarjeta>
    );
  };

  const renderModuleHeader = () => {
    if (!visibleModule) return null;
    const dashboardSales = record(summary?.ventas);
    const dashboardInventory = record(summary?.inventario);
    const dashboardReservations = record(summary?.reservas);
    const subscriptionUsage = record(summary?.cuotas);
    const userUsage = record(subscriptionUsage.usuarios);
    const branchUsage = record(subscriptionUsage.sucursales);
    const productUsage = record(subscriptionUsage.productos);
    const cash = record(summary?.caja_activa);
    const categories = rowsOf(record(extra).categorias);
    const plans = rows;
    const mlModels = rowsOf(record(record(extra).modelos).modelos);
    const mlPredictions = rowsOf(record(record(extra).predicciones).predicciones);
    const paymentSagas = rowsOf(extra).filter((item) => textOf(item.estado).toUpperCase() === 'REQUIERE_INTERVENCION');

    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={Estilos.titulo}>{visibleModule.icono} {visibleModule.titulo}</Text>
            <Text style={Estilos.subtitulo}>/{tenantSlug} · {online ? 'Conectado' : 'Sin conexión'}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={() => setModule('menu')} style={{ padding: 10 }}>
            <Text style={{ color: Colores.acentoOscuro, fontWeight: '800' }}>Módulos</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={reload} disabled={loading} style={{ padding: 10 }}>
            <Text style={{ color: Colores.acentoOscuro, fontWeight: '800' }}>Actualizar</Text>
          </TouchableOpacity>
        </View>

        {error && <Text accessibilityRole="alert" style={{ color: Colores.error, marginBottom: 10 }}>{error}</Text>}
        {loading && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}><ActivityIndicator color={Colores.acento} /><Text style={Estilos.texto}>Cargando datos del servidor…</Text></View>}

        {module === 'conflictos' && paymentSagas.length > 0 && (
          <Tarjeta>
            <Text style={Estilos.h3}>Pagos confirmados que requieren compensación</Text>
            <Text style={Estilos.texto}>El reembolso disponible aquí es una simulación local de sandbox; no devuelve dinero real ni contacta a la pasarela.</Text>
            {paymentSagas.map((saga, index) => (
              <View key={`${textOf(saga.saga_id)}-${index}`} style={{ gap: 8, marginTop: 10 }}>
                <Text style={Estilos.texto}>Ref. {textOf(saga.operacion_id)} · Pago #{textOf(saga.pago_id)} · {textOf(saga.ultimo_error)}</Text>
                <Boton titulo="Registrar reembolso sandbox" variante="peligro" onPress={() => Alert.alert('Reembolso simulado', 'Esto marca la compensación como completada en la demo. No se transfiere dinero real.', [{ text: 'Volver', style: 'cancel' }, { text: 'Registrar simulación', style: 'destructive', onPress: () => void act(`/pagos/${Number(saga.pago_id)}/reembolsar-sandbox`, { motivo: 'Reembolso simulado por administrador desde FashionStore móvil.' }, 'Compensación sandbox registrada; no hubo movimiento de dinero real.') }])} deshabilitado={saving || !online || !Number(saga.pago_id)} />
              </View>
            ))}
          </Tarjeta>
        )}

        {module === 'dashboard' && summary && (
          <Tarjeta>
            <Text style={Estilos.h3}>{textOf(summary.tienda_nombre, 'Tablero de la tienda')}</Text>
            <Text style={Estilos.texto}>Ventas confirmadas: {textOf(dashboardSales.ventas_confirmadas, '0')} · Pendientes: {textOf(dashboardSales.ventas_pendientes_pago, '0')}</Text>
            <Text style={Estilos.texto}>Ingresos: {money(dashboardSales.ingresos_confirmados_bob)} · Ticket promedio: {money(dashboardSales.ticket_promedio_bob)}</Text>
            <Text style={Estilos.texto}>Stock disponible: {textOf(dashboardInventory.unidades_disponibles, '0')} · Reservas activas: {textOf(dashboardReservations.reservas_activas, '0')}</Text>
            <Text style={Estilos.texto}>Alertas de stock bajo: {rows.length}</Text>
          </Tarjeta>
        )}

        {module === 'pos' && (
          <>
            <Tarjeta>
              <Text style={Estilos.h3}>Caja de la sucursal</Text>
              {summary?.caja_activa ? <Text style={Estilos.texto}>Caja #{textOf(cash.id)} abierta · saldo inicial {money(cash.monto_inicial)}</Text> : <Text style={Estilos.texto}>No hay una caja abierta para esta sucursal.</Text>}
              {summary?.caja_activa ? (
                <View style={{ marginTop: 8 }}>
                  <TextInput style={Estilos.input} value={closeAmount} onChangeText={setCloseAmount} keyboardType="decimal-pad" placeholder="Monto declarado al cierre" placeholderTextColor="#94a3b8" />
                  <View style={{ height: 8 }} />
                  <Boton titulo="Cerrar caja" variante="outline" onPress={() => void (async () => {
                    const id = Number(cash.id);
                    if (!id) return;
                    try { await apiFetch(`/pos/${id}/cerrar`, { method: 'POST', tenantSlug, body: closeAmount.trim() ? { monto_cierre_declarado: Number(closeAmount) } : {} }); setCloseAmount(''); mostrarToast('Caja cerrada y arqueo registrado.'); await loadModule('pos'); }
                    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cerrar la caja.'); }
                  })()} deshabilitado={saving} />
                </View>
              ) : (
                <View style={{ marginTop: 8 }}><Boton titulo="Abrir caja" variante="acento" onPress={() => void (async () => {
                  try { await apiFetch('/pos/abrir', { method: 'POST', tenantSlug, body: { sucursal_id: numberOf(usuario?.sucursal_id, 1), monto_inicial: 0 } }); mostrarToast('Caja abierta.'); await loadModule('pos'); }
                  catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir la caja.'); }
                })()} deshabilitado={saving} /></View>
              )}
            </Tarjeta>
            {posCart.length > 0 && (
              <Tarjeta>
                <Text style={Estilos.h3}>Venta actual · {posCart.reduce((sum, line) => sum + line.cantidad, 0)} unidad(es)</Text>
                {posCart.map((line) => <Text key={line.varianteId} style={Estilos.texto}>{line.nombre} · {line.sku} · x{line.cantidad}</Text>)}
                <View style={{ height: 8 }} />
                <View style={{ gap: 8 }}>
                  <Boton titulo={saving ? 'Guardando…' : online ? 'Cobrar en efectivo' : 'Guardar efectivo offline'} variante="ok" onPress={() => void finishPosSale('efectivo')} deshabilitado={saving} />
                  <Boton titulo="Crear orden con QR (requiere conexión)" variante="acento" onPress={() => void finishPosSale('qr')} deshabilitado={saving || !online} />
                  <Boton titulo="Vaciar venta" variante="outline" onPress={() => setPosCart([])} deshabilitado={saving} />
                </View>
              </Tarjeta>
            )}
            {!online && <Text style={{ color: Colores.warn, marginHorizontal: 4, marginBottom: 8 }}>Offline: solo se encolan ventas en efectivo; QR y tarjeta están bloqueados.</Text>}
          </>
        )}

        {module === 'inventario' && (
          <Tarjeta>
            <Text style={Estilos.h3}>Registrar movimiento de stock</Text>
            <Text style={Estilos.texto}>Usa IDs del almacén y de la variante. Una cantidad negativa registra salida.</Text>
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={inventoryStoreId} onChangeText={setInventoryStoreId} keyboardType="number-pad" placeholder="ID de almacén" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={inventoryVariantId} onChangeText={setInventoryVariantId} keyboardType="number-pad" placeholder="ID de variante" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={inventoryQuantity} onChangeText={setInventoryQuantity} keyboardType="numbers-and-punctuation" placeholder="Cantidad (+ entrada / - salida)" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={inventoryReason} onChangeText={setInventoryReason} placeholder="Motivo del movimiento" placeholderTextColor="#94a3b8" />
            <View style={{ height: 8 }} /><Boton titulo="Registrar movimiento" variante="acento" onPress={() => void registrarMovimiento()} deshabilitado={saving || !online} />
            {!online && <Text style={[Estilos.texto, { marginTop: 8, color: Colores.warn }]}>Los ajustes de inventario necesitan conexión.</Text>}
            {rowsOf(extra).length > 0 && <Text style={[Estilos.texto, { marginTop: 8, color: Colores.error }]}>Alertas de bajo stock: {rowsOf(extra).length}</Text>}
          </Tarjeta>
        )}

        {module === 'inventario' && ['admin', 'encargado'].includes(role) && (
          <Tarjeta>
            <Text style={Estilos.h3}>Transferir stock entre almacenes</Text>
            <Text style={Estilos.texto}>En un conflicto offline por falta de stock, transfiere la variante al almacén de la sucursal y luego vuelve a Sync para reintentar.</Text>
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={transferOriginId} onChangeText={setTransferOriginId} keyboardType="number-pad" placeholder="ID de almacén origen" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={transferDestinationId} onChangeText={setTransferDestinationId} keyboardType="number-pad" placeholder="ID de almacén destino" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={transferVariantId} onChangeText={setTransferVariantId} keyboardType="number-pad" placeholder="ID de variante" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={transferQuantity} onChangeText={setTransferQuantity} keyboardType="number-pad" placeholder="Cantidad a transferir" placeholderTextColor="#94a3b8" />
            <View style={{ height: 8 }} /><Boton titulo="Registrar transferencia atómica" variante="outline" onPress={() => void transferirInventario()} deshabilitado={saving || !online} />
          </Tarjeta>
        )}

        {module === 'productos' && (
          <Tarjeta>
            <Text style={Estilos.h3}>Crear producto</Text>
            <Text style={Estilos.texto}>El servidor crea una variante inicial y su stock. La carga de fotos requiere la interfaz web.</Text>
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={productName} onChangeText={setProductName} placeholder="Nombre del producto" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={categoryId} onChangeText={setCategoryId} keyboardType="number-pad" placeholder={categories[0] ? `ID categoría (p. ej. ${textOf(categories[0].id)})` : 'ID de categoría'} placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={productPrice} onChangeText={setProductPrice} keyboardType="decimal-pad" placeholder="Precio base (BOB)" placeholderTextColor="#94a3b8" />
            <View style={{ height: 8 }} /><Boton titulo="Crear producto" variante="acento" onPress={() => void crearProducto()} deshabilitado={saving || !online} />
          </Tarjeta>
        )}

        {module === 'usuarios' && (
          <Tarjeta>
            <Text style={Estilos.h3}>Crear usuario</Text>
            <TextInput style={Estilos.input} value={userName} onChangeText={setUserName} placeholder="Nombre completo" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={userEmail} onChangeText={setUserEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Correo electrónico" placeholderTextColor="#94a3b8" />
            <TextInput style={[Estilos.input, { marginTop: 8 }]} value={userPassword} onChangeText={setUserPassword} secureTextEntry placeholder="Contraseña (mínimo 8 caracteres)" placeholderTextColor="#94a3b8" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 10 }}>
              {['admin', 'encargado', 'cajero', 'proveedor', 'cliente'].map((candidate) => <TouchableOpacity key={candidate} onPress={() => setUserRole(candidate)} style={{ borderRadius: 999, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: userRole === candidate ? Colores.tinta : '#e2e8f0' }}><Text style={{ color: userRole === candidate ? '#fff' : Colores.tinta, fontWeight: '700' }}>{candidate}</Text></TouchableOpacity>)}
            </View>
            <Boton titulo="Crear usuario" variante="acento" onPress={() => void crearUsuario()} deshabilitado={saving || !online} />
          </Tarjeta>
        )}

        {module === 'reportes' && (
          <Tarjeta>
            <Text style={Estilos.h3}>Generar por texto o voz</Text>
            <Text style={Estilos.texto}>El reconocimiento usa el servicio de voz disponible en el dispositivo; el comando transcrito se envía al backend para generar el reporte.</Text>
            <TextInput style={[Estilos.input, { minHeight: 88, textAlignVertical: 'top', marginTop: 8 }]} value={reportText} onChangeText={setReportText} multiline placeholder="Escribe qué información necesitas" placeholderTextColor="#94a3b8" />
            <View style={{ gap: 8, marginTop: 8 }}>
              <Boton titulo={voiceActive ? 'Detener dictado' : '🎙️ Dictar consulta'} variante="outline" onPress={() => void toggleReportVoice()} deshabilitado={saving || !online} />
              <Boton titulo={saving ? 'Generando…' : 'Generar reporte'} variante="acento" onPress={() => void createReport()} deshabilitado={saving || !online} />
            </View>
            {report && <View style={{ marginTop: 10 }}>
              <Text style={Estilos.h3}>{report.titulo || 'Resultado'}</Text>
              <Text style={Estilos.texto}>{report.subtitulo || ''} · Motor: {report.modo_ia || 'no indicado'}</Text>
              <View style={{ gap: 8, marginTop: 8 }}>
                <Boton titulo="Compartir PDF" variante="outline" onPress={() => void exportReport('pdf')} deshabilitado={saving || !online} />
                <Boton titulo="Compartir Excel" variante="outline" onPress={() => void exportReport('excel')} deshabilitado={saving || !online} />
                <Boton titulo="Compartir CSV" variante="outline" onPress={() => void exportReport('csv')} deshabilitado={saving || !online} />
              </View>
              {(report.filas || []).slice(0, 10).map((line, index) => <Text key={index} style={[Estilos.texto, { marginTop: 8 }]}>{(report.columnas || []).map((column) => `${column.header}: ${textOf(line[column.key], '')}`).join(' · ')}</Text>)}
            </View>}
          </Tarjeta>
        )}

        {module === 'suscripcion' && summary && (
          <Tarjeta>
            <Text style={Estilos.h3}>Plan {textOf(summary.plan_nombre, textOf(summary.plan_actual))} · {textOf(summary.estado)}</Text>
            <Text style={Estilos.texto}>Facturación: {textOf(summary.modo_facturacion, 'no disponible')} · Cobro automático: {summary.cobro_real_activo ? 'activo' : 'no activo'}</Text>
            <Text style={Estilos.texto}>Trial: {textOf(summary.dias_restantes, '—')} día(s) restantes</Text>
            <Text style={Estilos.texto}>Usuarios: {textOf(userUsage.usado, '0')}/{textOf(userUsage.maximo, '—')} · Sucursales: {textOf(branchUsage.usado, '0')}/{textOf(branchUsage.maximo, '—')}</Text>
            <Text style={Estilos.texto}>Productos: {textOf(productUsage.usado, '0')}/{productUsage.ilimitado ? 'ilimitado' : textOf(productUsage.maximo, '—')}</Text>
            <Text style={[Estilos.texto, { marginTop: 8, color: Colores.warn }]}>Los cambios inmediatos usan el proveedor de pruebas y no generan un cobro real.</Text>
          </Tarjeta>
        )}
        {module === 'suscripcion' && plans.map((plan) => (
          <Tarjeta key={textOf(plan.codigo)}>
            <Text style={Estilos.h3}>{textOf(plan.nombre, textOf(plan.codigo))}</Text>
            <Text style={Estilos.texto}>{money(plan.precio_mensual_bs)} mensual · hasta {textOf(plan.max_usuarios)} usuarios · {textOf(plan.max_sucursales)} sucursal(es)</Text>
            <Boton titulo="Solicitar/aplicar cambio de plan de prueba" variante="outline" onPress={() => void act('/suscripcion/cambio', { plan_solicitado: textOf(plan.codigo), aplicar_sandbox: true }, 'Solicitud de cambio registrada en modo de pruebas.')} deshabilitado={saving || !online || textOf(plan.codigo) === textOf(summary?.plan_actual)} />
          </Tarjeta>
        ))}

        {module === 'ml' && summary && (
          <Tarjeta>
            <Text style={Estilos.h3}>Modelos persistidos por tienda (demostración)</Text>
            <Text style={Estilos.texto}>Entrenamiento y predicciones se guardan con aislamiento por tenant. Este flujo usa exclusivamente datos sintéticos; no predice sobre clientes/inventario real ni automatiza decisiones comerciales.</Text>
            <View style={{ gap: 8, marginTop: 10 }}>
              <Boton titulo="Entrenar y guardar modelos demo" variante="acento" onPress={() => void act('/ia/ml/entrenar', { seed: 2026 }, 'Se persistieron las versiones de demostración para esta tienda.')} deshabilitado={saving || !online} />
              <Boton titulo="Crear predicción demo persistente" variante="outline" onPress={() => void act('/ia/ml/predecir-demo', { seed: 42 }, 'Predicciones sintéticas guardadas con trazabilidad.')} deshabilitado={saving || !online || mlModels.length < 3} />
            </View>
            <Text style={[Estilos.h3, { marginTop: 12 }]}>Modelos: {mlModels.length}</Text>
            {mlModels.slice(0, 8).map((model, index) => <Text key={`${textOf(model.algoritmo)}-${textOf(model.version)}-${index}`} style={Estilos.texto}>{textOf(model.algoritmo)} · v{textOf(model.version)} · {textOf(model.estado)}</Text>)}
            <Text style={[Estilos.h3, { marginTop: 10 }]}>Predicciones sintéticas recientes: {mlPredictions.length}</Text>
            {mlPredictions.slice(0, 3).map((prediction, index) => <Text key={`${textOf(prediction.id)}-${index}`} style={Estilos.texto}>{textOf(prediction.entidad_tipo)} · {formatRows(prediction.valor_json)}</Text>)}
            <Text selectable style={{ color: Colores.texto, fontSize: 11, marginTop: 10 }}>Métricas del generador reproducible: {formatRows(summary.modelos || summary.supervisado)}</Text>
          </Tarjeta>
        )}

        {module === 'reportes' && <Text style={[Estilos.texto, { marginHorizontal: 4, marginBottom: 8 }]}>El dictado puede depender del idioma, permisos y conectividad del proveedor de reconocimiento instalado en el dispositivo.</Text>}
        {module === 'conflictos' && <Text style={[Estilos.texto, { marginHorizontal: 4, marginBottom: 8 }]}>Admin/encargado pueden descartar una operación o reintentar ventas con conflicto de stock después de reponerlo. Las transferencias se realizan desde Inventario; el reembolso disponible es solo una compensación sandbox sin movimiento de dinero. Un reembolso real requiere un adaptador externo, no incluido.</Text>}
        {module === 'productos' && !online && <Text style={[Estilos.texto, { marginHorizontal: 4, marginBottom: 8, color: Colores.warn }]}>Las altas y bajas requieren conexión.</Text>}
        {module === 'usuarios' && !online && <Text style={[Estilos.texto, { marginHorizontal: 4, marginBottom: 8, color: Colores.warn }]}>La administración de usuarios requiere conexión.</Text>}
      </View>
    );
  };

  if (!usuario) {
    return (
      <View style={{ flex: 1, padding: 20, backgroundColor: Colores.fondo }}>
        <Encabezado titulo="Panel operativo" subtitulo="Inicia sesión con una cuenta del personal de la tienda." />
        <Boton titulo="Iniciar sesión" variante="acento" onPress={() => nav.push('Auth')} />
      </View>
    );
  }
  if (!allowedModules.length) {
    return (
      <View style={{ flex: 1, padding: 20, backgroundColor: Colores.fondo }}>
        <Encabezado titulo="Panel operativo" subtitulo="El rol de esta cuenta no tiene permisos para acceder al panel." />
        <Boton titulo="Volver a la tienda" variante="outline" onPress={nav.pop} />
      </View>
    );
  }

  if (module === 'menu') {
    return (
      <ScrollView style={Estilos.contenedor} contentContainerStyle={Estilos.scroll}>
        <Encabezado titulo="Panel operativo" subtitulo={`${usuario.nombre || usuario.email} · ${role} · /${tenantSlug}`} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: online ? Colores.ok : Colores.error }} />
          <Text style={Estilos.texto}>{online ? 'Conectado al servidor' : 'Sin conexión al servidor'}</Text>
        </View>
        {allowedModules.map((item) => (
          <TouchableOpacity key={item.id} accessibilityRole="button" onPress={() => openModule(item.id)} style={{ backgroundColor: '#fff', borderColor: Colores.borde, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: Colores.tinta }}>{item.icono} {item.titulo}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ marginTop: 8 }}><Boton titulo="Registrar otra tienda" variante="outline" onPress={() => nav.push('Onboarding')} /></View>
      </ScrollView>
    );
  }

  return (
    <FlatList
      style={Estilos.contenedor}
      contentContainerStyle={{ padding: 16, paddingBottom: 36 }}
      data={rows}
      keyExtractor={(item, index) => `${module}-${textOf(item.id || item.operacion_id || item.sku || item.variante_id, String(index))}`}
      renderItem={renderRow}
      ListHeaderComponent={renderModuleHeader}
      ListEmptyComponent={!loading && !error ? <Tarjeta><Text style={Estilos.texto}>{module === 'ventas' ? 'Todavía no hay ventas registradas.' : module === 'reservas' ? 'No hay reservas para mostrar.' : module === 'inventario' ? 'No hay existencias para mostrar.' : module === 'productos' ? 'No hay productos disponibles.' : module === 'propuestas' ? 'No hay propuestas para mostrar.' : module === 'usuarios' ? 'No hay usuarios para mostrar.' : module === 'conflictos' ? 'No hay operaciones fallidas que requieran revisión.' : module === 'dashboard' ? 'No hay alertas de stock bajo.' : module === 'pos' ? 'No hay productos para vender.' : module === 'suscripcion' ? 'No hay planes disponibles.' : 'Escribe una consulta para generar un reporte.'}</Text></Tarjeta> : null}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} colors={[Colores.acento]} />}
    />
  );
};

export default PanelScreen;
