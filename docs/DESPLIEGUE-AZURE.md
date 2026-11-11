# Despliegue de prueba Azure — FashionStore

> **Estado:** el flujo asistido está implementado, pero todavía no se ha ejecutado contra una cuenta Azure/Neon real ni se verificó en Windows. Las pruebas de esta revisión son locales y no crean recursos cloud.
>
> **Costo:** el flujo usa Azure Container Apps **Express** (Consumption), mínimo de cero réplicas, máximo de una por app, imágenes públicas GHCR y `--logs-destination none`; no crea ACR, Log Analytics, Application Insights ni una VNet. Express no cobra aprovisionamiento del entorno y solo consume cómputo cuando hay réplicas activas. Aun así, **no se puede garantizar un costo Azure total de $0**: las concesiones gratuitas mensuales publicadas para Container Apps son 180,000 vCPU-seconds, 360,000 GiB-seconds y 2 millones de solicitudes por suscripción; el exceso, transferencia de datos u otros servicios puede facturarse. Neon y el proveedor LLM opcional pueden tener sus propios límites/costos. Revisa precios y consumo antes y después del despliegue; no es alojamiento gratuito ilimitado.
>
> **Proveedor de imágenes:** GHCR fue confirmado por el usuario. El workflow publica tres imágenes que deben hacerse públicas manualmente en GitHub Packages; la visibilidad pública expone código compilado y no puede revertirse a privada. No publiques secretos ni archivos `.env`.
>
> **Visibilidad:** con la ruta provisional GHCR, las tres imágenes deben ser públicas. Esto puede exponer código compilado de la aplicación y GitHub no permite volver privado un paquete público. No publiques secretos ni archivos `.env`.

## Arquitectura

- **Neon PostgreSQL:** el usuario prepara una base/branch dedicada. El asistente usa la URL del owner solo para inicializar; acepta URL directa o pooled y normaliza la pooled a directa para migraciones. Una base FashionStore reconocible puede restaurarse con confirmación; las tablas ajenas se preservan y bloquean la operación. Las apps usan TLS y el pooler de Neon.
- **Azure Container Apps Express (Consumption):** NestJS/API, FastAPI y web/Nginx usan HTTPS; mínimo de cero y máximo de una réplica por app. Express no tiene service discovery entre apps, por eso Nest llama a FastAPI por su FQDN HTTPS público. FastAPI exige la clave `IA_INTERNAL_KEY` en todos los endpoints de negocio, guarda credenciales como secretos ACA y tiene desactivada la documentación interactiva en producción. No se crean ACR, Log Analytics ni otros recursos de observabilidad facturables. Las rutas de negocio de FastAPI requieren la clave de servicio; solo las rutas de salud mínimas son públicas. CORS se restringe al origen web, pero no sustituye la autenticación.
- **GitHub Container Registry (GHCR):** GitHub Actions construye y publica las tres imágenes públicas; ACA las descarga anónimamente. No se necesita Docker local, identidad `AcrPull` ni credenciales de registry en Azure.
- **IA generativa:** opcional, admite Groq y Gemini simultáneamente. Las claves quedan como secretos de FastAPI en Azure Container Apps. El cliente consulta los modelos disponibles de cada proveedor y prueba los compatibles; si Groq falla, intenta Gemini y después usa reglas locales. Las claves nunca se escriben en el archivo de estado ni en el ZIP.
- **Stripe:** opcional, Checkout en modo test. Si se omite, Stripe Checkout no queda configurado y solo permanece el simulador local/sandbox.

La web se compila una sola vez con `VITE_API_URL=/api` y `nginx.azure.conf`. En Azure, Nginx recibe `API_UPSTREAM=https://<API_FQDN>` al arrancar y hace proxy same-origin para `/api` y `/assets/prendas/`; así GHCR puede publicar una imagen reutilizable sin conocer el FQDN Azure. El Nginx de Compose sigue usando su propia configuración `nginx.conf`.

## Requisitos locales en Windows

1. Azure CLI y una suscripción habilitada. El BAT ejecuta `az login` si no hay sesión e instala `containerapp` solo si falta; si ya existe, conserva la versión instalada para evitar cambios inesperados.
2. Python 3.10+ (`py -3` o `python`) y un cliente SQL: `psql` en `PATH`, o Node.js con `backend-nest/node_modules/pg` instalado (`cd backend-nest && npm ci`). No hace falta un servidor PostgreSQL ni Docker locales.
3. Un repositorio GitHub con Actions habilitadas. El workflow `.github/workflows/publish-ghcr.yml` construye las imágenes al hacer push a `main` o desde `workflow_dispatch`; luego debes cambiar las tres a visibilidad **Public** en GitHub Packages. Este paso público es irreversible y expone las imágenes compiladas.
4. Internet, navegador y una base/branch Neon dedicada a FashionStore. Puede estar vacía o contener una instalación reconocible de FashionStore que se vaya a restaurar; no se deben usar bases de otras aplicaciones.
5. Una suscripción Azure con Container Apps Express disponible en la región elegida y permisos para registrar `Microsoft.App` y crear recursos (normalmente Contributor u Owner). El flujo no registra `Microsoft.OperationalInsights`, no crea ACR/Log Analytics ni asignaciones RBAC.

No pegues URLs ni claves en el chat, en Git, en tickets ni en logs compartidos.

## Ejecutar el flujo asistido

Desde la raíz de FashionStore, haz doble clic en `desplegar-azure.bat` o ejecútalo en CMD:

```bat
desplegar-azure.bat
```

El BAT comprueba Azure CLI y la sesión, instala la extensión oficial `containerapp` solo si falta y reutiliza la versión ya instalada (no la actualiza en cada ejecución), valida Python 3.10+ y comprueba que haya `psql` o Node.js. Si falta `psql`, `tools/deploy_azure.py` usa `tools/cloud_sql.js` con el paquete `pg` ya declarado por NestJS; si ese paquete aún no está instalado, ejecuta `cd backend-nest && npm ci` y vuelve a intentar. Docker local no se consulta ni se requiere.

### Perfil persistente: despliegue rápido sin volver a introducir todo

El asistente crea automáticamente `builds/deploy-profile.json` después de recopilar la configuración. En ejecuciones posteriores presenta este menú:

1. **Usar configuración anterior (rápido):** reutiliza suscripción, región, owner GHCR, entorno Express, conexión Neon y proveedores IA. Solo vuelve a preguntar por datos ausentes o que ya no sean válidos y solicita la confirmación final `DEPLOY-TEST`.
2. **Revisar/cambiar opciones:** permite cambiar la configuración; los valores aceptados reemplazan el perfil para la próxima ejecución.
3. **Abrir archivo de configuración:** abre el JSON en el editor predeterminado para editar opciones no secretas y volver a ejecutar el BAT.
4. **Cancelar.**

El perfil contiene valores editables como `subscription_id`, `location`, `ghcr_owner`, `environment_id`, `environment_name`, `environment_resource_group`, `neon_strategy`, `llm_providers` y `stripe_setup_choice`. `neon_strategy` se guarda como `reuse` para que el modo rápido nunca restaure ni borre datos por sorpresa. Una restauración destructiva sigue requiriendo selección expresa y escribir `RESTABLECER-DEMO`.

La URL de Neon y las claves Groq/Gemini se almacenan **cifradas dentro del mismo archivo JSON** mediante Windows DPAPI (`CurrentUser`). Solo el mismo usuario de Windows en el mismo equipo puede descifrarlas. No quedan en texto plano, no se escriben en `azure-test-deployment.json` y `builds/` está excluido de Git. Si cambias de equipo o de usuario de Windows, el asistente no podrá descifrarlas y te pedirá las credenciales otra vez. En sistemas que no sean Windows, solo se guardan las opciones no secretas y las credenciales se solicitarán al volver a ejecutar.

Para editar el perfil, elige la opción 3 del menú. No pegues credenciales en campos ordinarios del JSON: cambia Neon/Groq/Gemini desde la opción 2; el asistente las guarda cifradas automáticamente. Para desactivar un proveedor IA en el modo rápido, quítalo de `llm_providers` (por ejemplo, `[]`). Para no volver a recibir la pregunta opcional de Stripe tras haberla omitido, el asistente guarda `stripe_setup_choice: "skip"`. Si Stripe ya estaba configurado y despliegas una nueva API con una URL distinta, tendrás que revisar/crear el webhook para esa URL nueva.

El modo rápido no omite las comprobaciones reales: vuelve a validar acceso a la suscripción, política/región, imágenes GHCR, entorno Express y conexión Neon. Si un valor guardado dejó de funcionar, el asistente vuelve a solicitar solo ese dato y actualiza el perfil. El archivo se crea dentro de `builds/`, carpeta ignorada por Git.

### Publicar las imágenes públicas GHCR antes de desplegar

1. Sube este proyecto a un repositorio GitHub y ejecuta `.github/workflows/publish-ghcr.yml` (push a `main` o `workflow_dispatch`). El workflow publica `fashionstore-ai`, `fashionstore-api` y `fashionstore-web` bajo `ghcr.io/<owner>/` con `latest` y el SHA del commit.
2. En GitHub, abre **Packages** para el owner y cambia cada uno de esos tres paquetes a **Public**. La imagen web se publica con `/api` y proxy Nginx en tiempo de ejecución. No compartas ni copies tokens; el despliegue prueba lectura anónima antes de tocar Neon.
3. No despliegues hasta que el run de Actions esté verde y los tres paquetes tengan visibilidad Public. Si el owner es una organización que prohíbe paquetes públicos, se debe habilitar esa política o usar un owner permitido.

Las imágenes públicas pueden revelar el código compilado de Nest/FastAPI; confirma que eso está permitido. La visibilidad pública no se puede revertir a privada en GitHub Packages.

### A. Selección Azure y Neon manual en navegador

1. Si no hay sesión, sigue el inicio de sesión Microsoft que abre `az login`. En la primera configuración o en el modo **Revisar/cambiar**, el asistente solicita confirmación explícita para GHCR; responde `N` si quieres detenerte antes del preflight y, si confirmas, escribe `CONTINUAR`. En **Usar configuración anterior (rápido)** no vuelve a solicitar estas dos confirmaciones porque GHCR ya fue aceptado y los datos están en el perfil local.
2. Elige o reutiliza la suscripción, una región compatible con Express y owner GitHub. Luego se registra solo `Microsoft.App` si hace falta (metadatos) y se verifica lectura anónima de las tres imágenes antes de abrir Neon; aún no se crean recursos ni se modifica la base. Si el owner tiene un error de escritura y las imágenes no se encuentran, permite volver a introducirlo. Regiones publicadas incluyen `brazilsouth`, `chilecentral`, `eastus` y `westus2`; la región elegida también debe estar disponible para la suscripción y permitida por cualquier directiva de Azure for Students. El preflight revisa las asignaciones de Azure Policy antes de tocar Neon y sugiere regiones Express permitidas si la seleccionada está bloqueada.
3. Antes de abrir Neon, el asistente consulta los Container Apps Environments de la suscripción. Si ya existe uno en la región elegida, lo muestra y permite reutilizarlo o cambiar a otra región permitida. Si la extensión Azure CLI no incluye `environmentMode` en la respuesta de lista, consulta la propiedad del recurso directamente en Azure Resource Manager para no pasar por alto un entorno Express. Si Azure rechaza la creación por `MaxNumberOfRegionalExpressEnvironmentsInSubExceeded`, vuelve a buscar entornos existentes y permite reutilizar uno o elegir otra región permitida. Esto evita crear un segundo entorno cuando Azure for Students u otra suscripción tiene un límite regional más estricto. Un entorno Express reutilizado no se modifica ni se elimina.
4. El script abre [Neon Console](https://console.neon.tech/). Usa una base/branch dedicada a FashionStore. La URL puede ser directa o pooled; si el host contiene `-pooler`, el asistente lo convierte automáticamente al host directo para ejecutar el bootstrap.
5. Pega localmente la URL PostgreSQL del owner en el prompt oculto. No se muestra ni se escribe al repo. El asistente comprueba TLS y clasifica la base: vacía, FashionStore reconocible o ajena. Si la URL está mal escrita o Neon rechaza usuario/contraseña/host/base durante la conexión, solicita volver a introducirla. Las bases ajenas se rechazan sin borrarlas.
6. Si Neon ya contiene FashionStore, el asistente siempre ofrece tres opciones y por defecto propone reutilizar: no borra pedidos, clientes, pagos, tablas ni vuelve a ejecutar schema/migraciones/seed; verifica las cinco cuentas semilla y vuelve a preparar el rol runtime. Esto también funciona aunque ejecutes el ZIP desde una carpeta nueva y no tengas el archivo de estado local anterior. Si la verificación falla, el proceso se detiene sin borrar la base; puedes inspeccionarla o volver a ejecutar y elegir restaurar explícitamente. La restauración destructiva exige escribir `RESTABLECER-DEMO`; no la elijas si hay datos que conservar.
7. El asistente ofrece configurar Groq y Gemini por separado; puedes configurar uno, ambos o ninguno. Groq debe usar una clave `gsk_...`. Gemini acepta claves nuevas con prefijo `AQ.` (por ejemplo, `AQ.Ab8RN6KzvT-...`) y claves anteriores `AIza...` que estén correctamente restringidas para Gemini API; la clave se envía mediante el encabezado `x-goog-api-key`, no como parámetro URL. Google ha iniciado la transición a claves de autorización y puede rechazar claves estándar antiguas aunque su formato sea válido. Ambas claves se solicitan ocultas y se guardan solo como secretos ACA. Si una clave tiene un formato incorrecto, el asistente vuelve a pedirla y permite pulsar Enter para omitir ese proveedor. Las claves `rk_test_...` y `sk_test_...` pertenecen a Stripe en modo test, no a Groq ni a Gemini: si se pegan por error en el campo de IA, el asistente lo indica y vuelve a pedir una clave IA. Stripe se configura en un paso separado después de publicar la API; allí también se solicita el secreto `whsec_...` del webhook.
8. Lee el resumen de cambios y escribe `DEPLOY-TEST` para confirmar. Si escribes mal `CONTINUAR`, `RESTABLECER-DEMO` o `DEPLOY-TEST`, el asistente permite volver a introducir el texto; escribe `CANCELAR` para salir de ese paso.

**Sobre Neon:** la URL pooled se normaliza automáticamente a directa para el proceso de preparación; las apps usan el endpoint pooler. Si hay tablas no reconocidas, el proceso se detiene y no las toca. Cuando reconoce FashionStore, la opción predeterminada es reutilizar y verificar la base sin borrar datos. La restauración desde cero solo se ejecuta tras elegir esa opción y escribir `RESTABLECER-DEMO`.

Neon es PostgreSQL administrado: el usuario owner tiene privilegios mediante la membresía `neon_superuser`, pero no el atributo PostgreSQL `SUPERUSER`. Por eso Neon rechaza `ALTER ROLE ... NOSUPERUSER` aunque solo se intente fijar el atributo en falso. La migración 005 y el aprovisionamiento de `fashionstore_app` no incluyen ese atributo en instrucciones `ALTER ROLE`; los roles se crean como no-superusuarios por defecto y el script comprueba sus atributos reales (`rolsuper` y `rolbypassrls`) antes de continuar.

Si un intento anterior se detuvo después de ejecutar parte de una migración, el preflight reconoce la base si conserva suficientes tablas principales de FashionStore. Ejecuta de nuevo el asistente con el ZIP corregido y usa la misma base/branch dedicada. Primero elige reutilizar: se hará una verificación sin borrar datos. Si la verificación revela que la instalación quedó incompleta y deseas reconstruir la demo, vuelve a ejecutar y elige restaurar; se eliminarán únicamente los objetos del esquema `public` de esa base dedicada y se aplicará de nuevo el esquema, las migraciones y la semilla. No confirmes la restauración si la base contiene datos que quieras conservar.

### B. Preparación de Neon

Con la confirmación, el asistente verifica antes de escribir que estén exactamente las ocho migraciones revisadas `003`–`010` y luego aplica los archivos en este orden:

1. `database/schema.sql`
2. `database/migrations/003` a `010` en orden de nombre; si falta una o hay un `.sql` inesperado, se detiene antes de modificar Neon
3. `database/seed.sql`
4. Crea o actualiza `fashionstore_app`, miembro de `app_runtime` y `app_readonly`, sin `SUPERUSER`, `CREATEDB`, `CREATEROLE` ni `BYPASSRLS`.
5. No modifica ni desactiva usuarios, hash de contraseñas, roles o datos semilla: las cinco cuentas permanecen como en local (`Fashion2026!`).
6. Verifica los cinco inicios de sesión seed, cuenta las filas por tabla y guarda esos conteos y las huellas SHA-256 de los archivos SQL en los metadatos del despliegue. Además comprueba acceso de lectura/RLS para el rol runtime.

La URL de owner y las contraseñas se pasan localmente a `psql` o, si no está instalado, al ayudante Node mediante variables de entorno. El payload de Azure se escribe en un archivo temporal protegido y se elimina después; los secretos no se guardan en `builds/azure-test-deployment.json`. El archivo de estado contiene solo IDs, nombres, FQDNs, resultados de verificación y conteos/huellas de la semilla. También se mantiene un historial acotado en `builds/azure-test-deployments.json`. El estado y el historial no contienen secretos. El único archivo de perfil `builds/deploy-profile.json` guarda la URL Neon y las claves Groq/Gemini cifradas con Windows DPAPI; nunca las conserva en texto plano. Este perfil está dentro de `builds/`, excluido de Git.

### C. Recursos y pruebas Azure

El script muestra un Resource Group nuevo, por ejemplo `rg-fashionstore-test-<sufijo>`, y crea allí tres apps dentro de un environment **Express** con `--logs-destination none`. Si la suscripción ya tiene un entorno Express en la región, ofrece reutilizarlo (también puede estar en otro Resource Group) o seleccionar otra región permitida. Si Azure devuelve `MaxNumberOfRegionalExpressEnvironmentsInSubExceeded` aunque el preflight no lo hubiera detectado, el asistente no repite el mismo intento: vuelve a consultar los entornos y ofrece reutilizar uno o probar otra región permitida. Las tres apps escalan a cero (`minReplicas=0`) y tienen `maxReplicas=1`. No crea ACR, identidad administrada, workspace Log Analytics, Application Insights, VNet ni otro recurso de monitoreo; por eso no habrá logs centralizados persistentes. Los logs en vivo de Express son distintos de enviar logs a Log Analytics.

El flujo usa las imágenes GHCR públicas ya verificadas. Nest se crea primero con ingress interno y, tras cargar sus secretos, se habilita su endpoint HTTPS público. FastAPI tiene ingress HTTPS público desde su primera revisión, acorde con Express, donde las apps se comunican mediante URLs públicas. La clave aleatoria `IA_INTERNAL_KEY` se guarda como secreto en FastAPI y Nest: FastAPI la exige en sus rutas de negocio y Nest la envía en las llamadas de servicio a servicio. La salud pública no devuelve datos comerciales; OpenAPI/Swagger queda desactivado en producción. La web recibe `API_UPSTREAM=https://<API_FQDN>` y Nginx hace proxy same-origin para `/api` y `/assets/prendas/`. Después el script establece `CORS_ORIGINS` en Nest y FastAPI al origen exacto de la web (`https://<WEB_FQDN>`, sin slash final). Si FastAPI responde `/health`, Nest responde `/api/health` con su conexión Neon y la web responde HTTP 200, el script marca la comprobación como **despliegue cloud verificado**.

El estado sin secretos queda en:

```text
builds/azure-test-deployment.json
```

Si el despliegue falla después de crear el Resource Group nuevo, el asistente intenta eliminarlo automáticamente. Solo borra el grupo aleatorio que acaba de crear y que verificó que no existía; no elimina grupos preexistentes, Neon ni un entorno Express que haya reutilizado. Si la limpieza automática no se completa, revisa el estado/consumo y elimina **solo ese grupo** si contiene únicamente esta prueba. En PowerShell/CMD:

```powershell
az group delete --name <resource_group_del_archivo_de_estado> --yes --no-wait
```

Neon no se borra al eliminar Azure. Si el asistente falló después de preparar Neon, el archivo de estado conserva el punto alcanzado y el seed reportado. En cualquier siguiente ejecución, si reconoce tablas de FashionStore, ofrece reutilizar la base sin borrar datos o restaurarla expresamente; ya no depende de que el archivo de estado anterior esté presente. Si la ejecución se interrumpió antes de crear suficientes tablas para reconocerla, el asistente la clasificará como desconocida y se detendrá por seguridad: inspecciona esa base o utiliza un branch Neon vacío; no borres datos ajenos para forzar la recuperación.

Por defecto, el asistente limpia el Resource Group nuevo tras un fallo para reducir recursos abandonados. Para conservar temporalmente los recursos de diagnóstico, ejecuta desde la raíz: `python tools/deploy_azure.py --keep-failed-resources` (también se puede definir `FASHIONSTORE_KEEP_FAILED_RESOURCES=1`). No uses esa opción si no vas a revisar después los recursos, porque el consumo Azure puede continuar.

## Stripe Checkout de prueba (opcional)

Al terminar la comprobación HTTP, responde `s` si quieres configurar Stripe ahora. El script abre el Dashboard en **modo test** y muestra el endpoint:

```text
https://<API_FQDN>/api/pagos/webhooks/stripe-checkout
```

Crea allí un webhook en modo test con estos eventos:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Luego pega localmente y con entrada oculta la clave `rk_test_...` o `sk_test_...` y el secreto `whsec_...`. El asistente rechaza prefijos `live`, envía los secretos a Container Apps mediante un archivo temporal local y borra ese archivo al terminar la petición. Nunca pongas esos valores en el build de la web, en `VITE_*`, Git o este documento.

Si eliges no configurar Stripe durante el despliegue, Checkout real queda desactivado. También se puede configurar luego en Azure Portal: en la Container App Nest crea secretos `stripe-key` y `stripe-hook`; referencia `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` a esos secretos en Environment variables, mantén `PAGOS_MODO=sandbox` y `PUBLIC_API_URL=https://<API_FQDN>`, y crea una nueva revisión. Solo ingresa claves de test.

Prueba con tarjeta Stripe de test, por ejemplo `4242 4242 4242 4242`, fecha futura y CVC de prueba. No uses una tarjeta real. El retorno del navegador no aprueba el pago: el backend solo debe confirmarlo tras validar la firma del webhook. La compatibilidad de moneda BOB y el flujo de compra no se han probado con credenciales de este proyecto.

## Comprobación manual posterior

```powershell
curl.exe -i "https://<FASTAPI_FQDN>/health"
curl.exe -i "https://<API_FQDN>/api/health"
curl.exe -I "https://<WEB_FQDN>/"
az containerapp show --name <api_app> --resource-group <resource_group>
az containerapp replica list --name <api_app> --resource-group <resource_group>
```

`/api/health` debe devolver HTTP 200 y JSON con `"estado":"ok"`; esta comprobación también consulta PostgreSQL. La web debe devolver HTTP 200. Prueba manualmente catálogo, login, carrito y, si se configuró, Stripe test. Un HTTP 200 por sí solo no prueba el webhook ni una compra.

Problemas habituales:

- **El BAT vuelve al prompt justo después del banner:** actualiza la copia del proyecto. En Windows Azure CLI suele instalar `az.cmd`; el BAT debe invocarlo con `call az` para que la ejecución continúe. Ese síntoma ocurre antes de Neon y no crea recursos.
- **Error del cliente SQL/migraciones:** verifica que la URL apunte al proyecto Neon correcto y que el owner tenga permisos para crear roles/esquema. El script normaliza URLs pooled; si el host no corresponde al branch, copia Connection Details otra vez. El error `Only roles with the SUPERUSER attribute may change the SUPERUSER attribute` indica una copia antigua de la migración/provisionamiento que intenta ejecutar `ALTER ROLE ... NOSUPERUSER`; actualiza todo el ZIP y vuelve a ejecutar la restauración confirmada. Si se usa el fallback Node y dice que falta `pg`, ejecuta `cd backend-nest && npm ci` desde la raíz del proyecto y vuelve a abrir el BAT.
- **GHCR pull:** vuelve a ejecutar el workflow y confirma que cada paquete `fashionstore-*` sea **Public**. El preflight prueba una descarga anónima de `latest` y se detiene antes de Neon si falta una imagen o el paquete es privado.
- **`LinkedInvalidPropertyId` en `properties.environmentId` con texto `#< CLIXML`:** era una contaminación de salida de Windows PowerShell: los mensajes de error/advertencia de `az.cmd` se mezclaban con la salida que debía contener únicamente el ID ARM del entorno. La versión actual ejecuta `az.cmd` directamente mediante `cmd.exe`, separa stdout y stderr, obtiene el ID del entorno como JSON y valida que tenga la ruta completa `/subscriptions/.../resourceGroups/.../providers/Microsoft.App/managedEnvironments/...` antes de enviarlo a Azure. Nunca se acepta CLIXML como ID.
- **`Timeout esperando Container App ... (último estado: <Objs ... CLIXML>)`:** la versión actual ya no consulta `provisioningState` en TSV ni interpreta stderr como estado. Lee `properties.provisioningState` del JSON completo de `az containerapp show`. Si la consulta falla repetidamente, muestra el último error real; si Azure informa `Failed`, muestra el detalle de aprovisionamiento cuando está disponible. Actualiza el ZIP completo antes de otro intento.
- **Base Neon ya preparada tras un fallo de Azure:** en la siguiente ejecución selecciona `REUTILIZAR`, no `RESTAURAR DEMO`, salvo que de verdad quieras borrar todos los datos comerciales de `public` y cargar el seed. La restauración anterior del log ya dejó preparada la base; no hay motivo para volver a borrar sus tablas y filas para corregir un problema de Azure.
- **Entorno Express reutilizado:** el entorno `fs-test-722939` está en `rg-fashionstore-test-722939`; la limpieza de un intento fallido solo debe afectar el Resource Group nuevo de las aplicaciones. El entorno compartido y Neon deben conservarse. Antes de eliminar cualquier grupo desde Azure Portal, verifica sus recursos y que no contenga el entorno Express que se reutiliza.
- **API `502`/`503`:** revisa el estado de revisión, `DATABASE_URL`, TLS, `JWT_SECRET`, `FASTAPI_URL` y referencias de secretos. La app debe poder leer `meta` como `app_readonly`.
- **API responde pero la web falla:** revisa `API_UPSTREAM` en la Container App web y que la imagen GHCR se publique con `NGINX_CONF=nginx.azure.conf`; el paquete web usa proxy same-origin y no necesita recompilarse con un FQDN Azure.
- **CORS/IA:** tanto Nest como FastAPI deben tener `CORS_ORIGINS=https://<WEB_FQDN>` (sin slash final); el flujo lo configura automáticamente después de crear la web. FastAPI tiene un FQDN HTTPS público que usa Nest para la comunicación Express Nest→FastAPI; como el ingress es público, todos sus endpoints de negocio validan `IA_INTERNAL_KEY`. Las rutas de OpenAPI/Swagger no se publican en producción y la web no llama FastAPI directamente. Para probar las claves IA sin exponerlas, usa el endpoint de estado interno de FastAPI `/asistente/estado?probar=true`; devuelve estado/modelo por proveedor y oculta la clave. Si Groq está fallando pero Gemini responde, la conversación continúa con Gemini.
- **Checkout no configurado:** revisa `PAGOS_MODO=sandbox`, `PUBLIC_API_URL` HTTPS y los secretos Stripe de test. Confirma el evento firmado en el Dashboard.

El Environment se crea sin destino de logs. Antes de habilitar Log Analytics, Application Insights u otro destino, verifica su precio en tu suscripción.

## APK (opcional)

Cuando el endpoint HTTPS de Nest responda saludable, sigue `docs/APK.md`. El APK usa `EXPO_PUBLIC_API_URL=https://<API_FQDN>/api`; requiere EAS y es otro build/servicio, no forma parte de la creación de Container Apps.

## Referencias oficiales

- [Azure Container Apps Express — overview, regiones y capacidades](https://learn.microsoft.com/en-us/azure/container-apps/express-overview)
- [Azure Container Apps Express — despliegue con Azure CLI](https://learn.microsoft.com/en-us/azure/container-apps/deploy-express-cli)
- [Azure Container Apps Express — FAQ y modo de entorno](https://learn.microsoft.com/en-us/azure/container-apps/express-faq)
- [Azure Container Apps — facturación y concesiones gratuitas](https://learn.microsoft.com/en-us/azure/container-apps/billing)
- [Azure Container Apps — precios](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
- [GitHub Packages — visibilidad y acceso a imágenes](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [Azure Container Apps — API ARM/YAML y configuración de apps](https://learn.microsoft.com/en-us/azure/container-apps/azure-resource-manager-api-spec)
- [Azure CLI — `az rest` y body desde archivo](https://learn.microsoft.com/en-us/cli/azure/reference-index?view=azure-cli-latest)
- [Neon — administrar roles](https://neon.com/docs/manage/roles)
- [Neon — connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Stripe — webhooks](https://docs.stripe.com/webhooks)
