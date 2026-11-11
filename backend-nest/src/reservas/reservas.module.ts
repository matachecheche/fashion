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
import { calcularOfflinePayloadHash } from '../common/offline-hash';
import { Notificador } from '../common/notificador';
import { generarCodigo } from '../common/util';

@Controller('reservas')
@UseGuards(JwtTenantGuard)
export class ReservasController {
  @Post()
  async crearReserva(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const sucursalId = Number(body?.sucursal_id || 1);
    const items = Array.isArray(body?.items) ? body.items : [];
    const offlineId = body?.operacion_offline_id ? String(body.operacion_offline_id).trim() : null;

    if (!sucursalId || items.length === 0) {
      throw new BadRequestException('Debe seleccionar sucursal y al menos una prenda para reservar.');
    }

    const payloadCanonic = {
      sucursal_id: sucursalId,
      items: items.map((i: any) => ({
        variante_id: Number(i.variante_id),
        cantidad: Number(i.cantidad),
      })),
    };
    const payloadHash = calcularOfflinePayloadHash(payloadCanonic);

    return Db.tx(
      async (client) => {
        // Idempotencia si proviene de cola offline o reintento de red
        if (offlineId) {
          const prev = await client.query(
            'SELECT * FROM public.operaciones_offline WHERE tenant_id = $1 AND id = $2 LIMIT 1',
            [tenant.tenantId, offlineId],
          );
          if (prev.rowCount > 0) {
            const op = prev.rows[0];
            if (op.payload_hash !== payloadHash) {
              throw new ConflictException(
                'IDEMPOTENCY_PAYLOAD_MISMATCH: La clave idempotente ya fue utilizada con parametros distintos.',
              );
            }
            return { ...op.respuesta_json, idempotent_replay: true };
          }
        }

        const almRes = await client.query(
          'SELECT id FROM public.almacenes WHERE tenant_id = $1 AND sucursal_id = $2 AND activo = TRUE ORDER BY es_principal DESC, id ASC LIMIT 1',
          [tenant.tenantId, sucursalId],
        );
        if (almRes.rowCount === 0) {
          throw new BadRequestException('La sucursal seleccionada no tiene almacen activo en esta tienda.');
        }
        const almacenId = Number(almRes.rows[0].id);
        const codigo = generarCodigo('RES');
        const fechaCita = body?.fecha_cita ? new Date(body.fecha_cita) : new Date(Date.now() + 4 * 3600000);
        const expiraEn = new Date(Date.now() + 24 * 3600000);

        if (offlineId) {
          await client.query(
            `
            INSERT INTO public.operaciones_offline
              (id, tenant_id, tipo, usuario_id, sucursal_id, payload_hash, payload_json, estado)
            VALUES ($1, $2, 'reserva', $3, $4, $5, $6::jsonb, 'pendiente')
            `,
            [offlineId, tenant.tenantId, Number(req.user.sub), sucursalId, payloadHash, JSON.stringify(payloadCanonic)],
          );
        }

        const resIns = await client.query(
          `
          INSERT INTO public.reservas
            (tenant_id, codigo, usuario_id, sucursal_id, almacen_id, estado, fecha_cita, expira_en, notas, operacion_offline_id, payload_hash, origen)
          VALUES ($1, $2, $3, $4, $5, 'pendiente', $6, $7, $8, $9, $10, $11)
          RETURNING *
          `,
          [
            tenant.tenantId,
            codigo,
            Number(req.user.sub),
            sucursalId,
            almacenId,
            fechaCita.toISOString(),
            expiraEn.toISOString(),
            String(body?.notas || ''),
            offlineId,
            payloadHash,
            offlineId ? 'offline_movil' : 'web',
          ],
        );
        const reserva = resIns.rows[0];

        const detalleRows = [];
        const sortedItems = [...items].sort((a, b) => Number(a.variante_id) - Number(b.variante_id));
        for (const item of sortedItems) {
          const varianteId = Number(item.variante_id);
          const qty = Math.abs(Number(item.cantidad || 1));

          const vInfo = await client.query(
            `
            SELECT v.id, v.sku, (p.precio_base + v.precio_adicional) AS precio_final
              FROM public.variantes v
              JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
             WHERE v.tenant_id = $1 AND v.id = $2
            `,
            [tenant.tenantId, varianteId],
          );
          if (vInfo.rowCount === 0) {
            throw new NotFoundException(`Variante ${varianteId} no existe en esta tienda.`);
          }

          await InventarioCore.mover(client, {
            tenantId: tenant.tenantId,
            almacenId,
            varianteId,
            usuarioId: Number(req.user.sub),
            tipo: 'reserva',
            deltaCantidad: 0,
            deltaReservado: qty,
            referencia: codigo,
            motivo: `Reserva de prenda ${codigo}`,
          });

          const dIns = await client.query(
            `
            INSERT INTO public.detalle_reserva (tenant_id, reserva_id, variante_id, cantidad, precio_unitario)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `,
            [tenant.tenantId, reserva.id, varianteId, qty, Number(vInfo.rows[0].precio_final)],
          );
          detalleRows.push(dIns.rows[0]);
        }

        await Notificador.enviar(client, {
          tenantId: tenant.tenantId,
          usuarioId: Number(req.user.sub),
          titulo: `Reserva ${codigo} registrada`,
          mensaje: `Tu reserva en sucursal fue registrada con exito. Codigo de atencion: ${codigo}.`,
          tipo: 'reserva',
          referenciaUrl: '/mis-reservas',
        });

        const respuesta = { ...reserva, items: detalleRows };
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

  @Get('mias')
  async listarMisReservas(@Req() req: any) {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT
        r.*,
        s.nombre AS sucursal_nombre,
        s.direccion AS sucursal_direccion,
        COALESCE(
          JSON_AGG(
            JSONB_BUILD_OBJECT(
              'id', dr.id,
              'variante_id', dr.variante_id,
              'sku', v.sku,
              'talla', v.talla,
              'color', v.color,
              'producto_nombre', p.nombre,
              'foto_url', COALESCE(v.foto_url, p.imagen_url),
              'cantidad', dr.cantidad,
              'precio_unitario', dr.precio_unitario
            )
          ) FILTER (WHERE dr.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM public.reservas r
      JOIN public.sucursales s ON s.tenant_id = r.tenant_id AND s.id = r.sucursal_id
      LEFT JOIN public.detalle_reserva dr ON dr.tenant_id = r.tenant_id AND dr.reserva_id = r.id
      LEFT JOIN public.variantes v ON v.tenant_id = dr.tenant_id AND v.id = dr.variante_id
      LEFT JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
      WHERE r.tenant_id = $1 AND r.usuario_id = $2
      GROUP BY r.id, s.nombre, s.direccion
      ORDER BY r.id DESC
      `,
      [tenant.tenantId, Number(req.user.sub)],
    );
  }

  @Roles('admin', 'encargado', 'cajero')
  @Get()
  async listarTodasReservas() {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT
        r.*,
        u.nombre AS cliente_nombre,
        u.email AS cliente_email,
        s.nombre AS sucursal_nombre,
        COALESCE(
          JSON_AGG(
            JSONB_BUILD_OBJECT(
              'variante_id', dr.variante_id,
              'sku', v.sku,
              'talla', v.talla,
              'color', v.color,
              'producto_nombre', p.nombre,
              'cantidad', dr.cantidad,
              'precio_unitario', dr.precio_unitario
            )
          ) FILTER (WHERE dr.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM public.reservas r
      JOIN public.usuarios u ON u.tenant_id = r.tenant_id AND u.id = r.usuario_id
      JOIN public.sucursales s ON s.tenant_id = r.tenant_id AND s.id = r.sucursal_id
      LEFT JOIN public.detalle_reserva dr ON dr.tenant_id = r.tenant_id AND dr.reserva_id = r.id
      LEFT JOIN public.variantes v ON v.tenant_id = dr.tenant_id AND v.id = dr.variante_id
      LEFT JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
      WHERE r.tenant_id = $1
      GROUP BY r.id, u.nombre, u.email, s.nombre
      ORDER BY r.id DESC
      `,
      [tenant.tenantId],
    );
  }

  @Get('codigo/:codigo')
  async buscarPorCodigo(@Param('codigo') codigo: string) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      SELECT r.*, u.nombre AS cliente_nombre, s.nombre AS sucursal_nombre
        FROM public.reservas r
        JOIN public.usuarios u ON u.tenant_id = r.tenant_id AND u.id = r.usuario_id
        JOIN public.sucursales s ON s.tenant_id = r.tenant_id AND s.id = r.sucursal_id
       WHERE r.tenant_id = $1 AND UPPER(r.codigo) = UPPER($2)
       LIMIT 1
      `,
      [tenant.tenantId, codigo.trim()],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Reserva no encontrada en esta tienda.');
    }
    return rows[0];
  }

  @Roles('admin', 'encargado', 'cajero')
  @Post(':id/preparar')
  async marcarPreparada(@Param('id') id: string, @Req() req: any) {
    return this._cambiarEstadoReserva(Number(id), Number(req.user.sub), 'preparada');
  }

  @Roles('admin', 'encargado', 'cajero')
  @Post(':id/confirmar-atencion')
  async confirmarAtencion(@Param('id') id: string, @Req() req: any) {
    return this._cambiarEstadoReserva(Number(id), Number(req.user.sub), 'en_atencion');
  }

  @Roles('admin', 'encargado', 'cajero')
  @Post(':id/finalizar')
  async finalizarReserva(@Param('id') id: string, @Req() req: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const rRes = await client.query(
          'SELECT * FROM public.reservas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, Number(id)],
        );
        if (rRes.rowCount === 0) throw new NotFoundException('Reserva no encontrada.');
        const r = rRes.rows[0];
        if (['cancelada', 'vencida', 'finalizada'].includes(r.estado)) {
          throw new BadRequestException(`No se puede finalizar una reserva en estado ${r.estado}.`);
        }

        const det = await client.query(
          'SELECT * FROM public.detalle_reserva WHERE tenant_id = $1 AND reserva_id = $2',
          [tenant.tenantId, r.id],
        );
        for (const item of det.rows) {
          const qty = Number(item.cantidad);
          await InventarioCore.mover(client, {
            tenantId: tenant.tenantId,
            almacenId: Number(r.almacen_id),
            varianteId: Number(item.variante_id),
            usuarioId: Number(req.user.sub),
            tipo: 'venta',
            deltaCantidad: -qty,
            deltaReservado: -qty,
            referencia: r.codigo,
            motivo: `Conversion de reserva ${r.codigo} en atencion finalizada`,
          });
        }

        const upd = await client.query(
          `
          UPDATE public.reservas
             SET estado = 'finalizada', atendido_por_id = $3, actualizado_en = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *
          `,
          [tenant.tenantId, r.id, Number(req.user.sub)],
        );
        return upd.rows[0];
      },
      { requireWrite: true },
    );
  }

  @Post(':id/cancelar')
  async cancelarReserva(@Param('id') id: string, @Req() req: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const rRes = await client.query(
          'SELECT * FROM public.reservas WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
          [tenant.tenantId, Number(id)],
        );
        if (rRes.rowCount === 0) throw new NotFoundException('Reserva no encontrada.');
        const r = rRes.rows[0];
        if (req.user.rol === 'cliente' && Number(r.usuario_id) !== Number(req.user.sub)) {
          throw new ConflictException('No tiene permiso para cancelar la reserva de otro cliente.');
        }
        if (['cancelada', 'vencida', 'finalizada'].includes(r.estado)) {
          return r;
        }

        const det = await client.query(
          'SELECT * FROM public.detalle_reserva WHERE tenant_id = $1 AND reserva_id = $2',
          [tenant.tenantId, r.id],
        );
        for (const item of det.rows) {
          await InventarioCore.mover(client, {
            tenantId: tenant.tenantId,
            almacenId: Number(r.almacen_id),
            varianteId: Number(item.variante_id),
            usuarioId: Number(req.user.sub),
            tipo: 'liberacion',
            deltaCantidad: 0,
            deltaReservado: -Math.abs(Number(item.cantidad)),
            referencia: r.codigo,
            motivo: `Liberacion por cancelacion de reserva ${r.codigo}`,
          });
        }

        const upd = await client.query(
          `
          UPDATE public.reservas
             SET estado = 'cancelada', actualizado_en = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *
          `,
          [tenant.tenantId, r.id],
        );
        return upd.rows[0];
      },
      { requireWrite: true },
    );
  }

  @Roles('admin', 'encargado')
  @Post('liberar-vencidas')
  async liberarReservasVencidas(@Req() req: any) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const vencidas = await client.query(
          `
          SELECT * FROM public.reservas
           WHERE tenant_id = $1
             AND estado IN ('pendiente', 'preparada')
             AND expira_en <= NOW()
           FOR UPDATE
          `,
          [tenant.tenantId],
        );

        const liberadas: string[] = [];
        for (const r of vencidas.rows) {
          const det = await client.query(
            'SELECT * FROM public.detalle_reserva WHERE tenant_id = $1 AND reserva_id = $2',
            [tenant.tenantId, r.id],
          );
          for (const item of det.rows) {
            await InventarioCore.mover(client, {
              tenantId: tenant.tenantId,
              almacenId: Number(r.almacen_id),
              varianteId: Number(item.variante_id),
              usuarioId: Number(req.user.sub),
              tipo: 'liberacion',
              deltaCantidad: 0,
              deltaReservado: -Math.abs(Number(item.cantidad)),
              referencia: r.codigo,
              motivo: `Liberacion automatica de reserva vencida ${r.codigo}`,
            });
          }
          await client.query(
            `UPDATE public.reservas SET estado = 'vencida', actualizado_en = NOW() WHERE tenant_id = $1 AND id = $2`,
            [tenant.tenantId, r.id],
          );
          liberadas.push(r.codigo);
        }
        return { liberadas_count: liberadas.length, codigos: liberadas };
      },
      { requireWrite: true },
    );
  }

  private async _cambiarEstadoReserva(id: number, actorId: number, nuevoEstado: string) {
    const tenant = TenantContext.require();
    return Db.tx(
      async (client) => {
        const upd = await client.query(
          `
          UPDATE public.reservas
             SET estado = $3, atendido_por_id = $4, actualizado_en = NOW()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *
          `,
          [tenant.tenantId, id, nuevoEstado, actorId],
        );
        if (upd.rowCount === 0) throw new NotFoundException('Reserva no encontrada.');
        const r = upd.rows[0];
        await Notificador.enviar(client, {
          tenantId: tenant.tenantId,
          usuarioId: Number(r.usuario_id),
          titulo: `Reserva ${r.codigo} actualizada a ${nuevoEstado}`,
          mensaje: `El estado de tu reserva ${r.codigo} ahora es: ${nuevoEstado}.`,
          tipo: 'reserva',
          referenciaUrl: '/mis-reservas',
        });
        return r;
      },
      { requireWrite: true },
    );
  }
}

@Module({
  controllers: [ReservasController],
})
export class ReservasModule {}
