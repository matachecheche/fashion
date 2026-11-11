# APLICAR ESTA REPARACIÓN CI/GHCR

IMPORTANTE: este ZIP NO tiene una carpeta superior `fashionstore/`. Sus rutas son relativas a la raíz del repositorio.

1. Abre la carpeta local del repositorio `fashionstore`, la que contiene `backend-nest`, `mobile-app`, `.github` y `tools`.
2. Extrae TODO el contenido de este ZIP directamente en esa carpeta. Acepta sobrescribir archivos. No lo extraigas dentro de otra carpeta `fashionstore`.
3. Desde esa misma raíz ejecuta:

```bash
python3 -m unittest discover -s tools -p 'test_*.py' -v
```

4. Comprueba los archivos:

```bash
node -p "require('./mobile-app/package.json').version"
grep -n -B 2 -A 2 'specificStatus' backend-nest/src/ia/asistente-context.ts
grep -n 'APP_VERSION' mobile-app/src/config.ts
```

El resultado esperado de la versión es `2.0.1`. En `isAssistantDetailRequest`, `const specificStatus` debe aparecer antes del `if` que consulta esa variable.

5. En `backend-nest` ejecuta `npm ci --legacy-peer-deps` y luego `npm run build`.
6. Solo cuando la compilación y las pruebas pasen, sube los cambios:

```bash
git add -A
git commit -m "fix: correct NestJS CI and mobile version metadata"
git push origin main
```

No modifica Neon, migraciones, secretos, configuración Azure ni datos desplegados.
