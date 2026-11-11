# Parche de compatibilidad de pruebas en Windows

Este parche contiene tres ajustes para que la suite funcione también desde CMD/PowerShell en Windows:

1. `tools/test_azure_apk_build.py`: valida la sintaxis Bash enviando el script por stdin. Evita que Git Bash/MSYS interprete mal una ruta de OneDrive con formato `C:\...`. Si Bash no está instalado localmente, la prueba se marca como omitida; el agente `ubuntu-24.04` de Azure dispone de Bash.
2. `tools/test_deploy_azure.py`: compara rutas de `cmd.exe` sin distinguir mayúsculas/minúsculas, como hace Windows. No cambia la selección del ejecutable ni relaja el rechazo de rutas UNC.
3. `tools/cloud_sql.js`: normaliza saltos CRLF/CR a LF al leer migraciones SQL. El contenido enviado a PostgreSQL queda idéntico en Windows y Linux.

## Aplicación

Extrae este ZIP directamente en la raíz del repositorio, donde existen `backend-nest`, `mobile-app`, `tools` y `.github`. Acepta reemplazar los tres archivos de `tools` y `cloud_sql.js` según sus rutas. No existe una carpeta `fashionstore/` dentro del ZIP para evitar crear una carpeta anidada.

No modifica la base de datos, migraciones, credenciales, variables de Azure, imágenes ni recursos desplegados.

## Verificación

Desde la raíz del repositorio:

```bat
python -m unittest discover -s tools -p "test_*.py" -v
```
