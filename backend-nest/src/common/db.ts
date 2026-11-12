import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import * as dotenv from 'dotenv';
import { TenantContext, TenantInfo } from './tenant-context';
import { verifyUserToken } from './auth';

dotenv.config();

export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

let poolInstance: Pool | null = null;

export function getPool(): Pool {
  if (!poolInstance) {
    const configuredDatabaseUrl = String(process.env.DATABASE_URL || '').trim();
    const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProduction && !configuredDatabaseUrl) {
      throw new Error('DATABASE_URL_REQUIRED: configura la URL PostgreSQL de producción en Azure Container Apps.');
    }
    const connectionString = configuredDatabaseUrl || 'postgresql://postgres@127.0.0.1:5432/fashionstore';
    const sslEnabled =
      String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true' ||
      /(?:^|[?&])sslmode=require(?:&|$)/i.test(connectionString);
    let databaseHost = '';
    try { databaseHost = new URL(connectionString).hostname.toLowerCase(); } catch { /* pg emitirá el error de DSN */ }
    const isLoopbackDatabase = ['localhost', '127.0.0.1', '::1', 'db'].includes(databaseHost);
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production' && !sslEnabled && !isLoopbackDatabase) {
      throw new Error('DATABASE_SSL_REQUIRED: las bases remotas en producción deben usar TLS (DATABASE_SSL=true o sslmode=require).');
    }
    poolInstance = new Pool({
      connectionString,
      ssl: sslEnabled ? { rejectUnauthorized: true } : false,
      max: 16,
      idleTimeoutMillis: 15000,
    });
  }
  return poolInstance;
}

export interface TxOptions {
  tenantId?: string;
  readonly?: boolean;
  requireWrite?: boolean;
}

export class Db {
  static async resolveTenantBySlug(slug: string): Promise<TenantInfo | null> {
    const clean = String(slug || '').trim().toLowerCase();
    if (!SLUG_REGEX.test(clean)) {
      return null;
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_runtime');
      const res = await client.query(
        `
        SELECT id, slug, nombre, plan, estado,
               demo_inicia_en, demo_vence_en,
               max_usuarios, max_sucursales, max_productos,
               public.tenant_write_allowed(id) AS write_allowed
          FROM public.tenants
         WHERE slug = $1
         LIMIT 1
        `,
        [clean],
      );
      await client.query('COMMIT');
      if (res.rowCount === 0) {
        return null;
      }
      const r = res.rows[0];
      return {
        tenantId: String(r.id),
        tenantSlug: String(r.slug),
        nombre: String(r.nombre),
        plan: String(r.plan),
        estado: String(r.estado),
        demoIniciaEn: new Date(r.demo_inicia_en).toISOString(),
        demoVenceEn: new Date(r.demo_vence_en).toISOString(),
        writeAllowed: Boolean(r.write_allowed),
        maxUsuarios: Number(r.max_usuarios),
        maxSucursales: Number(r.max_sucursales),
        maxProductos: Number(r.max_productos),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  }

  static async resolveTenantById(tenantId: string): Promise<TenantInfo | null> {
    const clean = String(tenantId || '').trim();
    if (!clean || clean.length > 64) return null;
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_runtime');
      const res = await client.query(
        `SELECT id, slug, nombre, plan, estado, demo_inicia_en, demo_vence_en,
                max_usuarios, max_sucursales, max_productos,
                public.tenant_write_allowed(id) AS write_allowed
           FROM public.tenants WHERE id = $1 LIMIT 1`,
        [clean],
      );
      await client.query('COMMIT');
      if (res.rowCount === 0) return null;
      const row = res.rows[0];
      return {
        tenantId: String(row.id),
        tenantSlug: String(row.slug),
        nombre: String(row.nombre),
        plan: String(row.plan),
        estado: String(row.estado),
        demoIniciaEn: new Date(row.demo_inicia_en).toISOString(),
        demoVenceEn: new Date(row.demo_vence_en).toISOString(),
        writeAllowed: Boolean(row.write_allowed),
        maxUsuarios: Number(row.max_usuarios),
        maxSucursales: Number(row.max_sucursales),
        maxProductos: Number(row.max_productos),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  }

  static async tx<T>(
    fn: (client: PoolClient, tenant: TenantInfo) => Promise<T>,
    opts: TxOptions = {},
  ): Promise<T> {
    const ctxTenant = TenantContext.get();
    const tenantId = opts.tenantId || ctxTenant?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('TENANT_CONTEXT_REQUIRED: Contexto de tienda obligatorio.');
    }

    if (opts.requireWrite && ctxTenant && !ctxTenant.writeAllowed) {
      throw new ForbiddenException(
        'DEMO_EXPIRED_READ_ONLY: El periodo Trial de 14 dias ha vencido o la tienda esta en modo solo lectura. Tus datos se conservan intactos.',
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10000ms'");
      if (opts.readonly) {
        await client.query('SET LOCAL ROLE app_readonly');
        await client.query('SET TRANSACTION READ ONLY');
      } else {
        await client.query('SET LOCAL ROLE app_runtime');
      }
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const effectiveTenant: TenantInfo = ctxTenant || {
        tenantId,
        tenantSlug: tenantId,
        nombre: tenantId,
        plan: 'demo',
        estado: 'activo',
        demoIniciaEn: new Date().toISOString(),
        demoVenceEn: new Date(Date.now() + 14 * 86400000).toISOString(),
        writeAllowed: true,
        maxUsuarios: 5,
        maxSucursales: 2,
        maxProductos: 500,
      };

      const result = await fn(client, effectiveTenant);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      const msg = String(err?.message || '');
      if (msg.includes('DEMO_EXPIRED_READ_ONLY')) {
        throw new ForbiddenException(
          'DEMO_EXPIRED_READ_ONLY: El periodo Trial de la tienda ha vencido. Solo se permiten operaciones de lectura.',
        );
      }
      if (msg.includes('QUOTA_EXCEEDED_')) {
        throw new ForbiddenException(`PLAN_QUOTA_EXCEEDED: ${msg.replace(/^QUOTA_EXCEEDED_[A-Z]+:\s*/, '')}`);
      }
      throw err;
    } finally {
      await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => undefined);
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  }

  static async query<R extends QueryResultRow = any>(
    sql: string,
    params: any[] = [],
    opts: TxOptions = {},
  ): Promise<R[]> {
    return Db.tx(async (client) => {
      const res = await client.query<R>(sql, params);
      return res.rows;
    }, opts);
  }
}

const CANONICAL_TENANT_PATH = /^\/api\/tiendas\/([^/]+)(\/.*)?$/;
const RELATIVE_TENANT_PATH = /^\/tiendas\/([^/]+)(\/.*)?$/;

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  async use(req: any, res: any, next: () => void) {
    const rawUrl = String(req.originalUrl || req.url || '');
    const pathOnly = rawUrl.split('?')[0];
    const querySuffix = rawUrl.includes('?') ? '?' + rawUrl.split('?').slice(1).join('?') : '';

    // Endpoints globales que no pertenecen a un tenant preexistente
    if (
      pathOnly === '/api/health' ||
      pathOnly === '/health' ||
      pathOnly === '/api/health/live' ||
      pathOnly === '/health/live' ||
      pathOnly === '/api/salud' ||
      pathOnly === '/salud' ||
      pathOnly === '/api/auth/tiendas' ||
      pathOnly === '/auth/tiendas' ||
      pathOnly === '/api/auth/registrar-tienda' ||
      pathOnly === '/auth/registrar-tienda' ||
      pathOnly === '/api/tenants/registro' ||
      pathOnly === '/tenants/registro' ||
      pathOnly === '/api/pagos/webhooks/stripe-checkout' ||
      pathOnly === '/api/pagos/stripe/retorno' ||
      pathOnly.startsWith('/assets/')
    ) {
      return next();
    }

    let pathSlug: string | null = null;
    let rewrittenSubpath: string | null = null;

    const mCanonical = CANONICAL_TENANT_PATH.exec(pathOnly);
    if (mCanonical) {
      pathSlug = decodeURIComponent(mCanonical[1]).trim().toLowerCase();
      rewrittenSubpath = '/api' + (mCanonical[2] || '/');
    } else {
      const mRel = RELATIVE_TENANT_PATH.exec(pathOnly);
      if (mRel) {
        pathSlug = decodeURIComponent(mRel[1]).trim().toLowerCase();
        rewrittenSubpath = mRel[2] || '/';
      }
    }

    const headerSlugRaw = req.headers['x-tenant-slug'];
    const headerSlug = headerSlugRaw ? String(headerSlugRaw).trim().toLowerCase() : null;
    const authorization = String(req.headers?.authorization || '');
    let jwtTenant: ReturnType<typeof verifyUserToken> | null = null;
    if (authorization.startsWith('Bearer ')) {
      try {
        jwtTenant = verifyUserToken(authorization.slice(7).trim());
      } catch {
        res.status(401).json({ statusCode: 401, error: 'TOKEN_INVALIDO', message: 'La sesión expiró o el token no es válido.' });
        return;
      }
    }

    // El JWT firmado es la fuente de tenant_id para las solicitudes autenticadas.
    if (jwtTenant && (!jwtTenant.tenant_id || !jwtTenant.tenant_slug)) {
      res.status(401).json({ statusCode: 401, error: 'TOKEN_TENANT_INVALIDO', message: 'El token no contiene una tienda válida.' });
      return;
    }
    const claimSlug = jwtTenant?.tenant_slug?.trim().toLowerCase() || null;
    if (
      (pathSlug && claimSlug && pathSlug !== claimSlug) ||
      (headerSlug && claimSlug && headerSlug !== claimSlug) ||
      (pathSlug && headerSlug && pathSlug !== headerSlug)
    ) {
      res.status(403).json({
        statusCode: 403,
        error: 'TENANT_SLUG_MISMATCH',
        message: 'La ruta o el encabezado no corresponden a la tienda indicada por el token.',
      });
      return;
    }

    const effectiveSlug = claimSlug || pathSlug || headerSlug;
    if (!effectiveSlug) {
      res.status(400).json({
        statusCode: 400,
        error: 'TENANT_SLUG_REQUIRED',
        message: 'Indique la tienda mediante la ruta canónica /api/tiendas/{slug}/... o X-Tenant-Slug para el acceso público.',
      });
      return;
    }
    if (!SLUG_REGEX.test(effectiveSlug)) {
      res.status(400).json({
        statusCode: 400,
        error: 'INVALID_TENANT_SLUG',
        message: 'El identificador (slug) de la tienda tiene un formato inválido.',
      });
      return;
    }

    let tenant: TenantInfo | null;
    try {
      tenant = jwtTenant
        ? await Db.resolveTenantById(jwtTenant.tenant_id)
        : await Db.resolveTenantBySlug(effectiveSlug);
    } catch (error: any) {
      const rawCode = String(error?.code || '');
      const errorMessage = String(error?.message || '');
      const diagnosticCode = /^[A-Z0-9_]{2,32}$/.test(rawCode)
        ? rawCode
        : errorMessage.includes('DATABASE_URL_REQUIRED')
          ? 'DATABASE_URL_REQUIRED'
          : errorMessage.includes('DATABASE_SSL_REQUIRED')
            ? 'DATABASE_SSL_REQUIRED'
            : 'TENANT_DATABASE_ERROR';
      console.error(`[FashionStore] No se pudo resolver el tenant '${effectiveSlug}' en ${pathOnly}: ${diagnosticCode}`);
      res.status(503).json({
        statusCode: 503,
        error: 'TENANT_RESOLUTION_FAILED',
        diagnostico: diagnosticCode,
        message: 'No se pudo consultar la tienda en PostgreSQL. Revisa DATABASE_URL, TLS, permisos de app_runtime y las migraciones del backend NestJS.',
      });
      return;
    }
    if (tenant && jwtTenant && tenant.tenantSlug !== claimSlug) {
      res.status(403).json({ statusCode: 403, error: 'TENANT_CLAIM_MISMATCH', message: 'La tienda del token no coincide con el registro del servidor.' });
      return;
    }
    if (!tenant) {
      res.status(404).json({
        statusCode: 404,
        error: 'TENANT_NOT_FOUND',
        message: `La tienda '${effectiveSlug}' no existe.`,
      });
      return;
    }

    if (rewrittenSubpath) {
      req.url = rewrittenSubpath + querySuffix;
      req.originalUrl = rewrittenSubpath + querySuffix;
    }

    req.tenant = tenant;
    res.setHeader('X-Resolved-Tenant-Slug', tenant.tenantSlug);
    res.setHeader('X-Tenant-Write-Allowed', String(tenant.writeAllowed));

    TenantContext.run(tenant, () => next());
  }
}
