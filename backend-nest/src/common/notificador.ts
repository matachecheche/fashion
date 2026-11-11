import { PoolClient } from 'pg';

export class Notificador {
  static async enviar(
    client: PoolClient,
    params: {
      tenantId: string;
      usuarioId: number;
      titulo: string;
      mensaje: string;
      tipo?: string;
      referenciaUrl?: string;
    },
  ) {
    await client.query(
      `
      INSERT INTO public.notificaciones (tenant_id, usuario_id, titulo, mensaje, tipo, referencia_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        params.tenantId,
        params.usuarioId,
        params.titulo,
        params.mensaje,
        params.tipo || 'info',
        params.referenciaUrl || null,
      ],
    );
  }
}
