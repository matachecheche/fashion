import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Db } from '../common/db';
import { JwtTenantGuard, Roles } from '../common/auth';
import { TenantContext } from '../common/tenant-context';

@Controller('usuarios')
@UseGuards(JwtTenantGuard)
@Roles('admin')
export class UsuariosController {
  @Get()
  async listarUsuarios() {
    const tenant = TenantContext.require();
    return Db.query(
      `
      SELECT u.id, u.tenant_id, u.nombre, u.email, u.rol, u.telefono,
             u.sucursal_id, s.nombre AS sucursal_nombre,
             u.proveedor_id, u.activo, u.creado_en
        FROM public.usuarios u
        LEFT JOIN public.sucursales s ON s.tenant_id = u.tenant_id AND s.id = u.sucursal_id
       WHERE u.tenant_id = $1
       ORDER BY u.id ASC
      `,
      [tenant.tenantId],
    );
  }

  @Post()
  async crearUsuario(@Body() body: any) {
    const tenant = TenantContext.require();
    const nombre = String(body?.nombre || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || 'Fashion2026!');
    const rol = String(body?.rol || 'cajero').toLowerCase();

    if (!nombre || !email || !email.includes('@')) {
      throw new BadRequestException('Nombre y correo electronico valido son obligatorios.');
    }
    if (!['admin', 'encargado', 'cajero', 'proveedor', 'cliente'].includes(rol)) {
      throw new BadRequestException(`Rol invalido: ${rol}`);
    }

    return Db.tx(
      async (client) => {
        const dup = await client.query(
          'SELECT id FROM public.usuarios WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
          [tenant.tenantId, email],
        );
        if (dup.rowCount > 0) {
          throw new ConflictException('Ya existe un usuario con ese correo en esta tienda.');
        }

        const hash = bcrypt.hashSync(password, 10);
        const ins = await client.query(
          `
          INSERT INTO public.usuarios (tenant_id, nombre, email, password_hash, rol, telefono, sucursal_id, proveedor_id, activo)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
          RETURNING id, tenant_id, nombre, email, rol, telefono, sucursal_id, proveedor_id, activo, creado_en
          `,
          [
            tenant.tenantId,
            nombre,
            email,
            hash,
            rol,
            body?.telefono ? String(body.telefono) : null,
            body?.sucursal_id ? Number(body.sucursal_id) : null,
            body?.proveedor_id ? Number(body.proveedor_id) : null,
          ],
        );
        return ins.rows[0];
      },
      { requireWrite: true },
    );
  }

  @Patch(':id')
  async actualizarUsuario(@Param('id') id: string, @Body() body: any) {
    const tenant = TenantContext.require();
    const rows = await Db.query(
      `
      UPDATE public.usuarios
         SET nombre = COALESCE($3, nombre),
             rol = COALESCE($4, rol),
             telefono = COALESCE($5, telefono),
             sucursal_id = COALESCE($6, sucursal_id),
             activo = COALESCE($7, activo)
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, tenant_id, nombre, email, rol, telefono, sucursal_id, proveedor_id, activo
      `,
      [
        tenant.tenantId,
        Number(id),
        body?.nombre ?? null,
        body?.rol ?? null,
        body?.telefono ?? null,
        body?.sucursal_id !== undefined ? Number(body.sucursal_id) : null,
        body?.activo !== undefined ? Boolean(body.activo) : null,
      ],
      { requireWrite: true },
    );
    if (rows.length === 0) throw new NotFoundException('Usuario no encontrado en esta tienda.');
    return rows[0];
  }
}

@Module({
  controllers: [UsuariosController],
})
export class UsuariosModule {}
