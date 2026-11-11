import { BadRequestException, ConflictException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface MovimientoStockInput {
  tenantId: string;
  almacenId: number;
  varianteId: number;
  usuarioId?: number | null;
  tipo:
    | 'entrada'
    | 'salida'
    | 'reserva'
    | 'liberacion'
    | 'venta'
    | 'devolucion'
    | 'ajuste'
    | 'transferencia'
    | 'recepcion';
  deltaCantidad: number;
  deltaReservado: number;
  referencia?: string;
  motivo?: string;
}

export class InventarioCore {
  static async mover(client: PoolClient, input: MovimientoStockInput) {
    // Bloqueo pesimista sobre la fila de stock para evitar condiciones de carrera y sobreventa
    let res = await client.query(
      `
      SELECT id, cantidad, reservado, stock_minimo
        FROM public.stock
       WHERE tenant_id = $1 AND almacen_id = $2 AND variante_id = $3
       FOR UPDATE
      `,
      [input.tenantId, input.almacenId, input.varianteId],
    );

    if (res.rowCount === 0) {
      if (input.deltaCantidad < 0 || input.deltaReservado < 0) {
        throw new ConflictException(
          `STOCK_INSUFICIENTE: La variante ${input.varianteId} no tiene stock registrado en el almacen ${input.almacenId}.`,
        );
      }
      res = await client.query(
        `
        INSERT INTO public.stock (tenant_id, almacen_id, variante_id, cantidad, reservado, stock_minimo)
        VALUES ($1, $2, $3, 0, 0, 3)
        RETURNING id, cantidad, reservado, stock_minimo
        `,
        [input.tenantId, input.almacenId, input.varianteId],
      );
    }

    const row = res.rows[0];
    const nuevaCantidad = Number(row.cantidad) + Number(input.deltaCantidad);
    const nuevoReservado = Number(row.reservado) + Number(input.deltaReservado);
    const nuevoDisponible = nuevaCantidad - nuevoReservado;

    if (nuevaCantidad < 0 || nuevoReservado < 0 || nuevoDisponible < 0) {
      throw new ConflictException(
        `STOCK_INSUFICIENTE: Stock insuficiente para variante ${input.varianteId} (actual=${row.cantidad}, reservado=${row.reservado}, disponible=${Number(row.cantidad) - Number(row.reservado)}).`,
      );
    }

    const upd = await client.query(
      `
      UPDATE public.stock
         SET cantidad = $1,
             reservado = $2,
             actualizado_en = NOW()
       WHERE id = $3 AND tenant_id = $4
       RETURNING id, almacen_id, variante_id, cantidad, reservado, (cantidad - reservado) AS disponible, stock_minimo
      `,
      [nuevaCantidad, nuevoReservado, row.id, input.tenantId],
    );

    const magnitud = Math.max(Math.abs(input.deltaCantidad), Math.abs(input.deltaReservado), 1);
    await client.query(
      `
      INSERT INTO public.movimientos_inventario
        (tenant_id, almacen_id, variante_id, usuario_id, tipo, cantidad, saldo_cantidad, saldo_reservado, referencia, motivo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        input.tenantId,
        input.almacenId,
        input.varianteId,
        input.usuarioId || null,
        input.tipo,
        magnitud,
        nuevaCantidad,
        nuevoReservado,
        input.referencia || null,
        input.motivo || null,
      ],
    );

    return upd.rows[0];
  }
}
