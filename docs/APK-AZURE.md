# Generar APK de FashionStore en la nube de Azure

Este flujo usa **Azure Pipelines con un agente Microsoft-hosted `ubuntu-24.04`**. El agente efímero instala/usa Node 22, Java 17 y Android SDK; Expo genera el proyecto Android nativo y Gradle compila el APK. El archivo queda publicado como artefacto descargable del run de Azure Pipelines.

## Qué construye

- APK Android `debug`, firmado por Gradle con la clave debug temporal del agente.
- Compatible con instalación para pruebas internas y evaluación académica.
- Incluye `EXPO_PUBLIC_API_URL` dentro del bundle; por eso se valida antes que `https://<fqdn-api>/api/health` responda `{"estado":"ok"}`.
- **No es una firma estable para Google Play ni para actualizar una instalación firmada con otra clave.** Como la clave debug del agente es temporal, al instalar un APK de un run distinto puede ser necesario desinstalar la versión de prueba anterior. Para distribución y actualizaciones estables se debe configurar un keystore propio como Secure File de Azure Pipelines y habilitar un perfil release.

## Configuración única en Azure DevOps

1. Sube el proyecto actualizado a GitHub (incluido `azure-pipelines-apk.yml`).
2. Abre Azure DevOps y entra en una organización y proyecto. Si todavía no tienes uno, crea ambos desde Azure DevOps.
3. En **Pipelines → Library → Variable groups → Add**, crea el grupo `fashionstore-mobile`.
4. Añade la variable `EXPO_PUBLIC_API_URL` con la URL pública del API terminada en `/api`, por ejemplo `https://fashionstore-api-xxxx.azurecontainerapps.io/api`. Déjala como variable no secreta: es una URL pública y se incorporará al bundle Android. Guarda el grupo y autoriza su uso en el pipeline.
5. En **Pipelines → New pipeline**, selecciona **GitHub**, autoriza la conexión y selecciona el repositorio `fashionstore`.
6. En la detección/configuración selecciona **Existing Azure Pipelines YAML file** y elige `/azure-pipelines-apk.yml`.
7. Guarda el pipeline. Tanto el pipeline como el grupo de variables quedan configurados; en compilaciones posteriores solo tienes que pulsar **Run pipeline**. No tendrás que volver a escribir la URL.

## Compilar un APK

1. En Azure DevOps abre **Pipelines → FashionStore Android APK → Run pipeline**.
2. Ejecuta el pipeline. El job lee `EXPO_PUBLIC_API_URL` desde el grupo `fashionstore-mobile`, valida `/health` y se detiene antes de compilar si el API no está saludable.
3. Espera que las etapas terminen en verde. Abre el resumen de la ejecución, sección **Related → Published**, y descarga el artefacto **FashionStore-APK**.
4. Descomprime el artefacto y transfiere `FashionStore-azure-debug-<BuildId>.apk` al dispositivo Android para instalarlo.
5. Solo cuando cambie el FQDN público de NestJS debes editar la variable `EXPO_PUBLIC_API_URL` en el grupo; no hace falta editar el código ni volver a configurar el pipeline.

## Qué hace el pipeline automáticamente

1. Comprueba que la URL sea HTTPS y termine en `/api`.
2. Consulta `GET <EXPO_PUBLIC_API_URL>/health` y exige `estado=ok`.
3. Instala dependencias mediante `npm ci --legacy-peer-deps`.
4. Ejecuta `tsc --noEmit`.
5. Ejecuta `expo prebuild --platform android --clean --no-install`.
6. Ejecuta Gradle `:app:assembleDebug` en el agente Azure.
7. Comprueba que el APK exista, sea un ZIP válido y tenga firma Android verificable.
8. Publica el APK y un archivo informativo con el commit y SHA-256.

## Diferencia con EAS

`mobile-app/build-apk.bat` y `mobile-app/build-apk.sh` siguen siendo la vía alternativa de **Expo EAS Build**. EAS compila en la infraestructura de Expo, no en Azure. Para compilar en infraestructura de Azure usa el pipeline `azure-pipelines-apk.yml`.

## Costos, límites y seguridad

- Azure Pipelines usa un agente hospedado temporal; su disponibilidad, minutos paralelos y cuota dependen de la organización/proyecto. No se crea Container App, VM ni recurso de cómputo permanente para compilar.
- El proceso necesita conectividad para descargar dependencias npm/Android. Si el agente no obtiene una herramienta o cuota disponible, el run falla mostrando el paso concreto.
- La variable `EXPO_PUBLIC_API_URL` es pública y queda embebida en la app. Nunca configures `DATABASE_URL`, `JWT_SECRET`, `IA_INTERNAL_KEY`, claves de IA o credenciales en `EXPO_PUBLIC_*`.
- Este APK es para pruebas internas. La firma debug temporal no sustituye una clave privada estable para distribución.
