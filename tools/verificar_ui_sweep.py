#!/usr/bin/env python3
"""
FASHIONSTORE — Verificación de UI por Chromium headless
=======================================================
Recorre las rutas principales de la tienda y el panel administrativo en la
pila local en marcha, registra errores de consola/página y guarda capturas.

Requisitos: stack vivo (`iniciar.bat` / `iniciar.py`), web en BASE_URL,
credenciales semilla admin@fashionstore.bo / Fashion2026! (tenant legacy).

Uso:
    python3 tools/verificar_ui_sweep.py             # usa http://localhost:5173
    BASE_URL=http://192.168.0.10:5173 python3 tools/verificar_ui_sweep.py

Códigos de salida: 0 = 13/13 rutas OK · 1 = fallos (imprime el detalle).
NOTA: solo lectura; no crea ventas ni reservas (para eso ver docs/VERIFICACION.md §11).
"""

import asyncio
import os
import sys

BASE = os.environ.get('BASE_URL', 'http://localhost:5173').rstrip('/')
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'screenshots', 'sweep')

ROUTES = [
    ('tienda-ayuda', '/tienda/legacy/ayuda'),
    ('tienda-mis-pedidos', '/tienda/legacy/mis-pedidos'),
    ('tienda-mis-reservas', '/tienda/legacy/mis-reservas'),
    ('tienda-perfil', '/tienda/legacy/perfil'),
    ('panel-ventas', '/panel/ventas'),
    ('panel-reservas', '/panel/reservas'),
    ('panel-inventario', '/panel/inventario'),
    ('panel-productos', '/panel/productos'),
    ('panel-maestros', '/panel/maestros'),
    ('panel-propuestas', '/panel/propuestas'),
    ('panel-reportes', '/panel/reportes'),
    ('panel-suscripcion', '/panel/suscripcion'),
    ('panel-usuarios', '/panel/usuarios'),
]


async def main() -> int:
    from playwright.async_api import async_playwright

    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await (await browser.new_context(viewport={'width': 1280, 'height': 800})).new_page()
        errors = []
        page.on('console', lambda m: errors.append(f'console.{m.type}@{page.url}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror@{page.url}: {e}'))

        await page.goto(f'{BASE}/tienda/legacy/auth', wait_until='networkidle', timeout=45000)
        await page.locator('input[type="email"]').fill('admin@fashionstore.bo')
        await page.locator('input[type="password"]').fill('Fashion2026!')
        await page.get_by_role('button', name='Ingresar').click()
        await page.wait_for_url('**/catalogo**', timeout=20000)

        fallos = 0
        for name, path in ROUTES:
            try:
                await page.goto(f'{BASE}{path}', wait_until='networkidle', timeout=45000)
                await page.screenshot(path=os.path.join(OUT, f'{name}.png'))
                print(f'{name:28s} OK')
            except Exception as exc:
                fallos += 1
                print(f'{name:28s} FALLO: {exc}')
                errors.append(f'{name}: {exc}')
        await browser.close()

    if errors:
        print('\nERRORES DETECTADOS:')
        for e in errors[:30]:
            print(' -', e)
        return 1
    print('\nSWEEP_OK')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
