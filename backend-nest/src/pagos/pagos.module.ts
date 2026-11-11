import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PoolClient } from 'pg';
import Stripe from 'stripe';
import { Db, getPool } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { VentaStockHelper } from '../common/venta-stock';
import { Notificador } from '../common/notificador';
import { generarCodigo } from '../common/util';
import QRCode from 'qrcode';

type EstadoPagoWebhook = 'aprobado' | 'rechazado';

function esFalloDeStock(error: any): boolean {
  return String(error?.message || '').includes('STOCK_INSUFICIENTE') ||
    (typeof error?.getStatus === 'function' && error.getStatus() === 409);
}

function stripeTestCredentialsPresent(): boolean {
  const apiKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  const testKey = (apiKey.startsWith('rk_test_') || apiKey.startsWith('sk_test_')) &&
    !/REPLACE|CHANGE_ME/i.test(apiKey);
  const testWebhook = webhookSecret.startsWith('whsec_') &&
    webhookSecret.length >= 24 && !/REPLACE|CHANGE_ME/i.test(webhookSecret);
  return testKey && testWebhook && String(process.env.PAGOS_MODO || 'sandbox').toLowerCase() === 'sandbox';
}

function getStripeTestClient(): Stripe {
  const apiKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!(apiKey.startsWith('rk_test_') || apiKey.startsWith('sk_test_')) || /REPLACE|CHANGE_ME/i.test(apiKey)) {
    throw new ServiceUnavailableException('STRIPE_TEST_KEY_REQUIRED: configura una clave rk_test_ o sk_test_ en el servidor.');
  }
  if (String(process.env.PAGOS_MODO || 'sandbox').toLowerCase() !== 'sandbox') {
    throw new ServiceUnavailableException('STRIPE_TEST_MODE_ONLY: este despliegue solo acepta claves y pagos de prueba.');
  }
  return new Stripe(apiKey);
}

function stripeReturnBaseUrl(): string {
  const configured = String(process.env.PUBLIC_API_URL || '').trim();
  if (!configured) throw new Error('PUBLIC_API_URL_REQUIRED');
  const url = new URL(configured);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('PUBLIC_API_URL_INVALID');
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && url.protocol !== 'https:') {
    throw new Error('PUBLIC_API_URL_HTTPS_REQUIRED');
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  const apiPath = basePath.endsWith('/api') ? basePath : `${basePath}/api`;
  return `${url.origin}${apiPath}/pagos/stripe/retorno`;
}

function stripeCheckoutConfigured(): boolean {
  if (!stripeTestCredentialsPresent()) return false;
  try {
    stripeReturnBaseUrl();
    return true;
  } catch {
    return false;
  }
}

function parsePayloadProveedor(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return typeof value === 'object' ? value as Record<string, any> : {};
}

async function avisarAdministradoresPago(
  client: PoolClient,
  tenantId: string,
  ventaId: number,
  referencia: string,
  motivo: string,
) {
  const admins = await client.query(
    `SELECT id FROM public.usuarios WHERE tenant_id = $1 AND rol = 'admin' AND activo = TRUE`,
    [tenantId],
  );
  for (const admin of admins.rows) {
    await Notificador.enviar(client, {
      tenantId,
      usuarioId: Number(admin.id),
      titulo: `Acción requerida: pago sin venta ${referencia}`,
      mensaje: `El proveedor confirmó el pago, pero la venta no pudo confirmarse por inventario/estado. Se requiere reembolso o resolución manual. Detalle: ${motivo}`,
      tipo: 'pago_critico',
      referenciaUrl: `/panel/ventas?venta_id=${ventaId}`,
    });
  }
}

/** Aplica una resolución del proveedor dentro de la misma transacción que registra el webhook. */
async function procesarResolucionPagoEnTx(
  client: PoolClient,
  tenantId: string,
  pagoId: number,
  nuevoEstado: EstadoPagoWebhook,
  actorId: number | null,
  webhookId?: string,
  motivoRechazo?: string,
) {
  const pRes = await client.query(
    'SELECT * FROM public.pagos WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
    [tenantId, pagoId],
  );
  if (pRes.rowCount === 0) throw new NotFoundException('Pago no encontrado en esta tienda.');
  const pago = pRes.rows[0];
  const estadoActual = String(pago.estado);

  if (nuevoEstado === 'aprobado' && ['aprobado', 'aprobado_sin_venta', 'reembolso_pendiente', 'reembolsado'].includes(estadoActual)) {
    return { ...pago, idempotent_replay: true };
  }
  if (nuevoEstado === 'rechazado' && ['rechazado', 'expirado'].includes(estadoActual)) {
    return { ...pago, idempotent_replay: true };
  }
  if (['aprobado_sin_venta', 'reembolso_pendiente', 'reembolsado'].includes(estadoActual)) {
    throw new ConflictException('PAYMENT_ALREADY_APPROVED: no se puede reemplazar una confirmación del proveedor por un rechazo.');
  }
  if (estadoActual === 'aprobado' && nuevoEstado === 'rechazado') {
    throw new BadRequestException('No se puede rechazar un pago que ya fue confirmado.');
  }

  const vRes = await client.query(
    'SELECT * FROM public.ventas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
    [tenantId, Number(pago.venta_id)],
  );
  if (vRes.rowCount === 0) throw new NotFoundException('Venta asociada al pago no encontrada.');
  const venta = vRes.rows[0];
  const itemsRes = await client.query(
    'SELECT variante_id, cantidad FROM public.venta_items WHERE tenant_id = $1 AND venta_id = $2 ORDER BY variante_id',
    [tenantId, venta.id],
  );

  if (nuevoEstado === 'aprobado') {
    let falloConfirmacion: string | null = null;
    let falloStock = false;
    const expiraEnMs = pago.expira_en ? new Date(pago.expira_en).getTime() : Number.NaN;
    if (['rechazado', 'expirado'].includes(estadoActual)) {
      falloConfirmacion = `El proveedor informó una aprobación tardía para un intento ${estadoActual}; no se confirma la venta y requiere conciliación/reembolso.`;
    } else if (
      ['pendiente', 'no_confirmado'].includes(estadoActual) &&
      Number.isFinite(expiraEnMs) && expiraEnMs <= Date.now()
    ) {
      falloConfirmacion = 'El proveedor confirmó el pago después de la expiración del intento; no se confirma la venta y requiere conciliación/reembolso.';
    }
    const otroIntento = await client.query(
      `SELECT id, estado FROM public.pagos
        WHERE tenant_id = $1 AND venta_id = $2 AND id <> $3
          AND estado IN ('pendiente', 'no_confirmado', 'aprobado', 'aprobado_sin_venta', 'reembolso_pendiente')
        ORDER BY creado_en DESC, id DESC LIMIT 1 FOR UPDATE`,
      [tenantId, venta.id, pago.id],
    );
    if (!falloConfirmacion && otroIntento.rowCount > 0) {
      falloConfirmacion = `Existe otro intento de pago activo o confirmado (#${otroIntento.rows[0].id}); se evita confirmar o cobrar dos veces.`;
    } else if (!falloConfirmacion && ['cancelada', 'fallida_stock', 'reembolsada'].includes(String(venta.estado))) {
      falloConfirmacion = `La venta estaba en estado ${venta.estado} cuando llegó la aprobación del proveedor.`;
    } else if (!falloConfirmacion) {
      await client.query('SAVEPOINT pago_confirmacion_stock');
      try {
        await VentaStockHelper.confirmarPagoRetenido(
          client,
          tenantId,
          Number(venta.almacen_id),
          actorId,
          venta.numero_comprobante,
          itemsRes.rows,
        );
        await client.query('RELEASE SAVEPOINT pago_confirmacion_stock');
      } catch (error: any) {
        await client.query('ROLLBACK TO SAVEPOINT pago_confirmacion_stock');
        await client.query('RELEASE SAVEPOINT pago_confirmacion_stock');
        if (!esFalloDeStock(error)) throw error;
        falloStock = true;
        falloConfirmacion = String(error?.message || 'STOCK_INSUFICIENTE');
      }
    }

    if (falloConfirmacion) {
      const operationId = String(pago.referencia_externa);
      const otroPagoConfirmado = otroIntento.rows.some((row: any) => String(row.estado) === 'aprobado');
      const otroPagoPendiente = otroIntento.rows.some((row: any) => ['pendiente', 'no_confirmado'].includes(String(row.estado)));
      const ventaEstadoFinal = otroPagoConfirmado
        ? 'pagada'
        : otroPagoPendiente
          ? String(venta.estado)
          : falloStock
            ? 'fallida_stock'
            : ['cancelada', 'fallida_stock', 'reembolsada'].includes(String(venta.estado))
              ? String(venta.estado)
              : 'cancelada';
      const ventaPagoFinal = otroPagoConfirmado
        ? 'aprobado'
        : otroPagoPendiente
          ? String(venta.estado_pago)
          : 'aprobado_sin_venta';
      await client.query(
        `UPDATE public.ventas
            SET estado = $3, estado_pago = $4, actualizado_en = NOW()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, venta.id, ventaEstadoFinal, ventaPagoFinal],
      );
      const updPago = await client.query(
        `UPDATE public.pagos
            SET estado = 'aprobado_sin_venta', confirmado_proveedor = TRUE,
                webhook_id = COALESCE($3, webhook_id), motivo_rechazo = $4,
                payload_proveedor = COALESCE(payload_proveedor, '{}'::jsonb) ||
                  jsonb_build_object('reembolso_idempotency_key', 'refund-' || $2::text,
                                     'requiere_intervencion', TRUE),
                confirmado_en = NOW()
          WHERE tenant_id = $1 AND id = $5
          RETURNING *`,
        [tenantId, operationId, webhookId || null, falloConfirmacion, pago.id],
      );
      await client.query(
        `INSERT INTO public.saga_pago
           (tenant_id, operacion_id, venta_id, pago_id, estado, paso_actual, intentos, ultimo_error, datos_json)
         VALUES ($1, $2::text, $3, $4, 'REQUIERE_INTERVENCION', 'C2', 1, $5,
                 jsonb_build_object('compensacion', 'reembolso_requerido', 'idempotency_key', 'refund-' || $2::text))
         ON CONFLICT (tenant_id, operacion_id) DO UPDATE SET
           estado = 'REQUIERE_INTERVENCION', paso_actual = 'C2', intentos = saga_pago.intentos + 1,
           ultimo_error = EXCLUDED.ultimo_error, datos_json = saga_pago.datos_json || EXCLUDED.datos_json,
           actualizado_en = NOW()`,
        [tenantId, operationId, venta.id, pago.id, falloConfirmacion],
      );
      await avisarAdministradoresPago(client, tenantId, Number(venta.id), operationId, falloConfirmacion);
      return updPago.rows[0];
    }

    await client.query(
      `UPDATE public.ventas SET estado = 'pagada', estado_pago = 'aprobado', actualizado_en = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, venta.id],
    );
    if (venta.caja_id) {
      await client.query(
        `UPDATE public.cajas SET monto_ventas_digital = monto_ventas_digital + $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, Number(venta.caja_id), Number(pago.monto)],
      );
    }
    if (venta.usuario_id) {
      await Notificador.enviar(client, {
        tenantId,
        usuarioId: Number(venta.usuario_id),
        titulo: `Pago confirmado (${venta.numero_comprobante})`,
        mensaje: `El proveedor sandbox confirmó tu pago por Bs. ${pago.monto}. Pedido listo para entrega.`,
        tipo: 'pago',
        referenciaUrl: '/mis-pedidos',
      });
    }
    const updPago = await client.query(
      `UPDATE public.pagos
          SET estado = 'aprobado', confirmado_proveedor = TRUE,
              webhook_id = COALESCE($3, webhook_id), motivo_rechazo = NULL, confirmado_en = NOW()
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, pago.id, webhookId || null],
    );
    await client.query(
      `UPDATE public.saga_pago SET estado = 'VENTA_CONFIRMADA', paso_actual = 'T4',
              intentos = intentos + 1, ultimo_error = NULL, actualizado_en = NOW()
        WHERE tenant_id = $1 AND operacion_id = $2`,
      [tenantId, String(pago.referencia_externa)],
    );
    return updPago.rows[0];
  }

  if (estadoActual === 'aprobado') {
    throw new BadRequestException('No se puede rechazar un pago que ya fue confirmado.');
  }
  if (estadoActual === 'pendiente' || estadoActual === 'no_confirmado') {
    await VentaStockHelper.liberarRetencion(
      client,
      tenantId,
      Number(venta.almacen_id),
      actorId,
      venta.numero_comprobante,
      itemsRes.rows,
    );
  }
  await client.query(
    `UPDATE public.ventas SET estado = 'pendiente_pago', estado_pago = 'rechazado', actualizado_en = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, venta.id],
  );
  const updPago = await client.query(
    `UPDATE public.pagos SET estado = 'rechazado', confirmado_proveedor = FALSE,
            webhook_id = COALESCE($3, webhook_id), motivo_rechazo = $4
      WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, pago.id, webhookId || null, motivoRechazo || null],
  );
  await client.query(
    `UPDATE public.saga_pago SET estado = 'COMPENSADA', paso_actual = 'C1',
            intentos = intentos + 1, ultimo_error = $3, actualizado_en = NOW()
      WHERE tenant_id = $1 AND operacion_id = $2`,
    [tenantId, String(pago.referencia_externa), motivoRechazo || null],
  );
  return updPago.rows[0];
}

@Controller('pagos')
export class PagosController {
  @Get('config')
  obtenerConfigPagos() {
    const tenant = TenantContext.require();
    const stripeCheckoutHabilitado = stripeCheckoutConfigured();
    return {
      tenant_slug: tenant.tenantSlug,
      modo: 'sandbox',
      cobro_real_habilitado: false,
      stripe_checkout_habilitado: stripeCheckoutHabilitado,
      stripe_checkout_modo: stripeCheckoutHabilitado ? 'test' : 'no_configurado',
      pasarelas_disponibles: [
        {
          codigo: 'stripe_sandbox',
          nombre: stripeCheckoutHabilitado ? 'Tarjeta de prueba (Stripe Checkout)' : 'Tarjeta (Stripe Sandbox simulado)',
          requiere_confirmacion_proveedor: true,
          checkout_test_habilitado: stripeCheckoutHabilitado,
        },
        { codigo: 'libelula_sandbox', nombre: 'QR Simple Bolivia (Libelula Sandbox)', requiere_confirmacion_proveedor: true },
        { codigo: 'efectivo_pos', nombre: 'Efectivo en Caja POS Presencial', requiere_confirmacion_proveedor: false },
      ],
      advertencia: stripeCheckoutHabilitado
        ? 'Stripe Checkout está conectado en modo de prueba. Las tarjetas de prueba no generan cargos reales; el servidor confirma el pedido únicamente al verificar el webhook firmado de Stripe.'
        : 'Los pagos digitales están en sandbox. Stripe Checkout de prueba aún no está configurado; la aprobación disponible en pantalla es solo simulación y no valida una tarjeta.',
    };
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Get('sagas')
  async listarSagas() {
    const tenant = TenantContext.require();
    return Db.query(
      `SELECT saga_id, operacion_id, venta_id, pago_id, estado, paso_actual, intentos,
              ultimo_error, creado_en, actualizado_en
         FROM public.saga_pago
        WHERE tenant_id = $1
        ORDER BY actualizado_en DESC
        LIMIT 100`,
      [tenant.tenantId],
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @HttpCode(HttpStatus.OK)
  @Post('conciliar')
  async conciliarTenantActual() {
    const tenant = TenantContext.require();
    return conciliarPagosTenant(tenant.tenantId);
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @HttpCode(HttpStatus.OK)
  @Post(':id/reembolsar-sandbox')
  async reembolsarPagoSinVentaSandbox(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    if (String(process.env.PAGOS_MODO || 'sandbox').toLowerCase() !== 'sandbox') {
      throw new ForbiddenException('SANDBOX_REFUND_DISABLED: no hay adaptador de reembolso real habilitado para este proveedor.');
    }
    const tenant = TenantContext.require();
    const pagoId = Number(id);
    if (!Number.isInteger(pagoId) || pagoId < 1) throw new BadRequestException('Identificador de pago invalido.');
    const motivo = String(body?.motivo || 'Reembolso sandbox por pago confirmado sin venta').trim().slice(0, 500);

    return Db.tx(async (client) => {
      const rows = await client.query(
        `SELECT pg.*, v.estado AS venta_estado, v.estado_pago AS venta_estado_pago,
                v.total AS venta_total, v.numero_comprobante
           FROM public.pagos pg
           JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
          WHERE pg.tenant_id = $1 AND pg.id = $2
          FOR UPDATE OF pg, v`,
        [tenant.tenantId, pagoId],
      );
      if (!rows.rowCount) throw new NotFoundException('Pago no encontrado en esta tienda.');
      const pago = rows.rows[0];
      const refundKey = `refund-${String(pago.referencia_externa)}`;
      const payloadActual = typeof pago.payload_proveedor === 'string'
        ? JSON.parse(pago.payload_proveedor)
        : pago.payload_proveedor || {};
      if (String(pago.estado) === 'reembolsado') {
        if (String(payloadActual.refund_idempotency_key || '') === refundKey) {
          return {
            pago: { id: Number(pago.id), venta_id: Number(pago.venta_id), referencia_externa: pago.referencia_externa, estado: 'reembolsado' },
            idempotent_replay: true,
            modo: 'sandbox_simulado',
            cobro_real: false,
          };
        }
        throw new ConflictException('PAYMENT_ALREADY_REFUNDED: el pago ya fue reembolsado con otra operación.');
      }
      if (!['stripe_sandbox', 'libelula_sandbox'].includes(String(pago.pasarela))) {
        throw new BadRequestException('SANDBOX_REFUND_PROVIDER_UNSUPPORTED: solo se simulan reembolsos de pasarelas digitales sandbox.');
      }
      if (!['aprobado_sin_venta', 'reembolso_pendiente'].includes(String(pago.estado)) || !pago.confirmado_proveedor) {
        throw new ConflictException('PAYMENT_REFUND_NOT_ELIGIBLE: se requiere un pago confirmado que no haya podido cerrar una venta.');
      }
      if (Math.round(Number(pago.monto) * 100) !== Math.round(Number(pago.venta_total) * 100)) {
        throw new ConflictException('PAYMENT_REFUND_AMOUNT_MISMATCH: el monto confirmado no coincide con el total de la venta.');
      }

      const updated = await client.query(
        `UPDATE public.pagos
            SET estado = 'reembolsado',
                payload_proveedor = COALESCE(payload_proveedor, '{}'::jsonb) ||
                  jsonb_build_object('refund_mode', 'sandbox_simulated',
                                     'refund_status', 'simulated_succeeded',
                                     'refund_idempotency_key', $3::text,
                                     'refund_reason', $4::text,
                                     'refund_recorded_at', NOW()),
                confirmado_en = COALESCE(confirmado_en, NOW())
          WHERE tenant_id = $1 AND id = $2
          RETURNING id, venta_id, referencia_externa, monto, moneda, estado, pasarela`,
        [tenant.tenantId, pagoId, refundKey, motivo],
      );
      const otroPagoConfirmado = await client.query(
        `SELECT id FROM public.pagos
          WHERE tenant_id = $1 AND venta_id = $2 AND id <> $3
            AND estado = 'aprobado' AND confirmado_proveedor = TRUE
          LIMIT 1`,
        [tenant.tenantId, Number(pago.venta_id), pagoId],
      );
      if (!otroPagoConfirmado.rowCount) {
        await client.query(
          `UPDATE public.ventas SET estado_pago = 'reembolsado', actualizado_en = NOW()
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, Number(pago.venta_id)],
        );
      }
      await client.query(
        `UPDATE public.saga_pago
            SET estado = 'COMPENSADA', paso_actual = 'C3', intentos = intentos + 1,
                ultimo_error = NULL,
                datos_json = COALESCE(datos_json, '{}'::jsonb) ||
                  jsonb_build_object('compensacion', 'reembolso_sandbox_simulado',
                                     'refund_idempotency_key', $3::text,
                                     'refund_recorded_at', NOW()),
                actualizado_en = NOW()
          WHERE tenant_id = $1 AND operacion_id = $2`,
        [tenant.tenantId, String(pago.referencia_externa), refundKey],
      );
      return {
        pago: updated.rows[0],
        idempotent_replay: false,
        modo: 'sandbox_simulado',
        cobro_real: false,
        otro_pago_confirmado_mantiene_venta: Boolean(otroPagoConfirmado.rowCount),
      };
    }, { requireWrite: true });
  }

  @UseGuards(JwtTenantGuard)
  @Get('ref/:ref')
  async buscarPorReferencia(@Param('ref') ref: string, @Req() req: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      SELECT pg.*, v.usuario_id, v.numero_comprobante, v.estado AS venta_estado, v.total AS venta_total
        FROM public.pagos pg
        JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
       WHERE pg.tenant_id = $1 AND pg.referencia_externa = $2
       LIMIT 1
      `,
      [tenant.tenantId, ref.trim()],
    );
    if (rows.length === 0) throw new NotFoundException('Pago no encontrado en esta tienda.');
    if (req.user?.rol === 'cliente' && Number(rows[0].usuario_id) !== Number(req.user.sub)) {
      throw new NotFoundException('Pago no encontrado.');
    }
    return this._presentarPago(rows[0], tenant.tenantSlug);
  }

  @UseGuards(JwtTenantGuard)
  @Get(':id')
  async obtenerPago(@Param('id') id: string, @Req() req: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      SELECT pg.*, v.usuario_id, v.numero_comprobante, v.estado AS venta_estado, v.total AS venta_total
        FROM public.pagos pg
        JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
       WHERE pg.tenant_id = $1 AND pg.id = $2
       LIMIT 1
      `,
      [tenant.tenantId, Number(id)],
    );
    if (rows.length === 0) throw new NotFoundException('Pago no encontrado en esta tienda.');
    if (req.user?.rol === 'cliente' && Number(rows[0].usuario_id) !== Number(req.user.sub)) {
      throw new NotFoundException('Pago no encontrado.');
    }
    return this._presentarPago(rows[0], tenant.tenantSlug);
  }

  @UseGuards(JwtTenantGuard)
  @Post(':id/stripe/checkout')
  async crearStripeCheckout(@Param('id') id: string, @Req() req: any) {
    if (!stripeCheckoutConfigured()) {
      throw new ServiceUnavailableException(
        'STRIPE_CHECKOUT_NOT_CONFIGURED: se requieren una clave Stripe de prueba, el secreto whsec_ del webhook y PUBLIC_API_URL HTTPS en Azure.',
      );
    }
    const pagoId = Number(id);
    if (!Number.isSafeInteger(pagoId) || pagoId < 1) throw new BadRequestException('Identificador de pago inválido.');
    const tenant = TenantContext.require();
    const stripe = getStripeTestClient();

    const datos = await Db.tx(async (client) => {
      const rows = await client.query(
        `SELECT pg.*, v.usuario_id, v.numero_comprobante, v.total AS venta_total
           FROM public.pagos pg
           JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
          WHERE pg.tenant_id = $1 AND pg.id = $2
          FOR UPDATE OF pg, v`,
        [tenant.tenantId, pagoId],
      );
      if (!rows.rowCount) throw new NotFoundException('Pago no encontrado en esta tienda.');
      const pago = rows.rows[0];
      if (req.user?.rol === 'cliente' && Number(pago.usuario_id) !== Number(req.user.sub)) {
        throw new NotFoundException('Pago no encontrado.');
      }
      if (String(pago.pasarela) !== 'stripe_sandbox' || String(pago.modo) !== 'sandbox') {
        throw new BadRequestException('STRIPE_CHECKOUT_PROVIDER_MISMATCH: este pago no corresponde a Stripe en modo test.');
      }
      if (!['no_confirmado', 'pendiente'].includes(String(pago.estado))) {
        throw new ConflictException('PAYMENT_NOT_PENDING: el pago ya fue resuelto y no admite otro Checkout.');
      }
      if (pago.expira_en && new Date(pago.expira_en).getTime() <= Date.now()) {
        throw new ConflictException('PAYMENT_EXPIRED: el intento venció; espera la conciliación de Stripe y crea un nuevo intento.');
      }
      const amountMinor = Math.round(Number(pago.monto) * 100);
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
        throw new BadRequestException('STRIPE_AMOUNT_INVALID: el monto debe ser mayor a cero y expresarse en centavos.');
      }

      const payload = parsePayloadProveedor(pago.payload_proveedor);
      let expiresAt = Number(payload.stripe_checkout_expires_at || 0);
      if (payload.stripe_checkout_session_id) {
        return {
          pago,
          amountMinor,
          existingSessionId: String(payload.stripe_checkout_session_id),
          expiresAt,
          metadata: null,
        };
      }
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
        expiresAt = Math.floor(Date.now() / 1000) + 35 * 60;
        const expiresAtDate = new Date(expiresAt * 1000);
        await client.query(
          `UPDATE public.pagos
              SET expira_en = $3::timestamptz,
                  payload_proveedor = COALESCE(payload_proveedor, '{}'::jsonb) ||
                    jsonb_build_object('stripe_checkout_expires_at', $4::bigint)
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, pagoId, expiresAtDate, expiresAt],
        );
      }
      const metadata = {
        fashionstore_payment_id: String(pago.id),
        tenant_id: tenant.tenantId,
        tenant_slug: tenant.tenantSlug,
        reference: String(pago.referencia_externa),
      };
      return { pago, amountMinor, existingSessionId: null, expiresAt, metadata };
    }, { requireWrite: true });

    if (datos.existingSessionId) {
      let existing: Stripe.Checkout.Session;
      try {
        existing = await stripe.checkout.sessions.retrieve(datos.existingSessionId);
      } catch {
        throw new ServiceUnavailableException('STRIPE_CHECKOUT_LOOKUP_FAILED: no se pudo consultar el intento de prueba existente.');
      }
      if (existing.status === 'open' && existing.url) {
        return {
          proveedor: 'stripe_checkout',
          modo: 'test',
          checkout_url: existing.url,
          session_id: existing.id,
          expires_at: existing.expires_at ? new Date(existing.expires_at * 1000).toISOString() : null,
          reutilizado: true,
        };
      }
      if (existing.status === 'complete') {
        return {
          proveedor: 'stripe_checkout',
          modo: 'test',
          checkout_url: null,
          session_id: existing.id,
          estado_checkout: 'complete',
          pago_pendiente_de_webhook: true,
          reutilizado: true,
        };
      }
      throw new ConflictException('STRIPE_CHECKOUT_EXPIRED: el Checkout venció; espera la conciliación del proveedor y reintenta el pedido.');
    }

    const returnBase = stripeReturnBaseUrl();
    const comprobante = String(datos.pago.numero_comprobante || `#${datos.pago.venta_id}`).slice(0, 120);
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          locale: 'es',
          allowed_payment_method_types: ['card'], 
          client_reference_id: String(datos.pago.id),
          metadata: datos.metadata,
          payment_intent_data: { metadata: datos.metadata },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: String(datos.pago.moneda || 'BOB').toLowerCase(),
                unit_amount: datos.amountMinor,
                product_data: {
                  name: `FashionStore — pedido ${comprobante}`,
                  description: 'Demostración de pago en modo de prueba. No se realiza un cargo real.',
                },
              },
            },
          ],
          success_url: `${returnBase}?resultado=exito&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${returnBase}?resultado=cancelado`,
          expires_at: datos.expiresAt,
        },
        { idempotencyKey: `fashionstore-${tenant.tenantId}-${pagoId}-checkout-v1` },
      );
    } catch {
      throw new ServiceUnavailableException(
        'STRIPE_CHECKOUT_CREATE_FAILED: verifica Checkout Sessions: Write, el modo test y la moneda BOB habilitada para tu cuenta Stripe.',
      );
    }
    if (!session.id || !session.url) {
      throw new ServiceUnavailableException('STRIPE_CHECKOUT_URL_MISSING: Stripe no devolvió una URL de Checkout alojado.');
    }

    await Db.tx(async (client) => {
      const locked = await client.query(
        `SELECT estado, pasarela, payload_proveedor
           FROM public.pagos
          WHERE tenant_id = $1 AND id = $2
          FOR UPDATE`,
        [tenant.tenantId, pagoId],
      );
      if (!locked.rowCount) throw new NotFoundException('Pago no encontrado en esta tienda.');
      if (!['no_confirmado', 'pendiente'].includes(String(locked.rows[0].estado)) ||
          String(locked.rows[0].pasarela) !== 'stripe_sandbox') {
        throw new ConflictException('PAYMENT_STATE_CHANGED: el pago cambió mientras se iniciaba Stripe Checkout.');
      }
      const payload = parsePayloadProveedor(locked.rows[0].payload_proveedor);
      if (payload.stripe_checkout_session_id && String(payload.stripe_checkout_session_id) !== session.id) {
        throw new ConflictException('STRIPE_CHECKOUT_SESSION_CONFLICT: ya existe otra sesión para este intento.');
      }
      await client.query(
        `UPDATE public.pagos
            SET expira_en = to_timestamp($4::bigint),
                payload_proveedor = COALESCE(payload_proveedor, '{}'::jsonb) ||
                  jsonb_build_object('stripe_checkout_session_id', $3::text,
                                     'stripe_checkout_expires_at', $4::bigint)
          WHERE tenant_id = $1 AND id = $2`,
        [tenant.tenantId, pagoId, session.id, datos.expiresAt],
      );
    }, { requireWrite: true });

    return {
      proveedor: 'stripe_checkout',
      modo: 'test',
      checkout_url: session.url,
      session_id: session.id,
      expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      reutilizado: false,
    };
  }

  @Get('stripe/retorno')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, max-age=0')
  paginaRetornoStripe(@Query('resultado') resultado: string) {
    const exito = String(resultado || '').toLowerCase() === 'exito';
    const titulo = exito ? 'Checkout completado' : 'Checkout cancelado';
    const mensaje = exito
      ? 'Stripe recibió el intento de prueba. Vuelve a FashionStore; el pedido solo aparecerá pagado cuando el servidor verifique el webhook firmado.'
      : 'No se confirmó ningún pago. Puedes volver a FashionStore para revisar o reintentar el pedido.';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${titulo} · FashionStore</title><style>body{margin:0;background:#f8fafc;color:#172033;font:16px system-ui,-apple-system,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:480px;margin:24px;padding:28px;border:1px solid #e2e8f0;border-radius:18px;background:white;box-shadow:0 12px 36px #0f172a12}h1{font-size:1.5rem;margin:0 0 12px}p{line-height:1.6;color:#475569}.badge{display:inline-block;background:#fffbeb;color:#92400e;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:700;margin-bottom:14px}a{display:inline-block;margin-top:12px;background:#1e293b;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700}</style></head><body><main class="card"><span class="badge">STRIPE TEST · SIN CARGO REAL</span><h1>${titulo}</h1><p>${mensaje}</p><a href="fashionstore://">Volver a FashionStore</a></main></body></html>`;
  }

  @UseGuards(JwtTenantGuard)
  @Post(':id/aprobar-sandbox')
  async aprobarPagoSandbox(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this._simularWebhookSandbox(Number(id), 'aprobado', req, body);
  }

  @UseGuards(JwtTenantGuard)
  @Post(':id/rechazar-sandbox')
  async rechazarPagoSandbox(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    return this._simularWebhookSandbox(Number(id), 'rechazado', req, body);
  }

  @UseGuards(JwtTenantGuard)
  @HttpCode(HttpStatus.OK)
  @Post('sandbox/simular-webhook')
  async simularWebhookSandbox(@Req() req: any, @Body() body: any) {
    const pagoId = Number(body?.pago_id);
    const estado = String(body?.estado || '').toLowerCase();
    if (!pagoId || !['aprobado', 'rechazado'].includes(estado)) {
      throw new BadRequestException('Indique pago_id y estado aprobado/rechazado para simular el webhook.');
    }
    return this._simularWebhookSandbox(pagoId, estado as 'aprobado' | 'rechazado', req, body);
  }

  @UseGuards(JwtTenantGuard)
  @Post('venta/:ventaId/reintentar')
  async reintentarPagoVenta(@Param('ventaId') ventaId: string, @Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const nuevoPago = await Db.tx(
      async (client) => {
        const vRes = await client.query(
          'SELECT * FROM public.ventas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, Number(ventaId)],
        );
        if (vRes.rowCount === 0) throw new NotFoundException('Venta no encontrada.');
        const venta = vRes.rows[0];
        if (req.user?.rol === 'cliente' && Number(venta.usuario_id) !== Number(req.user.sub)) {
          throw new NotFoundException('Venta no encontrada.');
        }
        if (['aprobado', 'aprobado_sin_venta', 'reembolso_pendiente', 'reembolsado'].includes(String(venta.estado_pago))) {
          throw new BadRequestException('Esta venta ya tiene un pago confirmado o requiere intervención; no se puede crear otro intento.');
        }
        const intentoActivo = await client.query(
          `SELECT * FROM public.pagos
            WHERE tenant_id = $1 AND venta_id = $2
              AND estado IN ('pendiente', 'no_confirmado') AND expira_en > NOW()
            ORDER BY creado_en DESC, id DESC LIMIT 1 FOR UPDATE`,
          [tenant.tenantId, venta.id],
        );
        if (intentoActivo.rowCount > 0) return intentoActivo.rows[0];
        const intentoVencido = await client.query(
          `SELECT id FROM public.pagos
            WHERE tenant_id = $1 AND venta_id = $2
              AND estado IN ('pendiente', 'no_confirmado') AND expira_en <= NOW()
            ORDER BY expira_en ASC, id ASC LIMIT 1 FOR UPDATE`,
          [tenant.tenantId, venta.id],
        );
        if (intentoVencido.rowCount > 0) {
          throw new ConflictException('PAYMENT_RECONCILIATION_REQUIRED: el intento anterior venció y debe conciliarse antes de reintentar.');
        }

        const itemsRes = await client.query(
          'SELECT variante_id, cantidad FROM public.venta_items WHERE tenant_id = $1 AND venta_id = $2',
          [tenant.tenantId, venta.id],
        );

        // Un rechazo o expiración libera la reserva; al reintentar se retiene de forma atómica.
        if (['rechazado', 'expirado'].includes(String(venta.estado_pago))) {
          await VentaStockHelper.retenerPorPagoPendiente(
            client,
            tenant.tenantId,
            Number(venta.almacen_id),
            Number(req.user.sub),
            venta.numero_comprobante,
            itemsRes.rows,
          );
        }

        const metodo = String(body?.metodo_pago || venta.metodo_pago || 'tarjeta').toLowerCase();
        const pasarela = metodo === 'qr' ? 'libelula_sandbox' : 'stripe_sandbox';
        const ref = generarCodigo('PAY');

        await client.query(
          `UPDATE public.ventas SET estado = 'pendiente_pago', estado_pago = 'no_confirmado', metodo_pago = $3, actualizado_en = NOW() WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, venta.id, metodo],
        );

        const pIns = await client.query(
          `
          INSERT INTO public.pagos
            (tenant_id, venta_id, referencia_externa, pasarela, metodo, monto, moneda, modo, estado, confirmado_proveedor)
          VALUES ($1, $2, $3, $4, $5, $6, 'BOB', 'sandbox', 'no_confirmado', FALSE)
          RETURNING *
          `,
          [tenant.tenantId, venta.id, ref, pasarela, metodo, Number(venta.total)],
        );
        await client.query(
          `INSERT INTO public.saga_pago
             (tenant_id, operacion_id, venta_id, pago_id, estado, paso_actual)
           VALUES ($1, $2, $3, $4, 'PAGO_PENDIENTE', 'T2')`,
          [tenant.tenantId, ref, venta.id, pIns.rows[0].id],
        );
        return pIns.rows[0];
      },
      { requireWrite: true },
    );
    return this._presentarPago(nuevoPago, tenant.tenantSlug);
  }

  @HttpCode(HttpStatus.OK)
  @Post('webhooks/stripe')
  async webhookStripeSandbox(@Req() req: any, @Body() body: any) {
    return this._recibirWebhookFirmado('stripe_sandbox', body, req);
  }

  @HttpCode(HttpStatus.OK)
  @Post('webhooks/stripe-checkout')
  async webhookStripeCheckout(@Req() req: any) {
    if (!stripeTestCredentialsPresent()) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_NOT_CONFIGURED: Stripe Checkout test no está habilitado en este servidor.');
    }
    const rawBody = req?.rawBody;
    const signature = req?.headers?.['stripe-signature'];
    if (!Buffer.isBuffer(rawBody) || !signature) {
      throw new UnauthorizedException('STRIPE_WEBHOOK_SIGNATURE_INVALID: falta el cuerpo original o la firma de Stripe.');
    }

    let event: Stripe.Event;
    try {
      event = getStripeTestClient().webhooks.constructEvent(
        rawBody,
        String(signature),
        String(process.env.STRIPE_WEBHOOK_SECRET || ''),
      );
    } catch {
      throw new UnauthorizedException('STRIPE_WEBHOOK_SIGNATURE_INVALID: no se pudo validar la firma de Stripe.');
    }

    const estadosCheckout: Record<string, 'aprobado' | 'rechazado' | null> = {
      'checkout.session.completed': 'aprobado',
      'checkout.session.async_payment_succeeded': 'aprobado',
      'checkout.session.async_payment_failed': 'rechazado',
      'checkout.session.expired': 'rechazado',
    };
    if (!(event.type in estadosCheckout)) return { recibido: true, ignorado: true };

    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata || {};
    // El mismo endpoint puede recibir eventos de otros Checkout del mismo sandbox.
    if (!metadata.fashionstore_payment_id) return { recibido: true, ignorado: true };
    const pagoId = Number(metadata.fashionstore_payment_id);
    const tenantId = String(metadata.tenant_id || '').trim();
    const tenantSlug = String(metadata.tenant_slug || '').trim().toLowerCase();
    const reference = String(metadata.reference || '').trim();
    if (!Number.isSafeInteger(pagoId) || pagoId < 1 || !tenantId || !tenantSlug || !reference || !session.id) {
      throw new BadRequestException('STRIPE_WEBHOOK_METADATA_INVALID: faltan los metadatos de conciliación del pedido.');
    }
    const amountMinor = Number(session.amount_total);
    const currency = String(session.currency || '').toUpperCase();
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || !currency) {
      throw new BadRequestException('STRIPE_WEBHOOK_AMOUNT_INVALID: Stripe no devolvió un monto o moneda verificable.');
    }
    const nuevoEstado = estadosCheckout[event.type];
    if (nuevoEstado === 'aprobado' && session.payment_status !== 'paid') {
      return { recibido: true, ignorado: true, motivo: 'pago_aun_no_pagado' };
    }

    const tenant = await Db.resolveTenantById(tenantId);
    if (!tenant || tenant.tenantSlug !== tenantSlug) {
      throw new UnprocessableEntityException('STRIPE_WEBHOOK_TENANT_INVALID: el tenant del evento no existe o no coincide.');
    }

    return TenantContext.run(tenant, async () => Db.tx(async (client) => {
      const rows = await client.query(
        `SELECT pg.*, v.numero_comprobante
           FROM public.pagos pg
           JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
          WHERE pg.tenant_id = $1 AND pg.id = $2
          FOR UPDATE OF pg, v`,
        [tenant.tenantId, pagoId],
      );
      if (!rows.rowCount) throw new NotFoundException('STRIPE_WEBHOOK_PAYMENT_NOT_FOUND: no existe el pago indicado.');
      const pago = rows.rows[0];
      const payload = parsePayloadProveedor(pago.payload_proveedor);
      if (String(pago.pasarela) !== 'stripe_sandbox' || String(pago.modo) !== 'sandbox' ||
          String(payload.stripe_checkout_session_id || '') !== session.id ||
          String(pago.referencia_externa) !== reference ||
          String(session.client_reference_id || '') !== String(pago.id)) {
        throw new UnprocessableEntityException('STRIPE_WEBHOOK_PAYMENT_MISMATCH: la sesión no corresponde al pago registrado.');
      }
      if (Math.round(Number(pago.monto) * 100) !== amountMinor || String(pago.moneda).toUpperCase() !== currency) {
        throw new UnprocessableEntityException('STRIPE_WEBHOOK_AMOUNT_MISMATCH: el monto o la moneda no coincide con el pedido.');
      }

      const safePayload = JSON.stringify({
        event_type: event.type,
        session_id: session.id,
        payment_id: pagoId,
        tenant_slug: tenant.tenantSlug,
        payment_status: session.payment_status,
        checkout_status: session.status,
        amount_total: amountMinor,
        currency,
      });
      const inserted = await client.query(
        `INSERT INTO public.webhooks_recibidos
           (tenant_id, provider, event_id, referencia, monto, firma_valida, procesado, payload_json)
         VALUES ($1, 'stripe_checkout_test', $2, $3, $4, TRUE, FALSE, $5::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [tenant.tenantId, event.id, reference, Number(pago.monto), safePayload],
      );
      if (!inserted.rowCount) {
        const prior = await client.query(
          `SELECT provider, referencia, firma_valida, procesado, payload_json
             FROM public.webhooks_recibidos
            WHERE event_id = $1
            FOR UPDATE`,
          [event.id],
        );
        if (!prior.rowCount || prior.rows[0].provider !== 'stripe_checkout_test' ||
            prior.rows[0].referencia !== reference || !prior.rows[0].firma_valida) {
          throw new ConflictException('STRIPE_WEBHOOK_EVENT_CONFLICT: el identificador de evento ya se usó con otros datos.');
        }
        if (prior.rows[0].procesado) {
          return { recibido: true, duplicado: true, event_id: event.id, estado: 'procesado' };
        }
      }

      // Si Stripe entrega tarde un evento de expiración después de confirmar el pago, no se degrada la venta.
      if (!(String(pago.estado) === 'aprobado' && nuevoEstado === 'rechazado')) {
        await procesarResolucionPagoEnTx(
          client,
          tenant.tenantId,
          pagoId,
          nuevoEstado,
          null,
          event.id,
          nuevoEstado === 'rechazado' ? `Stripe Checkout ${event.type}` : undefined,
        );
      }
      await client.query(
        `UPDATE public.webhooks_recibidos
            SET procesado = TRUE, procesado_en = NOW()
          WHERE tenant_id = $1 AND event_id = $2`,
        [tenant.tenantId, event.id],
      );
      return { recibido: true, event_id: event.id, pago_id: pagoId, estado: nuevoEstado };
    }, { requireWrite: true }));
  }

  @HttpCode(HttpStatus.OK)
  @Post('webhooks/libelula')
  async webhookLibelulaQrSandbox(@Req() req: any, @Body() body: any) {
    return this._recibirWebhookFirmado('libelula_sandbox', body, req);
  }

  private async _presentarPago(pago: any, tenantSlug: string) {
    const normalizado = { ...pago, monto: Number(pago.monto) };
    const estaPendiente = ['no_confirmado', 'pendiente'].includes(String(pago.estado));
    const venceMs = pago.expira_en ? new Date(pago.expira_en).getTime() : Number.NaN;
    const qrExpirado = estaPendiente && Number.isFinite(venceMs) && venceMs <= Date.now();
    if (pago.pasarela !== 'libelula_sandbox' || !estaPendiente || qrExpirado) {
      return qrExpirado && pago.pasarela === 'libelula_sandbox'
        ? { ...normalizado, qr_expirado: true, qr_es_sandbox: true,
            qr_aviso: 'Este QR de prueba venció. La conciliación automática está finalizando la orden; no intentes pagarlo.' }
        : normalizado;
    }
    const qrPayload = JSON.stringify({
      formato: 'fashionstore-qr-sandbox-v1',
      tienda: tenantSlug,
      referencia: String(pago.referencia_externa),
      monto: Number(pago.monto).toFixed(2),
      moneda: String(pago.moneda || 'BOB'),
      vence_en: pago.expira_en ? new Date(pago.expira_en).toISOString() : null,
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 256,
    });
    return {
      ...normalizado,
      qr_payload: qrPayload,
      qr_data_url: qrDataUrl,
      qr_es_sandbox: true,
      qr_aviso: 'Este QR solo contiene la referencia de prueba de FashionStore; no se puede cobrar desde una app bancaria.',
    };
  }

  private _secretoWebhook(provider: 'stripe_sandbox' | 'libelula_sandbox'): string {
    const secret = provider === 'stripe_sandbox'
      ? String(process.env.STRIPE_SIMULATOR_WEBHOOK_SECRET || '')
      : String(process.env.LIBELULA_WEBHOOK_SECRET || '');
    const minLength = provider === 'stripe_sandbox' ? 32 : 16;
    if (secret.length < minLength || /REPLACE|CHANGE_ME|PLACEHOLDER/i.test(secret)) {
      throw new UnauthorizedException('WEBHOOK_SECRET_NOT_CONFIGURED: falta una clave de webhook segura para este proveedor.');
    }
    return secret;
  }

  private _firmaWebhookValida(rawBody: unknown, firmaRaw: unknown, secret: string): boolean {
    if (!Buffer.isBuffer(rawBody)) return false;
    const firma = String(firmaRaw || '').replace(/^sha256=/i, '').trim();
    if (!/^[a-f0-9]{64}$/i.test(firma)) return false;
    const recibida = Buffer.from(firma, 'hex');
    const esperada = createHmac('sha256', secret).update(rawBody).digest();
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
  }

  private async _simularWebhookSandbox(
    pagoId: number,
    estado: 'aprobado' | 'rechazado',
    req: any,
    body: any = {},
  ) {
    if (String(process.env.PAGOS_MODO || 'sandbox').toLowerCase() !== 'sandbox') {
      throw new ForbiddenException('SANDBOX_SIMULATOR_DISABLED: el simulador solo está disponible en PAGOS_MODO=sandbox.');
    }
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `SELECT pg.*, v.usuario_id, v.numero_comprobante
         FROM public.pagos pg
         JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
        WHERE pg.tenant_id = $1 AND pg.id = $2 LIMIT 1`,
      [tenant.tenantId, pagoId],
    );
    const pago: any = rows[0];
    if (!pago) throw new NotFoundException('Pago no encontrado en esta tienda.');
    if (req.user?.rol === 'cliente' && Number(pago.usuario_id) !== Number(req.user.sub)) {
      throw new ForbiddenException('PAYMENT_OWNER_REQUIRED: solo puedes simular el pago de tu propia compra.');
    }
    const provider = String(pago.pasarela) as 'stripe_sandbox' | 'libelula_sandbox';
    if (!['stripe_sandbox', 'libelula_sandbox'].includes(provider)) {
      throw new BadRequestException('Este pago no pertenece a una pasarela digital compatible con el simulador.');
    }
    if (provider === 'stripe_sandbox' && stripeTestCredentialsPresent()) {
      throw new ForbiddenException('STRIPE_REAL_TEST_FLOW_ENABLED: cuando Stripe Checkout test está configurado, esta tarjeta solo se confirma por su webhook firmado.');
    }
    if (['no_confirmado', 'pendiente'].includes(String(pago.estado)) &&
        pago.expira_en && new Date(pago.expira_en).getTime() <= Date.now()) {
      throw new ConflictException('PAYMENT_EXPIRED: el intento sandbox venció; ejecuta la conciliación antes de crear otro intento.');
    }
    const evento = {
      event_id: String(body?.webhook_id || body?.event_id || randomUUID()).trim(),
      tenant_id: tenant.tenantId,
      tenant_slug: tenant.tenantSlug,
      reference: String(pago.referencia_externa),
      amount: Number(pago.monto),
      currency: String(pago.moneda || 'BOB'),
      status: estado,
      reason: estado === 'rechazado' ? String(body?.motivo || 'Pago rechazado por el simulador sandbox') : undefined,
    };
    const rawBody = Buffer.from(JSON.stringify(evento), 'utf8');
    const firma = createHmac('sha256', this._secretoWebhook(provider)).update(rawBody).digest('hex');
    return this._recibirWebhookFirmado(provider, evento, {
      rawBody,
      headers: { 'x-provider-signature': `sha256=${firma}` },
    });
  }

  private async _recibirWebhookFirmado(
    provider: 'stripe_sandbox' | 'libelula_sandbox',
    body: any,
    req: any,
  ) {
    const tenant = TenantContext.require();
    const rawBody = req?.rawBody;
    const firma = req?.headers?.['x-provider-signature'] || req?.headers?.['stripe-signature'];
    if (!this._firmaWebhookValida(rawBody, firma, this._secretoWebhook(provider))) {
      throw new UnauthorizedException('WEBHOOK_SIGNATURE_INVALID: firma HMAC inválida o cuerpo sin captura raw.');
    }

    const eventId = String(body?.event_id || body?.id || '').trim();
    const tenantIdFirmado = String(body?.tenant_id || '').trim();
    const tenantSlugFirmado = String(body?.tenant_slug || '').trim().toLowerCase();
    const reference = String(body?.reference || '').trim();
    const amount = Number(body?.amount);
    const currency = String(body?.currency || 'BOB').trim().toUpperCase();
    const paymentStatus = String(body?.status || '').trim().toLowerCase();
    if (!eventId || eventId.length > 160 || !reference || reference.length > 160 || !Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('WEBHOOK_PAYLOAD_INVALID: event_id, reference y amount son obligatorios.');
    }
    if (tenantIdFirmado !== tenant.tenantId || tenantSlugFirmado !== tenant.tenantSlug) {
      throw new ForbiddenException('WEBHOOK_TENANT_MISMATCH: el tenant firmado no coincide con la tienda resuelta.');
    }
    const nuevoEstado = ['aprobado', 'approved', 'succeeded', 'paid'].includes(paymentStatus)
      ? 'aprobado'
      : ['rechazado', 'rejected', 'failed', 'expired'].includes(paymentStatus)
        ? 'rechazado'
        : null;
    if (!nuevoEstado) throw new BadRequestException('WEBHOOK_STATUS_INVALID: estado de pago no reconocido.');

    const reason = String(body?.reason || body?.motivo || '').trim().slice(0, 500);
    return Db.tx(async (client) => {
      const pRes = await client.query(
        `SELECT pg.id, pg.tenant_id, pg.referencia_externa, pg.pasarela, pg.monto,
                pg.moneda, pg.estado
           FROM public.pagos pg
          WHERE pg.tenant_id = $1 AND pg.referencia_externa = $2
          FOR UPDATE`,
        [tenant.tenantId, reference],
      );
      if (pRes.rowCount === 0) throw new NotFoundException('WEBHOOK_PAYMENT_NOT_FOUND: referencia no encontrada en esta tienda.');
      const pago = pRes.rows[0];
      if (String(pago.pasarela) !== provider) {
        throw new UnprocessableEntityException('WEBHOOK_PROVIDER_MISMATCH: la referencia pertenece a otra pasarela.');
      }
      if (Math.round(Number(pago.monto) * 100) !== Math.round(amount * 100) || String(pago.moneda).toUpperCase() !== currency) {
        throw new UnprocessableEntityException('WEBHOOK_AMOUNT_MISMATCH: el monto o la moneda no coincide con el pago registrado.');
      }

      const payloadSeguro = JSON.stringify({
        event_id: eventId,
        tenant_id: tenantIdFirmado,
        tenant_slug: tenantSlugFirmado,
        reference,
        amount,
        currency,
        status: paymentStatus,
        reason: reason || null,
      });
      const inserted = await client.query(
        `INSERT INTO public.webhooks_recibidos
           (tenant_id, provider, event_id, referencia, monto, firma_valida, procesado, payload_json)
         VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, $6::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [tenant.tenantId, provider, eventId, reference, amount, payloadSeguro],
      );
      const duplicado = inserted.rowCount === 0;
      if (duplicado) {
        const previo = await client.query(
          `SELECT provider, referencia, monto, firma_valida, procesado, payload_json
             FROM public.webhooks_recibidos
            WHERE tenant_id = $1 AND event_id = $2
            FOR UPDATE`,
          [tenant.tenantId, eventId],
        );
        if (previo.rowCount === 0) {
          throw new ConflictException('WEBHOOK_EVENT_ID_ALREADY_USED: event_id ya fue usado por otro tenant.');
        }
        const row = previo.rows[0];
        const oldPayload = row.payload_json || {};
        if (row.provider !== provider || row.referencia !== reference ||
            Math.round(Number(row.monto) * 100) !== Math.round(amount * 100) || !row.firma_valida ||
            String(oldPayload.status || '').toLowerCase() !== paymentStatus ||
            String(oldPayload.currency || 'BOB').toUpperCase() !== currency) {
          throw new ConflictException('WEBHOOK_EVENT_ID_REUSED: event_id se reutilizó con datos distintos.');
        }
        if (row.procesado) {
          return { recibido: true, duplicado: true, event_id: eventId, estado: 'procesado' };
        }
      }

      const pagoProcesado = await procesarResolucionPagoEnTx(
        client,
        tenant.tenantId,
        Number(pago.id),
        nuevoEstado,
        null,
        eventId,
        reason || (nuevoEstado === 'rechazado' ? 'Pago rechazado por la pasarela.' : undefined),
      );
      await client.query(
        `UPDATE public.webhooks_recibidos
            SET procesado = TRUE, procesado_en = NOW()
          WHERE tenant_id = $1 AND event_id = $2`,
        [tenant.tenantId, eventId],
      );
      return { recibido: true, duplicado, event_id: eventId, pago: pagoProcesado };
    });
  }

  private async _procesarResolucionPago(
    pagoId: number,
    nuevoEstado: 'aprobado' | 'rechazado',
    actorId: number | null,
    webhookId?: string,
    motivoRechazo?: string,
  ) {
    const tenant = TenantContext.require();
    return Db.tx(
      (client) => procesarResolucionPagoEnTx(
        client,
        tenant.tenantId,
        pagoId,
        nuevoEstado,
        actorId,
        webhookId,
        motivoRechazo,
      ),
      { requireWrite: true },
    );
  }
}


async function reanudarWebhooksEnTx(client: PoolClient, tenantId: string) {
  const pendientes = await client.query(
    `SELECT id, provider, event_id, referencia, monto, firma_valida, payload_json
       FROM public.webhooks_recibidos
      WHERE tenant_id = $1 AND procesado = FALSE AND firma_valida = TRUE
      ORDER BY recibido_en ASC, id ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED`,
    [tenantId],
  );
  let procesados = 0;
  let fallidos = 0;

  for (const evento of pendientes.rows) {
    await client.query('SAVEPOINT reanudar_webhook');
    try {
      const payload = evento.payload_json || {};
      const status = String(payload.status || '').trim().toLowerCase();
      const estado = ['aprobado', 'approved', 'succeeded', 'paid'].includes(status)
        ? 'aprobado'
        : ['rechazado', 'rejected', 'failed', 'expired'].includes(status)
          ? 'rechazado'
          : null;
      if (!estado) throw new BadRequestException('WEBHOOK_STATUS_INVALID: estado pendiente no reconocido.');
      const pagoRes = await client.query(
        `SELECT id, referencia_externa, pasarela, monto, moneda
           FROM public.pagos
          WHERE tenant_id = $1 AND referencia_externa = $2
          FOR UPDATE`,
        [tenantId, String(evento.referencia)],
      );
      if (pagoRes.rowCount === 0) throw new NotFoundException('WEBHOOK_PAYMENT_NOT_FOUND: pago asociado no encontrado.');
      const pago = pagoRes.rows[0];
      if (String(pago.pasarela) !== String(evento.provider) ||
          Math.round(Number(pago.monto) * 100) !== Math.round(Number(evento.monto) * 100) ||
          String(pago.moneda || 'BOB').toUpperCase() !== String(payload.currency || 'BOB').toUpperCase()) {
        throw new UnprocessableEntityException('WEBHOOK_RECONCILIATION_MISMATCH: datos persistidos no coinciden con el pago.');
      }
      await procesarResolucionPagoEnTx(
        client,
        tenantId,
        Number(pago.id),
        estado,
        null,
        String(evento.event_id),
        String(payload.reason || 'Evento reanudado por conciliación').slice(0, 500),
      );
      await client.query(
        `UPDATE public.webhooks_recibidos SET procesado = TRUE, procesado_en = NOW(),
                intentos = intentos + 1, ultimo_error = NULL
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, evento.id],
      );
      await client.query('RELEASE SAVEPOINT reanudar_webhook');
      procesados += 1;
    } catch (error: any) {
      await client.query('ROLLBACK TO SAVEPOINT reanudar_webhook');
      await client.query('RELEASE SAVEPOINT reanudar_webhook');
      await client.query(
        `UPDATE public.webhooks_recibidos SET intentos = intentos + 1, ultimo_error = $3
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, evento.id, String(error?.message || 'Fallo de conciliación').slice(0, 500)],
      );
      fallidos += 1;
    }
  }
  return { procesados, fallidos };
}

async function expirarPagosVencidosEnTx(client: PoolClient, tenantId: string) {
  const pagos = await client.query(
    `SELECT pg.id, pg.venta_id, pg.referencia_externa, pg.estado, pg.expira_en,
            v.estado AS venta_estado, v.estado_pago AS venta_estado_pago,
            v.almacen_id, v.numero_comprobante
       FROM public.pagos pg
       JOIN public.ventas v ON v.tenant_id = pg.tenant_id AND v.id = pg.venta_id
      WHERE pg.tenant_id = $1
        AND pg.estado IN ('pendiente', 'no_confirmado')
        AND pg.expira_en <= NOW()
      ORDER BY pg.expira_en ASC, pg.id ASC
      LIMIT 100
      FOR UPDATE OF pg, v SKIP LOCKED`,
    [tenantId],
  );
  let expirados = 0;
  for (const pago of pagos.rows) {
    const ventaPendiente = ['pendiente', 'no_confirmado'].includes(String(pago.venta_estado_pago)) &&
      String(pago.venta_estado) === 'pendiente_pago';
    let falloLiberacion: string | null = null;
    if (ventaPendiente) {
      const items = await client.query(
        'SELECT variante_id, cantidad FROM public.venta_items WHERE tenant_id = $1 AND venta_id = $2 ORDER BY variante_id',
        [tenantId, pago.venta_id],
      );
      await client.query('SAVEPOINT expirar_reserva_pago');
      try {
        await VentaStockHelper.liberarRetencion(
          client,
          tenantId,
          Number(pago.almacen_id),
          null,
          String(pago.numero_comprobante),
          items.rows,
        );
        await client.query('RELEASE SAVEPOINT expirar_reserva_pago');
      } catch (error: any) {
        await client.query('ROLLBACK TO SAVEPOINT expirar_reserva_pago');
        await client.query('RELEASE SAVEPOINT expirar_reserva_pago');
        if (!esFalloDeStock(error)) throw error;
        falloLiberacion = String(error?.message || 'No se pudo liberar la reserva de inventario.');
      }
      await client.query(
        `UPDATE public.ventas SET estado = $3, estado_pago = 'expirado', actualizado_en = NOW()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pago.venta_id, falloLiberacion ? 'conflicto_stock' : 'cancelada'],
      );
      if (falloLiberacion) {
        await avisarAdministradoresPago(
          client, tenantId, Number(pago.venta_id), String(pago.referencia_externa), falloLiberacion,
        );
      }
    }
    await client.query(
      `UPDATE public.pagos SET estado = 'expirado', confirmado_proveedor = FALSE,
              motivo_rechazo = 'Intento de pago vencido por conciliación'
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, pago.id],
    );
    await client.query(
      `UPDATE public.saga_pago SET estado = $3, paso_actual = 'C1',
              intentos = intentos + 1, ultimo_error = $4, actualizado_en = NOW()
        WHERE tenant_id = $1 AND operacion_id = $2`,
      [tenantId, String(pago.referencia_externa), falloLiberacion ? 'REQUIERE_INTERVENCION' : 'COMPENSADA', falloLiberacion],
    );
    expirados += 1;
  }
  return expirados;
}

/** Conciliación por tenant: reanuda webhooks persistidos y libera reservas de pagos vencidos. */
export async function conciliarPagosTenant(tenantId: string) {
  return Db.tx(async (client) => {
    const webhooks = await reanudarWebhooksEnTx(client, tenantId);
    const expirados = await expirarPagosVencidosEnTx(client, tenantId);
    return {
      tenant_id: tenantId,
      webhooks_reanudados: webhooks.procesados,
      webhooks_con_error: webhooks.fallidos,
      pagos_expirados: expirados,
      conciliado_en: new Date().toISOString(),
    };
  }, { tenantId });
}

/** Tarea global coordinada con advisory lock; segura ante réplicas y reinicios. */
export async function ejecutarConciliacionPagos() {
  let lockClient: PoolClient | null = null;
  let lockAdquirido = false;
  try {
    lockClient = await getPool().connect();
    await lockClient.query('SET ROLE app_runtime');
    const lock = await lockClient.query(
      `SELECT pg_try_advisory_lock(hashtext('fashionstore'), hashtext('payment_reconciliation')) AS adquirido`,
    );
    lockAdquirido = Boolean(lock.rows[0]?.adquirido);
    if (!lockAdquirido) return { omitido: true, motivo: 'otra réplica ejecuta la conciliación' };

    const tenants = await lockClient.query('SELECT id FROM public.tenants ORDER BY id');
    let webhooksReanudados = 0;
    let webhooksConError = 0;
    let pagosExpirados = 0;
    for (const row of tenants.rows) {
      const resumen = await conciliarPagosTenant(String(row.id));
      webhooksReanudados += resumen.webhooks_reanudados;
      webhooksConError += resumen.webhooks_con_error;
      pagosExpirados += resumen.pagos_expirados;
    }
    return {
      omitido: false,
      tenants: tenants.rowCount,
      webhooks_reanudados: webhooksReanudados,
      webhooks_con_error: webhooksConError,
      pagos_expirados: pagosExpirados,
      conciliado_en: new Date().toISOString(),
    };
  } catch (error: any) {
    console.warn('[FashionStore] Conciliación de pagos no completada:', error?.code || 'ERROR');
    return { omitido: true, motivo: 'error de conciliación' };
  } finally {
    if (lockClient) {
      if (lockAdquirido) {
        await lockClient.query(
          `SELECT pg_advisory_unlock(hashtext('fashionstore'), hashtext('payment_reconciliation'))`,
        ).catch(() => undefined);
      }
      await lockClient.query('RESET ROLE').catch(() => undefined);
      lockClient.release();
    }
  }
}

@Module({
  controllers: [PagosController],
})
export class PagosModule {}
