import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Module,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { Db, getPool, SLUG_REGEX } from '../common/db';
import { JwtTenantGuard, signUserToken } from '../common/auth';
import { TenantContext } from '../common/tenant-context';
import { normalizarSlug } from '../common/util';


function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue).sort().filter((key) => objectValue[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`).join(',')}}`;
}

@Controller('auth')
export class AuthController {
  @Post('registrar-tienda')
  async crearTiendaOnboardingAlias(
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    return this.crearTiendaOnboarding(body, idempotencyKey, res);
  }

  @Post('tiendas')
  async crearTiendaOnboarding(
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKeyRaw?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    const nombreTienda = String(body?.nombre_tienda || body?.nombre || '').trim();
    const rawSlug = String(body?.slug || normalizarSlug(nombreTienda)).trim().toLowerCase();
    const adminNombre = String(body?.admin_nombre || body?.propietario_nombre || 'Admin Tienda').trim();
    const adminEmail = String(body?.admin_email || body?.email || '').trim().toLowerCase();
    const adminPassword = String(body?.admin_password || body?.password || '');
    const nit = String(body?.nit || body?.admin_nit || '').trim().toUpperCase();
    const aceptaTrial = Boolean(body?.acepta_trial ?? body?.acepta_demo ?? body?.aceptaTrial ?? false);
    const idempotencyKey = String(idempotencyKeyRaw || body?.operacion_id || randomUUID()).trim();

    if (!nombreTienda || nombreTienda.length < 3) {
      throw new BadRequestException('Indique un nombre comercial válido (mínimo 3 caracteres).');
    }
    if (!SLUG_REGEX.test(rawSlug) || ['api', 'admin', 'tiendas', 'health', 'assets'].includes(rawSlug)) {
      throw new BadRequestException('El slug debe usar minúsculas, números y guiones; no puede ser reservado.');
    }
    if (!/^[0-9A-Z.-]{4,40}$/.test(nit)) {
      throw new BadRequestException('Indique un NIT válido de entre 4 y 40 caracteres.');
    }
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      throw new BadRequestException('Indique un correo electrónico válido para la administración.');
    }
    if (!adminPassword || adminPassword.length < 8) {
      throw new BadRequestException('La contraseña del administrador debe tener al menos 8 caracteres.');
    }
    if (!aceptaTrial) {
      throw new BadRequestException('Debe aceptar las condiciones del Trial gratuito de 14 días.');
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new BadRequestException('Idempotency-Key debe tener entre 8 y 128 caracteres.');
    }

    // La huella se calcula sobre todos los datos que alteran el alta; nunca se almacena la clave en claro.
    const requestHash = createHash('sha256').update(canonicalJson({
      nombreTienda, rawSlug, adminNombre, adminEmail, nit, adminPassword,
      direccion: String(body?.direccion || ''), ciudad: String(body?.ciudad || ''),
      telefono: String(body?.telefono || ''), plan: 'trial',
    })).digest('hex');
    const tenantId = randomUUID();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE app_runtime');
      // Serializa los registros que compiten por el mismo slug antes de comprobar NIT e idempotencia.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`onboarding_${rawSlug}`]);

      const previous = await client.query(
        `SELECT request_hash, estado, respuesta_json
           FROM public.auditoria_aprovisionamiento
          WHERE tenant_slug = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [rawSlug, idempotencyKey],
      );
      if (previous.rowCount > 0) {
        const row = previous.rows[0];
        if (row.request_hash !== requestHash) {
          throw new UnprocessableEntityException('IDEMPOTENCY_KEY_REUSED: La clave se reutilizó con datos distintos.');
        }
        if (row.estado === 'COMPLETADA' && row.respuesta_json) {
          await client.query('COMMIT');
          const cached = row.respuesta_json;
          const user = cached.usuario;
          const refreshedToken = user
            ? signUserToken({
                sub: Number(user.id), email: user.email, nombre: user.nombre, rol: user.rol,
                sucursal_id: user.sucursal_id ? Number(user.sucursal_id) : null,
                proveedor_id: null, tenant_id: user.tenant_id, tenant_slug: user.tenant_slug,
              })
            : cached.access_token;
          return { ...cached, token: refreshedToken, access_token: refreshedToken, idempotent_replay: true };
        }
        if (row.estado === 'EN_PROCESO') {
          res?.setHeader('Retry-After', '3');
          throw new ConflictException('ONBOARDING_IN_PROGRESS: El alta ya está siendo procesada; reintente en unos segundos.');
        }
        await client.query(
          `UPDATE public.auditoria_aprovisionamiento
              SET estado = 'EN_PROCESO', codigo_error = NULL, respuesta_json = NULL,
                  actualizado_en = NOW()
            WHERE tenant_slug = $1 AND idempotency_key = $2`,
          [rawSlug, idempotencyKey],
        );
      } else {
        await client.query(
          `INSERT INTO public.auditoria_aprovisionamiento
             (tenant_slug, idempotency_key, request_hash, estado)
           VALUES ($1, $2, $3, 'EN_PROCESO')`,
          [rawSlug, idempotencyKey, requestHash],
        );
      }

      const existe = await client.query(
        'SELECT id FROM public.tenants WHERE slug = $1 OR nit = $2 LIMIT 1',
        [rawSlug, nit],
      );
      if (existe.rowCount > 0) {
        const duplicateByNit = await client.query(
          'SELECT slug FROM public.tenants WHERE nit = $1 LIMIT 1', [nit],
        );
        if (duplicateByNit.rowCount > 0) {
          throw new ConflictException('NIT_ALREADY_EXISTS: Ya existe una tienda registrada con ese NIT.');
        }
        throw new ConflictException(`SLUG_ALREADY_EXISTS: El slug '${rawSlug}' ya está registrado.`);
      }

      const tRes = await client.query(
        `INSERT INTO public.tenants (
           id, slug, nombre, plan, estado, demo_inicia_en, demo_vence_en,
           max_usuarios, max_sucursales, max_productos, acepta_demo,
           onboarding_completado, email_propietario, nit
         ) VALUES (
           $1, $2, $3, 'trial', 'activo', NOW(), NOW() + INTERVAL '14 days',
           3, 1, 200, TRUE, TRUE, $4, $5
         )
         RETURNING id, slug, nombre, plan, estado, demo_inicia_en, demo_vence_en,
                   max_usuarios, max_sucursales, max_productos`,
        [tenantId, rawSlug, nombreTienda, adminEmail, nit],
      );
      const tenantRow = tRes.rows[0];
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const sucRes = await client.query(
        `INSERT INTO public.sucursales (tenant_id, codigo, nombre, direccion, ciudad, telefono, horario, activa)
         VALUES ($1, 'SUC-01', $2, $3, $4, $5, 'Lun-Sab 09:00-20:00', TRUE)
         RETURNING id, codigo, nombre`,
        [tenantId, `Sucursal Principal - ${nombreTienda}`, String(body?.direccion || 'Av. Principal #100'),
          String(body?.ciudad || 'Santa Cruz de la Sierra'), String(body?.telefono || '')],
      );
      const sucursal = sucRes.rows[0];
      const almRes = await client.query(
        `INSERT INTO public.almacenes (tenant_id, sucursal_id, codigo, nombre, es_principal, activo)
         VALUES ($1, $2, 'ALM-01', 'Almacén Principal', TRUE, TRUE)
         RETURNING id, codigo, nombre`,
        [tenantId, sucursal.id],
      );
      const almacen = almRes.rows[0];
      const catRes = await client.query(
        `INSERT INTO public.categorias (tenant_id, nombre, slug, tipo_prenda, descripcion, activa)
         VALUES ($1, 'Colección Inicial', 'coleccion-inicial', 'vestido', 'Categoría base del tenant', TRUE)
         RETURNING id`, [tenantId],
      );
      await client.query(
        `INSERT INTO public.temporadas (tenant_id, nombre, anio, activa) VALUES ($1, 'Temporada 2026', 2026, TRUE)`,
        [tenantId],
      );
      const passHash = bcrypt.hashSync(adminPassword, 12);
      const usrRes = await client.query(
        `INSERT INTO public.usuarios (tenant_id, nombre, email, password_hash, rol, telefono, sucursal_id, activo)
         VALUES ($1, $2, $3, $4, 'admin', $5, $6, TRUE)
         RETURNING id, nombre, email, rol, sucursal_id, proveedor_id`,
        [tenantId, adminNombre, adminEmail, passHash, String(body?.telefono || ''), sucursal.id],
      );
      const adminUser = usrRes.rows[0];
      await client.query(
        `INSERT INTO public.suscripciones (tenant_id, plan_codigo, estado, inicio, vence_en, modo_cobro)
         VALUES ($1, 'trial', 'activa', NOW(), NOW() + INTERVAL '14 days', 'prueba')
         ON CONFLICT (tenant_id) DO UPDATE SET plan_codigo = 'trial', estado = 'activa',
           inicio = EXCLUDED.inicio, vence_en = EXCLUDED.vence_en, actualizado_en = NOW()`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO public.auditoria (tenant_id, usuario_id, entidad, entidad_id, accion, detalle_json)
         VALUES ($1, $2, 'tenants', $1, 'onboarding_alta_tienda', $3::jsonb)`,
        [tenantId, adminUser.id, JSON.stringify({ slug: rawSlug, plan: 'trial', duracion_dias: 14, nit, cobro_real: false })],
      );

      const token = signUserToken({
        sub: Number(adminUser.id), email: adminUser.email, nombre: adminUser.nombre,
        rol: adminUser.rol, sucursal_id: Number(adminUser.sucursal_id), proveedor_id: null,
        tenant_id: tenantId, tenant_slug: rawSlug,
      });
      const response = {
        mensaje: 'Tienda creada con Trial gratuito de 14 días; no se realizará ningún cobro.',
        canonical_url: `/tienda/${rawSlug}`,
        api_base_url: `/api/tiendas/${rawSlug}`,
        token, access_token: token,
        tenant: {
          id: tenantRow.id, slug: tenantRow.slug, nombre: tenantRow.nombre, nit,
          plan: tenantRow.plan, estado: tenantRow.estado,
          demo_inicia_en: tenantRow.demo_inicia_en, demo_vence_en: tenantRow.demo_vence_en,
          limites: {
            max_usuarios: Number(tenantRow.max_usuarios),
            max_sucursales: Number(tenantRow.max_sucursales),
            max_productos: Number(tenantRow.max_productos),
          },
          sucursal_inicial: sucursal, almacen_inicial: almacen, categoria_inicial_id: catRes.rows[0].id,
        },
        usuario: {
          id: Number(adminUser.id), nombre: adminUser.nombre, email: adminUser.email,
          rol: adminUser.rol, sucursal_id: Number(adminUser.sucursal_id),
          tenant_id: tenantId, tenant_slug: rawSlug,
        },
      };
      // No persistir ni siquiera temporalmente el bearer token dentro de la auditoría.
      const { token: _token, access_token: _accessToken, ...replaySafeResponse } = response;
      await client.query(
        `UPDATE public.auditoria_aprovisionamiento
            SET tenant_id = $3, estado = 'COMPLETADA', respuesta_json = $4::jsonb,
                codigo_error = NULL, actualizado_en = NOW()
          WHERE tenant_slug = $1 AND idempotency_key = $2`,
        [rawSlug, idempotencyKey, tenantId, JSON.stringify(replaySafeResponse)],
      );
      await client.query('COMMIT');
      return response;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      // La auditoría del fallo se escribe fuera de la transacción de aprovisionamiento.
      // No se pisa una clave ya completada cuando el cliente la reutiliza con otro contenido.
      if (!String(err?.message || '').includes('IDEMPOTENCY_KEY_REUSED')) {
        await client.query('BEGIN').catch(() => undefined);
        await client.query('SET LOCAL ROLE app_runtime').catch(() => undefined);
        await client.query(
          `INSERT INTO public.auditoria_aprovisionamiento
             (tenant_slug, idempotency_key, request_hash, estado, codigo_error)
           VALUES ($1, $2, $3, 'FALLIDA', $4)
           ON CONFLICT (tenant_slug, idempotency_key) DO UPDATE SET
             request_hash = EXCLUDED.request_hash, estado = 'FALLIDA', respuesta_json = NULL,
             codigo_error = EXCLUDED.codigo_error, actualizado_en = NOW()`,
          [rawSlug, idempotencyKey, requestHash, String(err?.code || err?.status || err?.name || 'ONBOARDING_FAILED').slice(0, 64)],
        ).then(() => client.query('COMMIT')).catch(() => client.query('ROLLBACK').catch(() => undefined));
      }
      if (err?.code === '23505') {
        const constraint = String(err?.constraint || '').toLowerCase();
        if (constraint.includes('nit')) {
          throw new ConflictException('NIT_ALREADY_EXISTS: Ya existe una tienda registrada con ese NIT.');
        }
        if (constraint.includes('slug')) {
          throw new ConflictException(`SLUG_ALREADY_EXISTS: El slug '${rawSlug}' ya está registrado.`);
        }
      }
      throw err;
    } finally {
      await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => undefined);
      await client.query('RESET ROLE').catch(() => undefined);
      client.release();
    }
  }

  @Post('registro')
  async registrarCliente(@Body() body: any) {
    const tenant = TenantContext.require();
    if (body?.rol && String(body.rol).toLowerCase() !== 'cliente') {
      throw new ForbiddenException('ROLE_ESCALATION_DENIED: El registro publico solo permite crear cuentas de rol cliente.');
    }

    const nombre = String(body?.nombre || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const telefono = String(body?.telefono || '').trim();

    if (!nombre || !email || !email.includes('@') || password.length < 6) {
      throw new BadRequestException('Datos de registro invalidos: verifique nombre, email y contrasena (minimo 6 caracteres).');
    }

    return Db.tx(
      async (client) => {
        const dup = await client.query(
          'SELECT id FROM public.usuarios WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
          [tenant.tenantId, email],
        );
        if (dup.rowCount > 0) {
          throw new ConflictException('EMAIL_DUPLICADO: Ya existe una cuenta con ese correo en esta tienda.');
        }

        const hash = bcrypt.hashSync(password, 10);
        const ins = await client.query(
          `
          INSERT INTO public.usuarios (tenant_id, nombre, email, password_hash, rol, telefono, activo)
          VALUES ($1, $2, $3, $4, 'cliente', $5, TRUE)
          RETURNING id, nombre, email, rol, telefono, sucursal_id, proveedor_id, creado_en
          `,
          [tenant.tenantId, nombre, email, hash, telefono || null],
        );
        const u = ins.rows[0];
        const token = signUserToken({
          sub: Number(u.id),
          email: u.email,
          nombre: u.nombre,
          rol: 'cliente',
          sucursal_id: null,
          proveedor_id: null,
          tenant_id: tenant.tenantId,
          tenant_slug: tenant.tenantSlug,
        });

        return {
          token,
          access_token: token,
          tenant: {
            id: tenant.tenantId,
            slug: tenant.tenantSlug,
            nombre: tenant.nombre,
          },
          usuario: {
            ...u,
            tenant_id: tenant.tenantId,
            tenant_slug: tenant.tenantSlug,
          },
        };
      },
      { requireWrite: true },
    );
  }

  @Post('login')
  async login(@Body() body: any) {
    const tenant = TenantContext.require();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    if (!email || !password) {
      throw new BadRequestException('Debe ingresar correo y contrasena.');
    }

    return Db.tx(async (client) => {
      const res = await client.query(
        `
        SELECT id, tenant_id, nombre, email, password_hash, rol, telefono,
               sucursal_id, proveedor_id, activo,
               (password_hash = crypt($3, password_hash)) AS pgcrypto_match
          FROM public.usuarios
         WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)
         LIMIT 1
        `,
        [tenant.tenantId, email, password],
      );

      if (res.rowCount === 0) {
        throw new UnauthorizedException('CREDENCIALES_INVALIDAS: Correo o contrasena incorrectos en esta tienda.');
      }

      const u = res.rows[0];
      if (!u.activo) {
        throw new ForbiddenException('CUENTA_INACTIVA: La cuenta de usuario se encuentra deshabilitada.');
      }

      const validPass = Boolean(u.pgcrypto_match) || bcrypt.compareSync(password, String(u.password_hash));
      if (!validPass) {
        throw new UnauthorizedException('CREDENCIALES_INVALIDAS: Correo o contrasena incorrectos en esta tienda.');
      }

      const token = signUserToken({
        sub: Number(u.id),
        email: u.email,
        nombre: u.nombre,
        rol: u.rol,
        sucursal_id: u.sucursal_id ? Number(u.sucursal_id) : null,
        proveedor_id: u.proveedor_id ? Number(u.proveedor_id) : null,
        tenant_id: tenant.tenantId,
        tenant_slug: tenant.tenantSlug,
      });

      return {
        token,
        access_token: token,
        tenant: {
          id: tenant.tenantId,
          slug: tenant.tenantSlug,
          nombre: tenant.nombre,
          plan: tenant.plan,
          estado: tenant.estado,
          demo_vence_en: tenant.demoVenceEn,
          write_allowed: tenant.writeAllowed,
        },
        usuario: {
          id: Number(u.id),
          nombre: u.nombre,
          email: u.email,
          rol: u.rol,
          telefono: u.telefono,
          sucursal_id: u.sucursal_id ? Number(u.sucursal_id) : null,
          proveedor_id: u.proveedor_id ? Number(u.proveedor_id) : null,
          tenant_id: tenant.tenantId,
          tenant_slug: tenant.tenantSlug,
        },
      };
    });
  }

  @UseGuards(JwtTenantGuard)
  @Get('me')
  async obtenerPerfil(@Req() req: any) {
    const tenant = TenantContext.require();
    const userId = Number(req.user.sub);
    return Db.tx(async (client) => {
      const res = await client.query(
        `
        SELECT id, tenant_id, nombre, email, rol, telefono, sucursal_id, proveedor_id, activo, preferencias_json, creado_en
          FROM public.usuarios
         WHERE tenant_id = $1 AND id = $2
         LIMIT 1
        `,
        [tenant.tenantId, userId],
      );
      if (res.rowCount === 0) {
        throw new UnauthorizedException('Usuario no encontrado en el tenant actual.');
      }
      return {
        usuario: {
          ...res.rows[0],
          tenant_slug: tenant.tenantSlug,
        },
        tenant: {
          id: tenant.tenantId,
          slug: tenant.tenantSlug,
          nombre: tenant.nombre,
          plan: tenant.plan,
          estado: tenant.estado,
          demo_vence_en: tenant.demoVenceEn,
          write_allowed: tenant.writeAllowed,
          limites: {
            max_usuarios: tenant.maxUsuarios,
            max_sucursales: tenant.maxSucursales,
            max_productos: tenant.maxProductos,
          },
        },
      };
    });
  }

  @UseGuards(JwtTenantGuard)
  @Patch('me')
  async actualizarPerfil(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const userId = Number(req.user.sub);
    return Db.tx(
      async (client) => {
        const res = await client.query(
          `
          UPDATE public.usuarios
             SET nombre = COALESCE($3, nombre),
                 telefono = COALESCE($4, telefono),
                 preferencias_json = COALESCE($5::jsonb, preferencias_json)
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, tenant_id, nombre, email, rol, telefono, sucursal_id, proveedor_id, preferencias_json
          `,
          [
            tenant.tenantId,
            userId,
            body?.nombre ? String(body.nombre).trim() : null,
            body?.telefono !== undefined ? String(body.telefono).trim() : null,
            body?.preferencias_json ? JSON.stringify(body.preferencias_json) : null,
          ],
        );
        return res.rows[0];
      },
      { requireWrite: true },
    );
  }

  @UseGuards(JwtTenantGuard)
  @Post('me/password')
  async cambiarPassword(@Req() req: any, @Body() body: any) {
    const tenant = TenantContext.require();
    const userId = Number(req.user.sub);
    const actual = String(body?.password_actual || '');
    const nueva = String(body?.password_nueva || '');
    if (!nueva || nueva.length < 6) {
      throw new BadRequestException('La nueva contrasena debe tener al menos 6 caracteres.');
    }

    return Db.tx(
      async (client) => {
        const res = await client.query(
          `
          SELECT password_hash, (password_hash = crypt($3, password_hash)) AS pgcrypto_match
            FROM public.usuarios
           WHERE tenant_id = $1 AND id = $2
          `,
          [tenant.tenantId, userId, actual],
        );
        if (res.rowCount === 0) {
          throw new UnauthorizedException('Usuario no encontrado.');
        }
        const u = res.rows[0];
        const ok = Boolean(u.pgcrypto_match) || bcrypt.compareSync(actual, String(u.password_hash));
        if (!ok) {
          throw new BadRequestException('La contrasena actual es incorrecta.');
        }
        const nuevoHash = bcrypt.hashSync(nueva, 10);
        await client.query(
          'UPDATE public.usuarios SET password_hash = $3 WHERE tenant_id = $1 AND id = $2',
          [tenant.tenantId, userId, nuevoHash],
        );
        return { actualizado: true };
      },
      { requireWrite: true },
    );
  }
}

@Controller('tenants')
export class TenantRegistrationController {
  @Post('registro')
  registrarTenant(
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: any,
  ) {
    return new AuthController().crearTiendaOnboarding(body, idempotencyKey, res);
  }
}

@Module({
  controllers: [AuthController, TenantRegistrationController],
})
export class AuthModule {}
