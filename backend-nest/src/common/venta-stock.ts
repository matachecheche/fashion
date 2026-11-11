import { PoolClient } from 'pg';
import { InventarioCore } from './inventario-core';

export interface ItemVentaStock {
  variante_id: number;
  cantidad: number;
}

export class VentaStockHelper {
  static async descontarVentaDirecta(
    client: PoolClient,
    tenantId: string,
    almacenId: number,
    usuarioId: number | null,
    referencia: string,
    items: ItemVentaStock[],
  ) {
    // Ordenar por variante_id para evitar deadlocks en transacciones concurrentes
    const ordenados = [...items].sort((a, b) => Number(a.variante_id) - Number(b.variante_id));
    for (const item of ordenados) {
      await InventarioCore.mover(client, {
        tenantId,
        almacenId,
        varianteId: Number(item.variante_id),
        usuarioId,
        tipo: 'venta',
        deltaCantidad: -Math.abs(Number(item.cantidad)),
        deltaReservado: 0,
        referencia,
        motivo: `Venta ${referencia}`,
      });
    }
  }

  static async retenerPorPagoPendiente(
    client: PoolClient,
    tenantId: string,
    almacenId: number,
    usuarioId: number | null,
    referencia: string,
    items: ItemVentaStock[],
  ) {
    const ordenados = [...items].sort((a, b) => Number(a.variante_id) - Number(b.variante_id));
    for (const item of ordenados) {
      await InventarioCore.mover(client, {
        tenantId,
        almacenId,
        varianteId: Number(item.variante_id),
        usuarioId,
        tipo: 'reserva',
        deltaCantidad: 0,
        deltaReservado: Math.abs(Number(item.cantidad)),
        referencia,
        motivo: `Retencion temporal por pago en curso ${referencia}`,
      });
    }
  }

  static async confirmarPagoRetenido(
    client: PoolClient,
    tenantId: string,
    almacenId: number,
    usuarioId: number | null,
    referencia: string,
    items: ItemVentaStock[],
  ) {
    const ordenados = [...items].sort((a, b) => Number(a.variante_id) - Number(b.variante_id));
    for (const item of ordenados) {
      const qty = Math.abs(Number(item.cantidad));
      await InventarioCore.mover(client, {
        tenantId,
        almacenId,
        varianteId: Number(item.variante_id),
        usuarioId,
        tipo: 'venta',
        deltaCantidad: -qty,
        deltaReservado: -qty,
        referencia,
        motivo: `Confirmacion de pago ${referencia}`,
      });
    }
  }

  static async liberarRetencion(
    client: PoolClient,
    tenantId: string,
    almacenId: number,
    usuarioId: number | null,
    referencia: string,
    items: ItemVentaStock[],
  ) {
    const ordenados = [...items].sort((a, b) => Number(a.variante_id) - Number(b.variante_id));
    for (const item of ordenados) {
      const qty = Math.abs(Number(item.cantidad));
      await InventarioCore.mover(client, {
        tenantId,
        almacenId,
        varianteId: Number(item.variante_id),
        usuarioId,
        tipo: 'liberacion',
        deltaCantidad: 0,
        deltaReservado: -qty,
        referencia,
        motivo: `Liberacion de stock retenido ${referencia}`,
      });
    }
  }
}
