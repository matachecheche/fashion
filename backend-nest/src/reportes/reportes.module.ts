import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import PDFDocument = require('pdfkit');
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { invocarFastApi } from '../ia/ia.module';
import { sanitizarCeldaCsv } from '../common/util';

export interface ReporteResultado {
  titulo: string;
  subtitulo: string;
  interpretacion_ia: string;
  modo_ia: string;
  parametros: Record<string, any>;
  kpis: Array<{ etiqueta: string; valor: string | number }>;
  columnas: Array<{ key: string; header: string; width?: number }>;
  filas: Array<Record<string, any>>;
}

@Controller('reportes')
@UseGuards(JwtTenantGuard)
@Roles('admin', 'encargado')
export class ReportesController {
  @Get('dashboard')
  async obtenerDashboard() {
    const tenant = TenantContext.require();
    return Db.tx(async (client) => {
      const [ventasKpi, stockKpi, reservasKpi, porSucursal, topProductos, alertasStock] =
        await Promise.all([
          client.query(
            `
            SELECT
              COUNT(*) FILTER (WHERE estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada'))::int AS ventas_confirmadas,
              COUNT(*) FILTER (WHERE estado = 'pendiente_pago')::int AS ventas_pendientes_pago,
              COALESCE(SUM(total) FILTER (WHERE estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada')), 0)::numeric(12,2) AS ingresos_confirmados_bob,
              COALESCE(AVG(total) FILTER (WHERE estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada')), 0)::numeric(12,2) AS ticket_promedio_bob
            FROM public.ventas
            WHERE tenant_id = $1
            `,
            [tenant.tenantId],
          ),
          client.query(
            `
            SELECT
              COALESCE(SUM(cantidad), 0)::int AS unidades_fisicas,
              COALESCE(SUM(reservado), 0)::int AS unidades_reservadas,
              COALESCE(SUM(cantidad - reservado), 0)::int AS unidades_disponibles,
              COUNT(*) FILTER (WHERE (cantidad - reservado) <= stock_minimo)::int AS skus_alerta_minimo
            FROM public.stock
            WHERE tenant_id = $1
            `,
            [tenant.tenantId],
          ),
          client.query(
            `SELECT COUNT(*) FILTER (WHERE estado IN ('pendiente', 'preparada', 'en_atencion'))::int AS reservas_activas FROM public.reservas WHERE tenant_id = $1`,
            [tenant.tenantId],
          ),
          client.query(
            `
            SELECT s.id AS sucursal_id, s.nombre AS sucursal_nombre,
                   COUNT(v.id) FILTER (WHERE v.estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada'))::int AS cantidad_ventas,
                   COALESCE(SUM(v.total) FILTER (WHERE v.estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada')), 0)::numeric(12,2) AS total_bob
              FROM public.sucursales s
              LEFT JOIN public.ventas v ON v.tenant_id = s.tenant_id AND v.sucursal_id = s.id
             WHERE s.tenant_id = $1
             GROUP BY s.id, s.nombre
             ORDER BY s.id ASC
            `,
            [tenant.tenantId],
          ),
          client.query(
            `
            SELECT p.id, p.codigo, p.nombre, p.tipo_prenda,
                   COALESCE(SUM(vi.cantidad), 0)::int AS unidades_vendidas,
                   COALESCE(SUM(vi.subtotal), 0)::numeric(12,2) AS ingresos_bob
              FROM public.productos p
              LEFT JOIN public.variantes vr ON vr.tenant_id = p.tenant_id AND vr.producto_id = p.id
              LEFT JOIN public.venta_items vi ON vi.tenant_id = vr.tenant_id AND vi.variante_id = vr.id
              LEFT JOIN public.ventas v ON v.tenant_id = vi.tenant_id AND v.id = vi.venta_id AND v.estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada')
             WHERE p.tenant_id = $1
             GROUP BY p.id
             ORDER BY ingresos_bob DESC, unidades_vendidas DESC
             LIMIT 6
            `,
            [tenant.tenantId],
          ),
          client.query(
            `
            SELECT s.nombre AS sucursal_nombre, vr.sku, p.nombre AS producto_nombre, vr.talla, vr.color,
                   (st.cantidad - st.reservado) AS stock_disponible, st.stock_minimo
              FROM public.stock st
              JOIN public.almacenes a ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id
              JOIN public.sucursales s ON s.tenant_id = a.tenant_id AND s.id = a.sucursal_id
              JOIN public.variantes vr ON vr.tenant_id = st.tenant_id AND vr.id = st.variante_id
              JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
             WHERE st.tenant_id = $1 AND (st.cantidad - st.reservado) <= st.stock_minimo
             ORDER BY stock_disponible ASC
             LIMIT 10
            `,
            [tenant.tenantId],
          ),
        ]);

      return {
        tenant_slug: tenant.tenantSlug,
        tienda_nombre: tenant.nombre,
        ventas: {
          ...ventasKpi.rows[0],
          ingresos_confirmados_bob: Number(ventasKpi.rows[0].ingresos_confirmados_bob),
          ticket_promedio_bob: Number(ventasKpi.rows[0].ticket_promedio_bob),
        },
        inventario: stockKpi.rows[0],
        reservas: reservasKpi.rows[0],
        ventas_por_sucursal: porSucursal.rows.map((r) => ({
          ...r,
          total_bob: Number(r.total_bob),
        })),
        top_productos: topProductos.rows.map((r) => ({
          ...r,
          ingresos_bob: Number(r.ingresos_bob),
        })),
        alertas_stock_bajo: alertasStock.rows,
      };
    });
  }

  @Post('ia/consultar')
  async consultarReporteIa(@Body() body: any): Promise<ReporteResultado> {
    const comando = String(body?.comando || body?.prompt || 'Reporte de ventas por sucursal').trim();
    return this._construirReporteDesdeComando(comando, body?.formato);
  }

  @Post('ia/exportar')
  async exportarReporteIaPost(@Body() body: any, @Res() res: Response) {
    const comando = String(body?.comando || body?.prompt || 'Reporte de ventas por sucursal').trim();
    const formato = String(body?.formato || 'pdf').toLowerCase();
    const reporte = await this._construirReporteDesdeComando(comando, formato);
    return this._enviarArchivoExportado(reporte, formato, res);
  }

  @Get('ia/exportar')
  async exportarReporteIaGet(
    @Query('comando') comandoRaw: string,
    @Query('formato') formatoRaw: string,
    @Res() res: Response,
  ) {
    const comando = String(comandoRaw || 'Reporte general de ventas').trim();
    const formato = String(formatoRaw || 'pdf').toLowerCase();
    const reporte = await this._construirReporteDesdeComando(comando, formato);
    return this._enviarArchivoExportado(reporte, formato, res);
  }

  private async _construirReporteDesdeComando(
    comando: string,
    formatoForzado?: string,
  ): Promise<ReporteResultado> {
    const tenant = TenantContext.require();
    let dsl: any = null;
    try {
      dsl = await invocarFastApi('/ia/reportes/interpretar', {
        method: 'POST',
        body: { comando, formato_forzado: formatoForzado || null },
      });
    } catch {
      const cmdLower = comando.toLowerCase();
      dsl = {
        modo_ia: 'local',
        interpretacion_humana: `Reporte local generado para "${comando}"`,
        parametros: {
          tipo_reporte: cmdLower.includes('stock') || cmdLower.includes('inventario')
            ? 'inventario_critico'
            : cmdLower.includes('producto') || cmdLower.includes('top')
              ? 'top_productos'
              : 'ventas_resumen',
          agrupacion: cmdLower.includes('sucursal') ? 'sucursal' : 'producto',
          formato: formatoForzado || 'pdf',
        },
      };
    }

    const params = dsl?.parametros || {};
    const tipo = String(params.tipo_reporte || 'ventas_resumen');

    if (tipo === 'inventario_critico') {
      const rows = await Db.query(
        `
        SELECT s.nombre AS sucursal, a.codigo AS almacen, vr.sku, p.nombre AS producto,
               vr.talla, vr.color, st.cantidad AS stock_fisico, st.reservado AS stock_reservado,
               (st.cantidad - st.reservado) AS stock_disponible, st.stock_minimo,
               CASE WHEN (st.cantidad - st.reservado) <= st.stock_minimo THEN 'REABASTECER' ELSE 'OPTIMO' END AS estado_alerta
          FROM public.stock st
          JOIN public.almacenes a ON a.tenant_id = st.tenant_id AND a.id = st.almacen_id
          JOIN public.sucursales s ON s.tenant_id = a.tenant_id AND s.id = a.sucursal_id
          JOIN public.variantes vr ON vr.tenant_id = st.tenant_id AND vr.id = st.variante_id
          JOIN public.productos p ON p.tenant_id = vr.tenant_id AND p.id = vr.producto_id
         WHERE st.tenant_id = $1
         ORDER BY (st.cantidad - st.reservado) ASC, vr.sku ASC
        `,
        [tenant.tenantId],
      );

      const criticos = rows.filter((r) => r.estado_alerta === 'REABASTECER').length;
      const totalUnidades = rows.reduce((acc, r) => acc + Number(r.stock_disponible), 0);

      return {
        titulo: `Reporte de Inventario y Alertas de Stock — ${tenant.nombre}`,
        subtitulo: `Comando analizado: "${comando}"`,
        interpretacion_ia: dsl?.interpretacion_humana || 'Analisis de stock disponible por sucursal y SKU',
        modo_ia: dsl?.modo_ia || 'local',
        parametros: params,
        kpis: [
          { etiqueta: 'Total SKUs Evaluados', valor: rows.length },
          { etiqueta: 'Unidades Disponibles', valor: totalUnidades },
          { etiqueta: 'SKUs en Alerta de Stock Minimo', valor: criticos },
        ],
        columnas: [
          { key: 'sucursal', header: 'Sucursal', width: 22 },
          { key: 'sku', header: 'SKU', width: 18 },
          { key: 'producto', header: 'Prenda', width: 28 },
          { key: 'talla', header: 'Talla', width: 10 },
          { key: 'color', header: 'Color', width: 12 },
          { key: 'stock_fisico', header: 'Fisico', width: 10 },
          { key: 'stock_reservado', header: 'Reservado', width: 12 },
          { key: 'stock_disponible', header: 'Disponible', width: 12 },
          { key: 'estado_alerta', header: 'Estado', width: 16 },
        ],
        filas: rows,
      };
    }

    if (tipo === 'top_productos') {
      const rows = await Db.query(
        `
        SELECT p.codigo, p.nombre AS producto, c.nombre AS categoria, p.tipo_prenda,
               COALESCE(SUM(vi.cantidad), 0)::int AS unidades_vendidas,
               p.precio_base::numeric(12,2) AS precio_base_bob,
               COALESCE(SUM(vi.subtotal), 0)::numeric(12,2) AS ingresos_bob
          FROM public.productos p
          JOIN public.categorias c ON c.tenant_id = p.tenant_id AND c.id = p.categoria_id
          LEFT JOIN public.variantes vr ON vr.tenant_id = p.tenant_id AND vr.producto_id = p.id
          LEFT JOIN public.venta_items vi ON vi.tenant_id = vr.tenant_id AND vi.variante_id = vr.id
          LEFT JOIN public.ventas v ON v.tenant_id = vi.tenant_id AND v.id = vi.venta_id
            AND v.estado IN ('pagada', 'preparando', 'lista_retiro', 'entregada')
         WHERE p.tenant_id = $1
         GROUP BY p.id, c.nombre
         ORDER BY ingresos_bob DESC, unidades_vendidas DESC
        `,
        [tenant.tenantId],
      );

      const totalIngresos = rows.reduce((a, r) => a + Number(r.ingresos_bob), 0);
      const totalUnidades = rows.reduce((a, r) => a + Number(r.unidades_vendidas), 0);

      return {
        titulo: `Ranking de Productos y Rotacion Comercial — ${tenant.nombre}`,
        subtitulo: `Comando analizado: "${comando}"`,
        interpretacion_ia: dsl?.interpretacion_humana || 'Ranking de prendas por ingresos confirmados',
        modo_ia: dsl?.modo_ia || 'local',
        parametros: params,
        kpis: [
          { etiqueta: 'Productos en Catalogo', valor: rows.length },
          { etiqueta: 'Unidades Vendidas', valor: totalUnidades },
          { etiqueta: 'Ingresos Confirmados (BOB)', valor: `Bs. ${totalIngresos.toFixed(2)}` },
        ],
        columnas: [
          { key: 'codigo', header: 'Codigo', width: 16 },
          { key: 'producto', header: 'Producto', width: 30 },
          { key: 'categoria', header: 'Categoria', width: 20 },
          { key: 'tipo_prenda', header: 'Tipo', width: 14 },
          { key: 'unidades_vendidas', header: 'Unidades', width: 12 },
          { key: 'precio_base_bob', header: 'Precio Base (Bs)', width: 16 },
          { key: 'ingresos_bob', header: 'Ingresos (Bs)', width: 16 },
        ],
        filas: rows,
      };
    }

    // Por defecto: Reporte detallado de ventas
    const rows = await Db.query(
      `
      SELECT v.numero_comprobante AS comprobante,
             TO_CHAR(v.creado_en, 'YYYY-MM-DD HH24:MI') AS fecha,
             s.nombre AS sucursal,
             v.cliente_nombre AS cliente,
             UPPER(v.metodo_pago) AS metodo_pago,
             v.estado,
             v.estado_pago,
             v.subtotal::numeric(12,2) AS subtotal_bob,
             v.descuento::numeric(12,2) AS descuento_bob,
             v.total::numeric(12,2) AS total_bob
        FROM public.ventas v
        JOIN public.sucursales s ON s.tenant_id = v.tenant_id AND s.id = v.sucursal_id
       WHERE v.tenant_id = $1
       ORDER BY v.id DESC
      `,
      [tenant.tenantId],
    );

    const confirmadas = rows.filter((r) => r.estado_pago === 'aprobado');
    const sumaTotal = confirmadas.reduce((acc, r) => acc + Number(r.total_bob), 0);

    return {
      titulo: `Reporte Ejecutivo de Ventas y Pagos — ${tenant.nombre}`,
      subtitulo: `Comando analizado: "${comando}"`,
      interpretacion_ia: dsl?.interpretacion_humana || 'Consolidado de transacciones comerciales por sucursal',
      modo_ia: dsl?.modo_ia || 'local',
      parametros: params,
      kpis: [
        { etiqueta: 'Transacciones Registradas', valor: rows.length },
        { etiqueta: 'Ventas con Pago Confirmado', valor: confirmadas.length },
        { etiqueta: 'Ingresos Confirmados (BOB)', valor: `Bs. ${sumaTotal.toFixed(2)}` },
      ],
      columnas: [
        { key: 'comprobante', header: 'Comprobante', width: 20 },
        { key: 'fecha', header: 'Fecha', width: 18 },
        { key: 'sucursal', header: 'Sucursal', width: 22 },
        { key: 'cliente', header: 'Cliente', width: 24 },
        { key: 'metodo_pago', header: 'Metodo', width: 12 },
        { key: 'estado_pago', header: 'Estado Pago', width: 16 },
        { key: 'total_bob', header: 'Total (Bs)', width: 14 },
      ],
      filas: rows,
    };
  }

  private async _enviarArchivoExportado(
    reporte: ReporteResultado,
    formato: string,
    res: Response,
  ) {
    if (formato === 'csv') {
      const headers = reporte.columnas.map((c) => sanitizarCeldaCsv(c.header)).join(',');
      const lines = reporte.filas.map((row) =>
        reporte.columnas.map((c) => sanitizarCeldaCsv(row[c.key])).join(','),
      );
      const csvContent = '\uFEFF' + [headers, ...lines].join('\r\n') + '\r\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="reporte-fashionstore.csv"');
      return res.send(Buffer.from(csvContent, 'utf-8'));
    }

    if (formato === 'excel' || formato === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'FashionStore SaaS BI';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Reporte IA');

      sheet.mergeCells(1, 1, 1, reporte.columnas.length);
      const titleCell = sheet.getCell(1, 1);
      titleCell.value = reporte.titulo;
      titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };

      sheet.mergeCells(2, 1, 2, reporte.columnas.length);
      sheet.getCell(2, 1).value = `${reporte.subtitulo} | ${reporte.interpretacion_ia}`;
      sheet.getCell(2, 1).font = { italic: true, size: 10 };

      const headerRow = sheet.getRow(4);
      reporte.columnas.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.font = { bold: true, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        sheet.getColumn(idx + 1).width = col.width || 18;
      });

      reporte.filas.forEach((fila, rIdx) => {
        const row = sheet.getRow(5 + rIdx);
        reporte.columnas.forEach((col, cIdx) => {
          const val = fila[col.key];
          row.getCell(cIdx + 1).value = val !== undefined && val !== null ? String(val) : '';
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', 'attachment; filename="reporte-fashionstore.xlsx"');
      return res.send(Buffer.from(buffer));
    }

    if (formato === 'pdf') {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).fillColor('#0F172A').text(reporte.titulo, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(10).fillColor('#475569').text(reporte.subtitulo);
        doc.fontSize(9).fillColor('#64748B').text(`Interpretacion IA: ${reporte.interpretacion_ia}`);
        doc.moveDown(0.6);

        // KPIs
        const kpiText = reporte.kpis.map((k) => `${k.etiqueta}: ${k.valor}`).join('   |   ');
        doc.fontSize(10).fillColor('#1E293B').text(kpiText);
        doc.moveDown(0.8);

        // Cabecera de tabla
        const headerLine = reporte.columnas.map((c) => c.header).join('  |  ');
        doc.fontSize(9).fillColor('#0F172A').text(headerLine);
        doc.moveTo(36, doc.y + 2).lineTo(780, doc.y + 2).stroke('#CBD5E1');
        doc.moveDown(0.4);

        reporte.filas.slice(0, 60).forEach((fila) => {
          const line = reporte.columnas.map((c) => String(fila[c.key] ?? '')).join('  |  ');
          doc.fontSize(8.5).fillColor('#334155').text(line);
        });

        doc.end();
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="reporte-fashionstore.pdf"');
      return res.send(pdfBuffer);
    }

    throw new BadRequestException(`Formato de exportacion no soportado: ${formato}`);
  }
}

@Module({
  controllers: [ReportesController],
})
export class ReportesModule {}
