import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { PoolClient } from 'pg';
import { TenantContext } from '../common/tenant-context';
import { VentasController } from '../ventas/ventas.module';
import { ReservasController } from '../reservas/reservas.module';

async function guardarResolucionConflicto(
  client: PoolClient,
  input: {
    tenantId: string;
    operationId: string;
    tipo: string;
    estado: 'PENDIENTE' | 'RESUELTO' | 'DESCARTADO';
    regla: string;
    payloadLocal: unknown;
    payloadServidor: unknown;
    resolucion: string | null;
    actorId: number;
  },
) {
  await client.query(
    `INSERT INTO public.conflictos_sync
       (tenant_id, operacion_id, tipo, estado, regla, payload_local, payload_servidor,
        resolucion, resuelto_por, resuelto_en)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9,
             CASE WHEN $4::varchar = 'PENDIENTE' THEN NULL ELSE NOW() END)
     ON CONFLICT (tenant_id, operacion_id) DO UPDATE SET
       tipo = EXCLUDED.tipo,
       estado = EXCLUDED.estado,
       regla = EXCLUDED.regla,
       payload_local = EXCLUDED.payload_local,
       payload_servidor = EXCLUDED.payload_servidor,
       resolucion = EXCLUDED.resolucion,
       resuelto_por = CASE WHEN EXCLUDED.estado = 'PENDIENTE' THEN NULL ELSE EXCLUDED.resuelto_por END,
       resuelto_en = CASE WHEN EXCLUDED.estado = 'PENDIENTE' THEN NULL ELSE NOW() END`,
    [
      input.tenantId,
      input.operationId,
      input.tipo,
      input.estado,
      input.regla,
      JSON.stringify(input.payloadLocal ?? {}),
      JSON.stringify(input.payloadServidor ?? {}),
      input.resolucion,
      input.actorId,
    ],
  );
}

@Controller('sync')
export class SyncController {
  @Get('pull')
  async pullIncremental(
    @Query('cursor') cursorRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('sucursal_id') sucursalRaw?: string,
  ) {
    const tenant = TenantContext.require();
    const cursor = Math.max(0, Number(cursorRaw || 0));
    const limit = Math.min(500, Math.max(1, Number(limitRaw || 100)));
    const sucursalId = sucursalRaw ? Number(sucursalRaw) : null;

    return Db.tx(async (client) => {
      const feedRes = await client.query(
        `
        SELECT seq, entidad, entidad_id, accion, payload_json, actualizado_en
          FROM public.catalogo_cambios_feed
         WHERE tenant_id = $1 AND seq > $2
         ORDER BY seq ASC
         LIMIT $3
        `,
        [tenant.tenantId, cursor, limit],
      );

      const maxSeqRes = await client.query(
        'SELECT COALESCE(MAX(seq), 0)::bigint AS max_seq FROM public.catalogo_cambios_feed WHERE tenant_id = $1',
        [tenant.tenantId],
      );
      const serverMaxSeq = Number(maxSeqRes.rows[0]?.max_seq ?? 0);

      let snapshot: any = null;
      if (cursor === 0) {
        const categorias = await client.query(
          'SELECT id, nombre, slug, descripcion FROM public.categorias WHERE tenant_id = $1 AND activa = TRUE ORDER BY id ASC',
          [tenant.tenantId],
        );
        const productos = await client.query(
          `
          SELECT id, codigo, nombre, descripcion, categoria_id, tipo_prenda, precio_base, imagen_url, ar_overlay_url, actualizado_en
            FROM public.productos
           WHERE tenant_id = $1 AND activo = TRUE
           ORDER BY id ASC
          `,
          [tenant.tenantId],
        );
        const variantes = await client.query(
          `
          SELECT v.id, v.producto_id, v.sku, v.talla, v.color, v.color_hex, v.precio_adicional,
                 (p.precio_base + v.precio_adicional) AS precio_final,
                 COALESCE(v.foto_url, p.imagen_url) AS foto_url,
                 COALESCE(v.ar_url, p.ar_overlay_url) AS ar_url,
                 v.creado_en
            FROM public.variantes v
            JOIN public.productos p ON p.tenant_id = v.tenant_id AND p.id = v.producto_id
           WHERE v.tenant_id = $1 AND v.activa = TRUE AND p.activo = TRUE
           ORDER BY v.id ASC
          `,
          [tenant.tenantId],
        );
        const stockSucursal = await client.query(
          `
          SELECT sucursal_id, sucursal_nombre, variante_id, sku,
                 cantidad AS stock_fisico,
                 reservado AS stock_reservado,
                 disponible AS stock_disponible
            FROM public.disponibilidad_sucursal
           WHERE tenant_id = $1
             AND ($2::int IS NULL OR sucursal_id = $2::int)
           ORDER BY sucursal_id ASC, variante_id ASC
          `,
          [tenant.tenantId, sucursalId],
        );
        const promociones = await client.query(
          `
          SELECT id, codigo, nombre, tipo_descuento, valor, minimo_compra, termina_en
            FROM public.promociones
           WHERE tenant_id = $1 AND activa = TRUE AND termina_en >= NOW()
           ORDER BY id ASC
          `,
          [tenant.tenantId],
        );

        snapshot = {
          categorias: categorias.rows,
          productos: productos.rows.map((p) => ({ ...p, precio_base: Number(p.precio_base) })),
          variantes: variantes.rows.map((v) => ({
            ...v,
            precio_adicional: Number(v.precio_adicional),
            precio_final: Number(v.precio_final),
          })),
          disponibilidad: stockSucursal.rows.map((s) => ({
            ...s,
            stock_fisico: Number(s.stock_fisico),
            stock_reservado: Number(s.stock_reservado),
            stock_disponible: Number(s.stock_disponible),
          })),
          promociones: promociones.rows.map((pr) => ({
            ...pr,
            valor: Number(pr.valor),
            minimo_compra: Number(pr.minimo_compra),
          })),
        };
      }

      const cambios = feedRes.rows.map((r) => ({
        seq: Number(r.seq),
        entidad: r.entidad,
        entidad_id: r.entidad_id,
        accion: r.accion,
        payload: r.payload_json,
        creado_en: r.actualizado_en,
      }));

      const nextCursor = cambios.length > 0 ? cambios[cambios.length - 1].seq : cursor === 0 ? serverMaxSeq : cursor;

      return {
        tenant_id: tenant.tenantId,
        tenant_slug: tenant.tenantSlug,
        cursor_recibido: cursor,
        next_cursor: nextCursor,
        server_max_cursor: serverMaxSeq,
        has_more: cambios.length === limit && nextCursor < serverMaxSeq,
        cambios,
        snapshot,
        sincronizado_en: new Date().toISOString(),
      };
    });
  }

  @UseGuards(JwtTenantGuard)
  @Post('push')
  async pushLote(@Req() req: any, @Body() body: any) {
    const raw = Array.isArray(body?.operaciones) ? body.operaciones : [];
    if (raw.length > 100) {
      return {
        total_procesadas: 0,
        sincronizadas: 0,
        conflictos: 0,
        rechazadas: raw.length,
        resultados: raw.map((op: any) => ({
          id: String(op?.id || op?.operacion_id || ''),
          estado: 'rechazada',
          codigo_error: 'BATCH_TOO_LARGE',
          detalle: 'El lote supera el máximo de 100 operaciones.',
        })),
      };
    }

    const operaciones = [...raw].sort((a: any, b: any) => {
      const aTime = Date.parse(String(a?.creado_en || a?.payload?.creado_en || '')) || 0;
      const bTime = Date.parse(String(b?.creado_en || b?.payload?.creado_en || '')) || 0;
      return aTime - bTime;
    });
    const ventas = new VentasController();
    const reservas = new ReservasController();
    const resultados: Array<Record<string, any>> = [];

    for (const op of operaciones) {
      const payload = op?.payload && typeof op.payload === 'object' ? op.payload : op;
      const id = String(op?.operacion_id || op?.id || payload?.operacion_offline_id || '').trim();
      const tipo = String(op?.tipo || payload?.tipo || '').trim().toLowerCase();
      if (!id || id.length > 80) {
        resultados.push({
          id: id || null,
          estado: 'rechazada',
          codigo_error: 'INVALID_OPERATION_ID',
          detalle: 'Cada operación requiere un identificador idempotente válido de hasta 80 caracteres.',
        });
        continue;
      }

      try {
        if (['venta', 'venta_pos', 'pos'].includes(tipo)) {
          const response = await ventas.sincronizarLoteOffline(req, {
            operaciones: [{ ...payload, id, operacion_offline_id: id, origen: 'offline_pos' }],
          });
          resultados.push(response.resultados?.[0] || {
            id,
            estado: 'error',
            codigo_error: 'EMPTY_SYNC_RESULT',
            detalle: 'El servidor no devolvió resultado para esta operación.',
          });
          continue;
        }

        if (['reserva', 'booking'].includes(tipo)) {
          const result = await reservas.crearReserva(req, {
            ...payload,
            operacion_offline_id: id,
            origen: 'offline_movil',
          });
          resultados.push({ id, estado: 'sincronizada', resultado: result });
          continue;
        }

        resultados.push({
          id,
          estado: 'rechazada',
          codigo_error: 'UNSUPPORTED_OPERATION',
          detalle: `Tipo de operación no soportado: ${tipo || 'vacío'}.`,
        });
      } catch (err: any) {
        const status = typeof err?.getStatus === 'function' ? err.getStatus() : Number(err?.status || 500);
        const detalle = String(err?.message || 'No se pudo aplicar la operación.');
        const estado = status === 409 || detalle.includes('STOCK_INSUFICIENTE')
          ? 'conflicto'
          : status >= 500 || status === 429
            ? 'error'
            : 'rechazada';
        resultados.push({
          id,
          estado,
          codigo_error: estado === 'conflicto' ? 'CONFLICT' : estado === 'error' ? 'TEMPORARY_SYNC_ERROR' : 'SYNC_OPERATION_FAILED',
          detalle,
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

  @UseGuards(JwtTenantGuard)
  @Get('operaciones')
  async listarOperacionesOffline(@Req() req: any) {
    const tenant = TenantContext.require();
    const esAdminOEncargado = ['admin', 'encargado'].includes(req.user.rol);
    return Db.query(
      `
      SELECT o.*, c.estado AS estado_resolucion, c.resolucion, c.resuelto_en, c.resuelto_por
        FROM public.operaciones_offline o
        LEFT JOIN public.conflictos_sync c
          ON c.tenant_id = o.tenant_id AND c.operacion_id = o.id
       WHERE o.tenant_id = $1
         AND ($2::boolean = TRUE OR o.usuario_id = $3)
       ORDER BY o.creado_en DESC
       LIMIT 100
      `,
      [tenant.tenantId, esAdminOEncargado, Number(req.user.sub)],
    );
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('resolver-conflicto')
  async resolverConflictoOffline(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const operationId = String(body?.operacion_id || '').trim();
    const accion = String(body?.accion || '').trim().toLowerCase();
    if (!operationId || operationId.length > 80) {
      throw new BadRequestException('Indique una operacion_id valida de hasta 80 caracteres.');
    }
    if (!['reintentar', 'descartar'].includes(accion)) {
      throw new BadRequestException('La accion debe ser reintentar o descartar.');
    }
    const found = await Db.query(
      `SELECT * FROM public.operaciones_offline WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [tenant.tenantId, operationId],
    );
    if (!found.length) throw new NotFoundException('Operacion offline no encontrada en esta tienda.');
    const operation: any = found[0];
    const actorId = Number(req.user.sub);
    const nota = String(body?.nota_resolucion || '').trim().slice(0, 500);

    if (accion === 'descartar') {
      return Db.tx(async (client) => {
        const locked = await client.query(
          `SELECT * FROM public.operaciones_offline
            WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [tenant.tenantId, operationId],
        );
        if (!locked.rowCount) throw new NotFoundException('Operacion offline no encontrada en esta tienda.');
        const current = locked.rows[0];
        if (!['conflicto', 'rechazada'].includes(String(current.estado))) {
          throw new ConflictException(`OFFLINE_OPERATION_NOT_DISCARDABLE: estado actual ${current.estado}.`);
        }
        const detalle = nota || `Descartada por ${req.user.rol} (${actorId}) desde el panel de sincronizacion.`;
        const updated = await client.query(
          `UPDATE public.operaciones_offline
              SET estado = 'rechazada', motivo_error = $3, procesado_en = NOW()
            WHERE tenant_id = $1 AND id = $2
            RETURNING *`,
          [tenant.tenantId, operationId, detalle],
        );
        await guardarResolucionConflicto(client, {
          tenantId: tenant.tenantId,
          operationId,
          tipo: String(current.tipo || 'desconocido'),
          estado: 'DESCARTADO',
          regla: 'OPERADOR_DESCARTA_OPERACION',
          payloadLocal: current.payload_json || {},
          payloadServidor: { nota: detalle },
          resolucion: 'DESCARTAR',
          actorId,
        });
        return updated.rows[0];
      }, { requireWrite: true });
    }

    if (String(operation.estado) !== 'conflicto' || String(operation.codigo_conflicto) !== 'STOCK_INSUFICIENTE') {
      throw new ConflictException('OFFLINE_RETRY_UNSUPPORTED: solo se pueden reintentar conflictos de venta por stock insuficiente.');
    }
    if (!['venta', 'venta_pos', 'pos'].includes(String(operation.tipo || '').toLowerCase())) {
      throw new ConflictException('OFFLINE_RETRY_UNSUPPORTED: el tipo de operación no es una venta POS reintentable.');
    }
    const payload = typeof operation.payload_json === 'string'
      ? JSON.parse(operation.payload_json)
      : operation.payload_json;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.items)) {
      throw new ConflictException('OFFLINE_PAYLOAD_INVALID: el payload almacenado no se puede reintentar.');
    }

    const ventas = new VentasController();
    try {
      const venta = await ventas.crearVenta(req, {
        ...payload,
        operacion_offline_id: operationId,
        origen: 'offline_pos',
      }, true);
      await Db.tx(async (client) => {
        await guardarResolucionConflicto(client, {
          tenantId: tenant.tenantId,
          operationId,
          tipo: String(operation.tipo || 'venta'),
          estado: 'RESUELTO',
          regla: 'REINTENTO_CON_STOCK_ACTUAL',
          payloadLocal: payload,
          payloadServidor: { venta_id: Number((venta as any)?.id || 0) || null },
          resolucion: 'REINTENTAR',
          actorId,
        });
      }, { requireWrite: true });
      return { operacion_id: operationId, estado: 'sincronizada', venta };
    } catch (error: any) {
      const status = typeof error?.getStatus === 'function' ? error.getStatus() : Number(error?.status || 500);
      const detail = String(error?.message || 'No se pudo reintentar la venta offline.').slice(0, 500);
      const sigueEnConflicto = detail.includes('STOCK_INSUFICIENTE') || status >= 500 || status === 429;
      await Db.query(
        `UPDATE public.operaciones_offline
            SET estado = $3, codigo_conflicto = $4, motivo_error = $5, procesado_en = NOW()
          WHERE tenant_id = $1 AND id = $2`,
        [
          tenant.tenantId,
          operationId,
          sigueEnConflicto ? 'conflicto' : 'rechazada',
          sigueEnConflicto ? 'STOCK_INSUFICIENTE' : 'RESOLUCION_FALLIDA',
          detail,
        ],
      );
      await Db.tx(async (client) => {
        await guardarResolucionConflicto(client, {
          tenantId: tenant.tenantId,
          operationId,
          tipo: String(operation.tipo || 'venta'),
          estado: 'PENDIENTE',
          regla: 'REINTENTO_CON_STOCK_ACTUAL',
          payloadLocal: payload,
          payloadServidor: { error: detail },
          resolucion: null,
          actorId,
        });
      }, { requireWrite: true });
      throw error;
    }
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('ack-conflicto')
  async reconocerConflictoOffline(@Body() body: any) {
    const tenant = TenantContext.require();
    const opId = String(body?.operacion_id || '').trim();
    const rows = await Db.query(
      `
      UPDATE public.operaciones_offline
         SET motivo_error = COALESCE($3, motivo_error),
             procesado_en = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *
      `,
      [tenant.tenantId, opId, body?.nota_resolucion || null],
    );
    return rows[0] || { ok: true };
  }
}

@Module({
  controllers: [SyncController],
})
export class SyncModule {}
