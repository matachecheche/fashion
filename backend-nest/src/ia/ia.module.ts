import { Body, Controller, Get, Module, Post, Query, Req, UseGuards } from '@nestjs/common';
import { extractOptionalUser, JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { Db } from '../common/db';
import { assistantContextSources, assistantSuggestedProducts, buildAssistantDataContext, buildAssistantLocalReply } from './asistente-context';

const FASTAPI_BASE_URL = (process.env.FASTAPI_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const INTERNAL_IA_KEY = process.env.IA_INTERNAL_KEY || '';

export async function invocarFastApi(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: any; query?: Record<string, any>; timeoutMs?: number } = {},
): Promise<any> {
  const tenant = TenantContext.require();
  const method = options.method || 'GET';
  const qs = new URLSearchParams();
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null && v !== '') {
        qs.set(k, String(v));
      }
    }
  }
  const url = `${FASTAPI_BASE_URL}${path}${qs.toString() ? `?${qs.toString()}` : ''}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Tenant-Slug': tenant.tenantSlug,
    'X-Tenant-Id': String(tenant.tenantId),
  };
  if (INTERNAL_IA_KEY) {
    headers['X-IA-Internal-Key'] = INTERNAL_IA_KEY;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 9000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(options.body || {}) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`FastAPI respondio HTTP ${res.status}: ${errText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

@Controller('ia')
export class IaController {
  @Get('estado')
  async estadoIa() {
    const tenant = TenantContext.require();
    try {
      const data = await invocarFastApi('/asistente/estado');
      return {
        ...data,
        proxy: 'nestjs',
        tenant_slug: tenant.tenantSlug,
      };
    } catch {
      return {
        tenant_slug: tenant.tenantSlug,
        modo: 'local',
        proveedor: 'local_rules',
        proxy: 'nestjs-local-fallback',
      };
    }
  }

  @Post('chat')
  async chatAsistente(@Body() body: any, @Req() req: any) {
    const tenant = TenantContext.require();
    const authenticatedUser = extractOptionalUser(req);
    const mensaje = String(body?.mensaje || 'Hola').trim().slice(0, 1000) || 'Hola';
    const sesionId = String(body?.sesion_id || 'sesion-web').slice(0, 64);
    const historial = Array.isArray(body?.historial)
      ? body.historial.slice(-8).flatMap((item: any) => {
          const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null;
          const content = String(item?.content || '').trim().slice(0, 800);
          return role && content ? [{ role, content }] : [];
        })
      : [];

    let contexto: Record<string, any>;
    try {
      contexto = await Db.tx(
        (client, currentTenant) => buildAssistantDataContext(
          client,
          currentTenant,
          mensaje,
          authenticatedUser?.rol || null,
          {
            userId: Number.isSafeInteger(Number(authenticatedUser?.sub)) ? Number(authenticatedUser?.sub) : null,
            branchId: Number.isSafeInteger(Number(authenticatedUser?.sucursal_id)) ? Number(authenticatedUser?.sucursal_id) : null,
            providerId: Number.isSafeInteger(Number(authenticatedUser?.proveedor_id)) ? Number(authenticatedUser?.proveedor_id) : null,
          },
        ),
        { readonly: true },
      );
    } catch {
      contexto = {
        base_datos_disponible: false,
        actualizado_en: new Date().toISOString(),
        tenant_id: tenant.tenantId,
        tienda: { slug: tenant.tenantSlug, nombre: tenant.nombre },
        acceso: {
          rol: authenticatedUser?.rol || 'anonimo',
          puede_consultar_metricas_comerciales: ['admin', 'encargado'].includes(authenticatedUser?.rol || ''),
        },
        catalogo: { resumen_total: {}, productos_por_tipo: [], productos_relevantes: [] },
        consulta: { filtros_catalogo: {}, resumen_filtrado: {} },
        sucursales: [],
        promociones_activas: [],
        analitica_comercial: null,
      };
    }

    const sugerenciasLocales = assistantSuggestedProducts(contexto);
    try {
      const res = await invocarFastApi('/asistente/chat', {
        method: 'POST',
        body: {
          mensaje,
          sesion_id: sesionId,
          // Nunca aceptar usuario_id del body: solo proviene del JWT validado.
          usuario_id: authenticatedUser?.sub ?? null,
          historial,
          contexto,
        },
        timeoutMs: 25000,
      });
      return {
        ...res,
        datos_consultados: res.datos_consultados || {
          base_datos: Boolean(contexto.base_datos_disponible),
          fuentes: assistantContextSources(contexto),
          actualizado_en: contexto.actualizado_en,
        },
        sugerencias: res.productos_sugeridos || res.sugerencias || [],
      };
    } catch {
      return {
        tenant_slug: tenant.tenantSlug,
        sesion_id: sesionId,
        intencion: 'consulta_datos',
        modo_ia: 'local',
        proveedor: 'local_rules',
        respuesta: buildAssistantLocalReply(mensaje, contexto),
        datos_consultados: {
          base_datos: Boolean(contexto.base_datos_disponible),
          fuentes: assistantContextSources(contexto),
          actualizado_en: contexto.actualizado_en,
        },
        sugerencias: sugerenciasLocales,
        productos_sugeridos: sugerenciasLocales,
      };
    }
  }

  @Get('recomendaciones')
  async obtenerRecomendaciones(@Query() query: any) {
    const tenant = TenantContext.require();
    try {
      return await invocarFastApi('/recomendaciones', { method: 'GET', query });
    } catch {
      const recs = await Db.query(
        `
        SELECT p.id, p.codigo, p.nombre, p.tipo_prenda, p.precio_base, p.imagen_url, p.ar_overlay_url
          FROM public.productos p
         WHERE p.tenant_id = $1 AND p.activo = TRUE
         ORDER BY p.id ASC
         LIMIT 4
        `,
        [tenant.tenantId],
      );
      return { tenant_slug: tenant.tenantSlug, total_recomendaciones: recs.length, recomendaciones: recs };
    }
  }

  @Post('talla')
  async sugerirTalla(@Body() body: any) {
    const altura = Number(body?.altura_cm || 168);
    const peso = Number(body?.peso_kg || 65);
    const imc = peso / Math.pow(altura / 100, 2);
    const talla = imc < 20 ? 'S' : imc < 24.5 ? 'M' : imc < 28.5 ? 'L' : 'XL';
    return { talla_sugerida: talla, imc: Number(imc.toFixed(1)), confianza: 0.91 };
  }

  @Get('ar/overlays')
  async obtenerOverlaysAr() {
    return invocarFastApi('/ar/catalogo-overlays', { method: 'GET' });
  }

  @Post('ar/calibrar')
  async calibrarAr(@Body() body: any) {
    try {
      return await invocarFastApi('/ar/calibrar', { method: 'POST', body });
    } catch {
      return {
        escala_sugerida: 1.0,
        offset_x_pct: 0,
        offset_y_pct: 4,
        calidad_tracking: 'optima',
      };
    }
  }

  @Get('ml/metricas')
  async metricasMl(@Query('seed') seed?: string) {
    return invocarFastApi('/ml/analisis', { method: 'GET', query: { seed } });
  }

  @Get('ml/analisis')
  async analisisMl(@Query('seed') seed?: string) {
    return invocarFastApi('/ml/analisis', { method: 'GET', query: { seed } });
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Get('ml/modelos')
  async listarModelosMl(@Query('limit') limit?: string) {
    return invocarFastApi('/ml/modelos', { method: 'GET', query: { limit } });
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('ml/entrenar')
  async entrenarModelosMl(@Body() body: any) {
    return invocarFastApi('/ml/entrenar', {
      method: 'POST',
      body: { seed: Number(body?.seed || 2026) },
    });
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Get('ml/predicciones')
  async listarPrediccionesMl(@Query('limit') limit?: string) {
    return invocarFastApi('/ml/predicciones', { method: 'GET', query: { limit } });
  }

  @UseGuards(JwtTenantGuard)
  @Roles('admin', 'encargado')
  @Post('ml/predecir-demo')
  async crearPrediccionesMl(@Body() body: any) {
    return invocarFastApi('/ml/predecir-demo', {
      method: 'POST',
      body: { seed: Number(body?.seed || 42) },
    });
  }
}

@Module({
  controllers: [IaController],
})
export class IaModule {}
