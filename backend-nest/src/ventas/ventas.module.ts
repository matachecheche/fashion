import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { InventarioCore } from '../common/inventario-core';
import { VentaStockHelper } from '../common/venta-stock';
import { calcularOfflinePayloadHash } from '../common/offline-hash';
import { generarCodigo, redondearMoneda } from '../common/util';

@Controller('ventas')
@UseGuards(JwtTenantGuard)
export class VentasController {
  @Post()
  async crearVenta(@Req() req: any, @Body() body: any, reintentarConflictoOffline = false) {
    const tenant = TenantContext.require();
    const sucursalId = Number(body?.sucursal_id || req.user.sucursal_id || 1);
    const metodoPago = String(body?.metodo_pago || 'tarjeta').toLowerCase();
    const origen = String(body?.origen || (['cajero', 'admin', 'encargado'].includes(req.user.rol) && body?.pos ? 'pos' : 'web'));
    const items = Array.isArray(body?.items) ? body.items : [];
    const offlineId = body?.operacion_offline_id ? String(body.operacion_offline_id).trim() : null;

    if (items.length === 0) {
      throw new BadRequestException('El pedido o venta debe incluir al menos un item.');
    }

    const payloadCanonic = {
      sucursal_id: sucursalId,
      metodo_pago: metodoPago,
      promocion_codigo: body?.promocion_codigo || null,
      items: items.map((i: any) => ({
        variante_id: Number(i.variante_id),
        cantidad: Number(i.cantidad),
      })),
    };
    const payloadHash = calcularOfflinePayloadHash(payloadCanonic);

    return Db.tx(
      async (client) => {
        let operacionOfflineExistente = false;
        if (offlineId) {
          const prev = await client.query(
            'SELECT * FROM public.operaciones_offline WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
            [tenant.tenantId, offlineId],
          );
          if (prev.rowCount > 0) {
            operacionOfflineExistente = true;
            const op = prev.rows[0];
            if (op.payload_hash !== payloadHash) {
              throw new ConflictException(
                'IDEMPOTENCY_PAYLOAD_MISMATCH: La misma clave idempotente fue enviada con un contenido de venta distinto.',
              );
            }
            if (op.estado === 'sincronizada') {
              return { ...(op.respuesta_json || {}), idempotent_replay: true };
            }
            if (op.estado === 'conflicto') {
              if (!reintentarConflictoOffline || op.codigo_conflicto !== 'STOCK_INSUFICIENTE') {
                throw new ConflictException(op.motivo_error || 'CONFLICTO_STOCK_OFFLINE');
              }
              await client.query(
                `UPDATE public.operaciones_offline
                    SET estado = 'pendiente', motivo_error = NULL, codigo_conflicto = NULL,
                        intentos = intentos + 1, procesado_en = NOW()
                  WHERE tenant_id = $1 AND id = $2`,
                [tenant.tenantId, offlineId],
              );
            } else {
              throw new ConflictException(`OFFLINE_OPERATION_NOT_RETRYABLE: estado actual ${op.estado}.`);
            }
          } else if (reintentarConflictoOffline) {
            throw new NotFoundException('La operación offline en conflicto ya no existe en esta tienda.');
          }
        }

        const almRes = await client.query(
          'SELECT id FROM public.almacenes WHERE tenant_id = $1 AND sucursal_id = $2 AND activo = TRUE ORDER BY es_principal DESC, id ASC LIMIT 1',
          [tenant.tenantId, sucursalId],
        );
        if (almRes.rowCount === 0) {
          throw new BadRequestException('No existe almacen activo para la sucursal indicada.');
        }
        const almacenId = Number(almRes.rows[0].id);

        if (offlineId && !operacionOfflineExistente) {
          await client.query(
            `
            INSERT INTO public.operaciones_offline
              (id, tenant_id, tipo, usuario_id, sucursal_id, actor_rol, payload_hash, payload_json, estado)
            VALUES ($1, $2, 'venta', $3, $4, $5, $6, $7::jsonb, 'pendiente')
            `,
            [
              offlineId,
              tenant.tenantId,
              Number(req.user.sub),
              sucursalId,
              req.user.rol,
              payloadHash,
              JSON.stringify(payloadCanonic),
            ],
          );
        }

        // Calcular precios en el servidor (nunca confiar en precios del cliente)
        let subtotal = 0;
        const itemsResueltos: Array<{
          variante_id: number;
          cantidad: number;
          precio_unitario: number;
          subtotal: number;
          sku: string;
          producto_nombre: string;
        }> = [];

        for (const rawItem of items) {
          const varianteId = Number(rawItem.variante_id);
          const cantidad = Math.abs(Number(rawItem.cantidad || 1));
          const vRes = await client.query(
            `
            SELECT v.id, v.sku, (p.precio_base + v.precio_adicional) AS precio_final, p.nombre AS producto_nombre
              FROM public.variantes v
              JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
             WHERE v.tenant_id = $1 AND v.id = $2 AND v.activa = TRUE AND p.activo = TRUE
            `,
            [tenant.tenantId, varianteId],
          );
          if (vRes.rowCount === 0) {
            throw new NotFoundException(`La variante ${varianteId} no existe o no esta activa en esta tienda.`);
          }
          const precioUnit = redondearMoneda(Number(vRes.rows[0].precio_final));
          const subItem = redondearMoneda(precioUnit * cantidad);
          subtotal = redondearMoneda(subtotal + subItem);
          itemsResueltos.push({
            variante_id: varianteId,
            cantidad,
            precio_unitario: precioUnit,
            subtotal: subItem,
            sku: vRes.rows[0].sku,
            producto_nombre: vRes.rows[0].producto_nombre,
          });
        }

        // Validar promocion en servidor
        let descuento = 0;
        let promoCodigo: string | null = null;
        if (body?.promocion_codigo) {
          const pCode = String(body.promocion_codigo).trim().toUpperCase();
          const promoRes = await client.query(
            `
            SELECT * FROM public.promociones
             WHERE tenant_id = $1
               AND UPPER(codigo) = $2
               AND activa = TRUE
               AND inicia_en <= NOW()
               AND termina_en >= NOW()
             LIMIT 1
            `,
            [tenant.tenantId, pCode],
          );
          if (promoRes.rowCount > 0) {
            const pr = promoRes.rows[0];
            if (subtotal >= Number(pr.minimo_compra)) {
              promoCodigo = pr.codigo;
              if (pr.tipo_descuento === 'porcentaje') {
                descuento = redondearMoneda(subtotal * (Number(pr.valor) / 100));
              } else {
                descuento = redondearMoneda(Math.min(subtotal, Number(pr.valor)));
              }
            }
          }
        }

        const total = redondearMoneda(Math.max(0, subtotal - descuento));
        const comprobante = generarCodigo('VTA');

        // Regla estricta: unicamente efectivo en POS presencial se confirma de inmediato;
        // pagos QR, tarjeta o pasarelas online quedan en pendiente_pago / no_confirmado
        // hasta confirmacion verificable del proveedor sandbox.
        const esEfectivoPos =
          metodoPago === 'efectivo' &&
          ['pos', 'offline_pos'].includes(origen) &&
          ['admin', 'encargado', 'cajero'].includes(req.user.rol);

        const estadoVenta = esEfectivoPos ? 'pagada' : 'pendiente_pago';
        const estadoPago = esEfectivoPos ? 'aprobado' : 'no_confirmado';

        try {
          if (esEfectivoPos) {
            await VentaStockHelper.descontarVentaDirecta(
              client,
              tenant.tenantId,
              almacenId,
              Number(req.user.sub),
              comprobante,
              itemsResueltos,
            );
          } else {
            await VentaStockHelper.retenerPorPagoPendiente(
              client,
              tenant.tenantId,
              almacenId,
              Number(req.user.sub),
              comprobante,
              itemsResueltos,
            );
          }
        } catch (stockErr: any) {
          if (offlineId) {
            await client.query(
              `
              UPDATE public.operaciones_offline
                 SET estado = 'conflicto',
                     codigo_conflicto = 'STOCK_INSUFICIENTE',
                     motivo_error = $3,
                     procesado_en = NOW()
               WHERE tenant_id = $1 AND id = $2
              `,
              [tenant.tenantId, offlineId, String(stockErr?.message || 'Stock insuficiente al sincronizar')],
            );
          }
          throw stockErr;
        }

        // Buscar caja abierta si es POS
        let cajaId: number | null = body?.caja_id ? Number(body.caja_id) : null;
        if (!cajaId && ['pos', 'offline_pos'].includes(origen)) {
          const cRes = await client.query(
            `SELECT id FROM public.cajas WHERE tenant_id = $1 AND sucursal_id = $2 AND estado = 'abierta' ORDER BY id DESC LIMIT 1`,
            [tenant.tenantId, sucursalId],
          );
          if (cRes.rowCount > 0) cajaId = Number(cRes.rows[0].id);
        }

        const vIns = await client.query(
          `
          INSERT INTO public.ventas (
            tenant_id, numero_comprobante, usuario_id, vendedor_id, sucursal_id, almacen_id,
            caja_id, origen, estado, estado_pago, metodo_pago, subtotal, descuento, total,
            promocion_codigo, cliente_nombre, cliente_nit, direccion_entrega, operacion_offline_id, notas
          )
          VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20
          )
          RETURNING *
          `,
          [
            tenant.tenantId,
            comprobante,
            req.user.rol === 'cliente' ? Number(req.user.sub) : body?.cliente_id ? Number(body.cliente_id) : Number(req.user.sub),
            ['admin', 'encargado', 'cajero'].includes(req.user.rol) ? Number(req.user.sub) : null,
            sucursalId,
            almacenId,
            cajaId,
            origen,
            estadoVenta,
            estadoPago,
            metodoPago,
            subtotal,
            descuento,
            total,
            promoCodigo,
            String(body?.cliente_nombre || req.user.nombre || 'Consumidor Final'),
            String(body?.cliente_nit || '0'),
            body?.direccion_entrega ? String(body.direccion_entrega) : null,
            offlineId,
            body?.notas ? String(body.notas) : null,
          ],
        );
        const venta = vIns.rows[0];

        for (const item of itemsResueltos) {
          await client.query(
            `
            INSERT INTO public.venta_items
              (tenant_id, venta_id, variante_id, cantidad, precio_unitario, descuento_unitario, subtotal)
            VALUES ($1, $2, $3, $4, $5, 0, $6)
            `,
            [tenant.tenantId, venta.id, item.variante_id, item.cantidad, item.precio_unitario, item.subtotal],
          );
        }

        // Registrar transaccion de pago asociada en modo sandbox
        const refPago = generarCodigo('PAY');
        const pasarela =
          esEfectivoPos
            ? 'efectivo_pos'
            : metodoPago === 'qr'
              ? 'libelula_sandbox'
              : 'stripe_sandbox';

        const pIns = await client.query(
          `
          INSERT INTO public.pagos (
            tenant_id, venta_id, referencia_externa, pasarela, metodo, monto, moneda,
            modo, estado, confirmado_proveedor, confirmado_en
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'BOB', 'sandbox', $7, $8, $9)
          RETURNING *
          `,
          [
            tenant.tenantId,
            venta.id,
            refPago,
            pasarela,
            metodoPago,
            total,
            esEfectivoPos ? 'aprobado' : 'no_confirmado',
            esEfectivoPos,
            esEfectivoPos ? new Date().toISOString() : null,
          ],
        );
        await client.query(
          `INSERT INTO public.saga_pago
             (tenant_id, operacion_id, venta_id, pago_id, estado, paso_actual)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenant.tenantId,
            refPago,
            venta.id,
            pIns.rows[0].id,
            esEfectivoPos ? 'VENTA_CONFIRMADA' : 'PAGO_PENDIENTE',
            esEfectivoPos ? 'T4' : 'T2',
          ],
        );

        if (esEfectivoPos && cajaId) {
          await client.query(
            `
            UPDATE public.cajas
               SET monto_ventas_efectivo = monto_ventas_efectivo + $3
             WHERE tenant_id = $1 AND id = $2
            `,
            [tenant.tenantId, cajaId, total],
          );
        }

        const respuesta = {
          ...venta,
          subtotal: Number(venta.subtotal),
          descuento: Number(venta.descuento),
          total: Number(venta.total),
          items: itemsResueltos,
          pago: pIns.rows[0],
          aviso_pago: esEfectivoPos
            ? 'Pago en efectivo registrado en caja POS.'
            : 'PENDIENTE DE CONFIRMACION DEL PROVEEDOR (SANDBOX): No entregue mercaderia hasta confirmar el cobro.',
        };

        if (offlineId) {
          await client.query(
            `
            UPDATE public.operaciones_offline
               SET estado = 'sincronizada', respuesta_json = $3::jsonb, procesado_en = NOW()
             WHERE tenant_id = $1 AND id = $2
            `,
            [tenant.tenantId, offlineId, JSON.stringify(respuesta)],
          );
        }

        return respuesta;
      },
      { requireWrite: true },
    );
  }

  @Post('sincronizar-offline')
  async sincronizarLoteOffline(@Req() req: any, @Body() body: any) {
    const operaciones = Array.isArray(body?.operaciones) ? body.operaciones : [body];
    const resultados = [];

    for (const op of operaciones) {
      const opId = String(op?.id || op?.operacion_offline_id || '').trim();
      if (!opId) {
        resultados.push({
          id: null,
          estado: 'rechazada',
          error: 'MISSING_IDEMPOTENCY_KEY',
          detalle: 'Toda operacion offline requiere un identificador unico de idempotencia.',
        });
        continue;
      }

      try {
        const resVenta = await this.crearVenta(req, {
          ...op,
          operacion_offline_id: opId,
          origen: op?.origen || 'offline_pos',
        });
        resultados.push({
          id: opId,
          estado: 'sincronizada',
          idempotent_replay: Boolean(resVenta.idempotent_replay),
          venta: resVenta,
        });
      } catch (err: any) {
        const msg = String(err?.message || 'Error al sincronizar operacion');
        const esConflictoStock = msg.includes('STOCK_INSUFICIENTE');
        const esMismatch = msg.includes('IDEMPOTENCY_PAYLOAD_MISMATCH');

        if (esConflictoStock) {
          const tenant = TenantContext.require();
          const payloadCanonic = {
            sucursal_id: Number(op?.sucursal_id || 1),
            metodo_pago: String(op?.metodo_pago || 'efectivo').toLowerCase(),
            promocion_codigo: op?.promocion_codigo || null,
            items: (op?.items || []).map((i: any) => ({
              variante_id: Number(i.variante_id),
              cantidad: Number(i.cantidad),
            })),
          };
          const payloadHash = calcularOfflinePayloadHash(payloadCanonic);
          await Db.query(
            `
            INSERT INTO public.operaciones_offline
              (id, tenant_id, tipo, usuario_id, sucursal_id, actor_rol, payload_hash, payload_json, estado, codigo_conflicto, motivo_error)
            VALUES ($1, $2, 'venta', $3, $4, $5, $6, $7::jsonb, 'conflicto', 'STOCK_INSUFICIENTE', $8)
            ON CONFLICT (id) DO UPDATE SET
              estado = 'conflicto',
              codigo_conflicto = 'STOCK_INSUFICIENTE',
              motivo_error = EXCLUDED.motivo_error,
              procesado_en = NOW()
            `,
            [
              opId,
              tenant.tenantId,
              Number(req.user.sub),
              Number(op?.sucursal_id || 1),
              req.user.rol,
              payloadHash,
              JSON.stringify(payloadCanonic),
              msg,
            ],
          ).catch(() => undefined);
        }

        resultados.push({
          id: opId,
          estado: esConflictoStock ? 'conflicto' : esMismatch ? 'rechazada' : 'error',
          codigo_error: esConflictoStock
            ? 'STOCK_CONFLICT_LAST_UNIT'
            : esMismatch
              ? 'IDEMPOTENCY_PAYLOAD_MISMATCH'
              : 'SYNC_ERROR',
          detalle: msg,
        });
      }
    }

    return {
      total_procesadas: resultados.length,
      sincronizadas: resultados.filter((r) => r.estado === 'sincronizada').length,
      conflictos: resultados.filter((r) => r.estado === 'conflicto').length,
      rechazadas: resultados.filter((r) => r.estado === 'rechazada').length,
      resultados,
    };
  }

  @Get('mias')
  async listarMisVentas(@Req() req: any) {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT
        v.*,
        s.nombre AS sucursal_nombre,
        COALESCE(
          JSON_AGG(
            JSONB_BUILD_OBJECT(
              'variante_id', vi.variante_id,
              'sku', vr.sku,
              'talla', vr.talla,
              'color', vr.color,
              'producto_nombre', p.nombre,
              'cantidad', vi.cantidad,
              'precio_unitario', vi.precio_unitario,
              'subtotal', vi.subtotal
            )
          ) FILTER (WHERE vi.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM public.ventas v
      JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
      LEFT JOIN public.venta_items vi ON vi.tenant_id = v.tenant_id AND vi.venta_id = v.id
      LEFT JOIN public.variantes vr ON vr.tenant_id = vi.tenant_id AND vr.id = vi.variante_id
      LEFT JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
      WHERE v.tenant_id = $1 AND v.usuario_id = $2
      GROUP BY v.id, s.nombre
      ORDER BY v.id DESC
      `,
      [tenant.tenantId, Number(req.user.sub)],
    );
  }

  @Roles('admin', 'encargado', 'cajero')
  @Get()
  async listarTodasVentas() {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT
        v.*,
        s.nombre AS sucursal_nombre,
        u.nombre AS usuario_nombre
      FROM public.ventas v
      JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
      LEFT JOIN public.usuarios u ON u.tenant_id = v.tenant_id AND u.id = v.usuario_id
      WHERE v.tenant_id = $1
      ORDER BY v.id DESC
      LIMIT 200
      `,
      [tenant.tenantId],
    );
  }

  @Get(':id')
  async obtenerDetalleVenta(@Param('id') id: string, @Req() req: any) {
    const tenant = TenantContext.require();
    return Db.tx(async (client) => {
      const vRes = await client.query(
        `
        SELECT v.*, s.nombre AS sucursal_nombre, s.direccion AS sucursal_direccion
          FROM public.ventas v
          JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
         WHERE v.tenant_id = $1 AND v.id = $2
        `,
        [tenant.tenantId, Number(id)],
      );
      if (vRes.rowCount === 0) throw new NotFoundException('Venta no encontrada en esta tienda.');
      const venta = vRes.rows[0];
      if (req.user.rol === 'cliente' && Number(venta.usuario_id) !== Number(req.user.sub)) {
        throw new NotFoundException('Venta no encontrada.');
      }

      const [itemsRes, pagosRes] = await Promise.all([
        client.query(
          `
          SELECT vi.*, vr.sku, vr.talla, vr.color, p.nombre AS producto_nombre
            FROM public.venta_items vi
            JOIN public.variantes vr ON vr.tenant_id = vi.tenant_id AND vr.id = vi.variante_id
            JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
           WHERE vi.tenant_id = $1 AND vi.venta_id = $2
          `,
          [tenant.tenantId, venta.id],
        ),
        client.query('SELECT * FROM public.pagos WHERE tenant_id = $1 AND venta_id = $2 ORDER BY id DESC', [
          tenant.tenantId,
          venta.id,
        ]),
      ]);

      return { ...venta, items: itemsRes.rows, pagos: pagosRes.rows };
    });
  }

  @Get(':id/comprobante')
  async obtenerComprobante(@Param('id') id: string, @Req() req: any) {
    const detalle = await this.obtenerDetalleVenta(id, req);
    const tenant = TenantContext.require();
    return {
      tienda: {
        nombre: tenant.nombre,
        slug: tenant.tenantSlug,
      },
      comprobante: {
        numero: detalle.numero_comprobante,
        fecha: detalle.creado_en,
        cliente_nombre: detalle.cliente_nombre,
        cliente_nit: detalle.cliente_nit,
        estado_venta: detalle.estado,
        estado_pago: detalle.estado_pago,
        es_pago_confirmado: detalle.estado_pago === 'aprobado',
        etiqueta_estado:
          detalle.estado_pago === 'aprobado'
            ? 'PAGADO (CONFIRMADO)'
            : 'PENDIENTE DE CONFIRMACION DEL PROVEEDOR',
        metodo_pago: detalle.metodo_pago,
        subtotal: Number(detalle.subtotal),
        descuento: Number(detalle.descuento),
        total: Number(detalle.total),
        moneda: 'BOB',
        items: detalle.items,
      },
    };
  }

  @Roles('admin', 'encargado', 'cajero')
  @Post(':id/entregar')
  async marcarEntregada(@Param('id') id: string) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const vRes = await client.query(
          'SELECT * FROM public.ventas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, Number(id)],
        );
        if (vRes.rowCount === 0) throw new NotFoundException('Venta no encontrada.');
        const v = vRes.rows[0];
        if (v.estado_pago !== 'aprobado') {
          throw new BadRequestException(
            'PAGO_NO_CONFIRMADO: No se puede entregar un pedido cuyo pago no ha sido confirmado por el proveedor.',
          );
        }
        const upd = await client.query(
          `UPDATE public.ventas SET estado = 'entregada', actualizado_en = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
          [tenant.tenantId, Number(id)],
        );
        return upd.rows[0];
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Post(':id/devolucion')
  async registrarDevolucion(@Param('id') id: string, @Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const ventaId = Number(id);
    if (!Number.isInteger(ventaId) || ventaId < 1) throw new BadRequestException('Identificador de venta invalido.');
    const motivo = String(body?.motivo || 'Devolucion de cliente en tienda').trim().slice(0, 500);
    return Db.tx(
      async (client) => {
        // Mantener el orden de locks de webhooks: pagos y luego venta.
        const pagosRes = await client.query(
          `SELECT * FROM public.pagos
            WHERE tenant_id = $1 AND venta_id = $2
            ORDER BY id ASC FOR UPDATE`,
          [tenant.tenantId, ventaId],
        );
        const vRes = await client.query(
          'SELECT * FROM public.ventas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, ventaId],
        );
        if (vRes.rowCount === 0) throw new NotFoundException('Venta no encontrada.');
        const venta = vRes.rows[0];
        if (['reembolsada', 'cancelada'].includes(String(venta.estado))) {
          throw new BadRequestException('Esta venta ya fue reembolsada o cancelada.');
        }
        if (!['pagada', 'entregada'].includes(String(venta.estado)) || String(venta.estado_pago) !== 'aprobado') {
          throw new ConflictException('REFUND_REQUIRES_CONFIRMED_SALE: solo se devuelve una venta pagada con confirmacion registrada.');
        }
        const pagos = pagosRes.rows as any[];
        if (pagos.some((p) => ['pendiente', 'no_confirmado'].includes(String(p.estado)))) {
          throw new ConflictException('REFUND_PENDING_PAYMENT_ATTEMPT: concilia los intentos abiertos antes de devolver la venta.');
        }
        const aprobados = pagos.filter((p) => String(p.estado) === 'aprobado' && Boolean(p.confirmado_proveedor));
        if (aprobados.length !== 1) {
          throw new ConflictException('REFUND_PAYMENT_AMBIGUOUS: se requiere exactamente un pago confirmado para registrar la devolucion completa.');
        }
        const pago = aprobados[0];
        if (Math.round(Number(pago.monto) * 100) !== Math.round(Number(venta.total) * 100)) {
          throw new ConflictException('REFUND_AMOUNT_MISMATCH: el pago confirmado no coincide con el total de la venta.');
        }
        let modoReembolso: 'sandbox_simulado' | 'efectivo_registrado';
        if (String(pago.pasarela) === 'efectivo_pos') {
          modoReembolso = 'efectivo_registrado';
        } else if (['stripe_sandbox', 'libelula_sandbox'].includes(String(pago.pasarela))) {
          if (String(process.env.PAGOS_MODO || 'sandbox').toLowerCase() !== 'sandbox') {
            throw new ConflictException('REFUND_PROVIDER_NOT_CONFIGURED: no existe un adaptador de reembolso real habilitado.');
          }
          modoReembolso = 'sandbox_simulado';
        } else {
          throw new ConflictException('REFUND_PROVIDER_UNSUPPORTED: la pasarela no dispone de una ruta de reembolso implementada.');
        }

        const itemsRes = await client.query(
          'SELECT * FROM public.venta_items WHERE tenant_id = $1 AND venta_id = $2 ORDER BY variante_id',
          [tenant.tenantId, venta.id],
        );
        const refundKey = `refund-${String(pago.referencia_externa)}`;
        const estadoDevolucion = modoReembolso === 'sandbox_simulado' ? 'sandbox_simulado' : 'efectivo_registrado';
        const devIns = await client.query(
          `INSERT INTO public.devoluciones
             (tenant_id, venta_id, usuario_id, almacen_id, motivo, monto_reembolsado, estado)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [tenant.tenantId, venta.id, Number(req.user.sub), Number(venta.almacen_id), motivo, Number(venta.total), estadoDevolucion],
        );
        const devolucion = devIns.rows[0];

        for (const item of itemsRes.rows) {
          await client.query(
            `INSERT INTO public.devolucion_items (tenant_id, devolucion_id, variante_id, cantidad)
             VALUES ($1, $2, $3, $4)`,
            [tenant.tenantId, devolucion.id, item.variante_id, item.cantidad],
          );
          await InventarioCore.mover(client, {
            tenantId: tenant.tenantId,
            almacenId: Number(venta.almacen_id),
            varianteId: Number(item.variante_id),
            usuarioId: Number(req.user.sub),
            tipo: 'devolucion',
            deltaCantidad: Math.abs(Number(item.cantidad)),
            deltaReservado: 0,
            referencia: venta.numero_comprobante,
            motivo: `Reingreso por devolucion de ${venta.numero_comprobante}`,
          });
        }

        await client.query(
          `UPDATE public.pagos
              SET estado = 'reembolsado',
                  payload_proveedor = COALESCE(payload_proveedor, '{}'::jsonb) ||
                    jsonb_build_object('refund_mode', $3::text,
                                       'refund_idempotency_key', $4::text,
                                       'refund_reason', $5::text,
                                       'refund_recorded_at', NOW())
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, Number(pago.id), modoReembolso, refundKey, motivo],
        );
        await client.query(
          `UPDATE public.ventas
              SET estado = 'reembolsada', estado_pago = 'reembolsado', actualizado_en = NOW()
            WHERE tenant_id = $1 AND id = $2`,
          [tenant.tenantId, venta.id],
        );
        await client.query(
          `INSERT INTO public.saga_pago
             (tenant_id, operacion_id, venta_id, pago_id, estado, paso_actual, intentos,
              ultimo_error, datos_json, actualizado_en)
           VALUES ($1, $2, $3, $4, 'COMPENSADA', 'C3', 1, NULL,
                   jsonb_build_object('compensacion', $5::text, 'refund_idempotency_key', $6::text), NOW())
           ON CONFLICT (tenant_id, operacion_id) DO UPDATE SET
             estado = 'COMPENSADA', paso_actual = 'C3', intentos = saga_pago.intentos + 1,
             ultimo_error = NULL,
             datos_json = saga_pago.datos_json || EXCLUDED.datos_json,
             actualizado_en = NOW()`,
          [tenant.tenantId, String(pago.referencia_externa), venta.id, pago.id, modoReembolso, refundKey],
        );
        return {
          ...devolucion,
          modo_reembolso: modoReembolso,
          cobro_real_ejecutado: false,
          mensaje: modoReembolso === 'sandbox_simulado'
            ? 'Devolucion y compensacion registradas en sandbox; no hubo movimiento de dinero real ni llamada al proveedor.'
            : 'Reintegro de efectivo anotado por el operador; FashionStore no verifica la entrega fisica del efectivo.',
        };
      },
      { requireWrite: true },
    );
  }
}

@Module({
  controllers: [VentasController],
})
export class VentasModule {}
