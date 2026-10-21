# Nexo: cliente actual

Interfaz React/Motion en AppKit/WKWebView para Mac y UIKit/WKWebView para iPhone/iPad. El [README principal](../../README.md) contiene funciones, requisitos, comandos de compilación/pruebas y límites de verificación.

## Uso local sin Drive

La app permite crear espacios y usar agenda, personas, asistencia, voluntariado, PDF y copias locales sin configurar una cuenta de Google. El navegador de desarrollo usa datos ficticios y no sustituye almacenamiento ni PDF nativos.

Entra en esta carpeta y ejecuta `pnpm install --frozen-lockfile`, seguido de `pnpm dev`, `pnpm test` o `pnpm build`. El gestor fijado es 11.19.0. El servidor de desarrollo escucha en `127.0.0.1:5188`; no es un servicio requerido por la app empaquetada.

## Paquete Mac sin configuración OAuth

Desde la raíz, `zsh Next/Experience/build-experience.sh` compila e instala en `~/Applications/Nexo.app`. Comprueba que esté cerrada y conserva la app anterior y una copia del archivo principal existente. Para impedir que incorpore una configuración OAuth presente en el Mac, indica en `NEXO_GOOGLE_CONFIG` una ruta a un archivo inexistente; no cambies ni borres la configuración original. Esto conserva el código de colaboración.

`VALENTINA_APP_DIR` cambia la salida de la app y `VALENTINA_BUILD_DIR` su directorio de compilación. Una salida distinta no aísla los datos al ejecutar. Por defecto la firma es ad-hoc; no se produce notarización ni ZIP/DMG. Consulta [preparación de versiones](../../RELEASING.md).

## Colaborar por Google Drive

Drive es la integración remota del cliente y es opcional: se conecta una cuenta y se vincula cada espacio de forma explícita. Conectar una cuenta no sube automáticamente todos los espacios locales. El propietario comparte la carpeta en Drive; Nexo no envía invitaciones.

Mac usa OAuth en navegador externo, PKCE y tokens en llavero. Solicita el alcance `drive`. La configuración OAuth y las sesiones no se incluyen en esta copia; el propietario debe configurar su propio cliente para usar colaboración. iOS conserva la dependencia GoogleSignIn para compilar el código de colaboración, aunque el uso local no requiere iniciar sesión. Antes de distribuir hay que revisar alcance, permisos entre cuentas y requisitos de Google.

Las ediciones locales y su cola se guardan en la misma revisión. La sincronización conserva alternativas cuando hay conflictos. Las copias importadas mantienen historial y cambios pendientes, pero dejan Drive en pausa. La disponibilidad remota depende de Google y de los permisos de la carpeta. Drive no sustituye una copia independiente.

## Guardado y recuperación

En Mac se mantiene `~/Library/Application Support/Valentina-Experience/workspace-v1.json`. El núcleo valida relaciones y revisiones y conserva copias antes de reemplazar el principal. Al guardar retiene las 60 copias más recientes y después una por hora durante dos días, una por día hasta 60 días y una por semana para las más antiguas. El historial causal de Drive no se compacta.

Las exportaciones incluyen plantillas guardadas con sus PDF e imágenes; la suma SHA-256 no cifra los datos. Los borradores se guardan aparte. Restaurar valida la copia, conserva el archivo anterior y pausa Drive. No se debe copiar el JSON de la alfa VRR sobre este almacenamiento.

## Interfaz 0.4

Tres áreas: Encuentros, Personas y Documentos. En Mac/iPad amplio hay barra lateral; en iPad vertical, agenda y encuentro junto a pestañas inferiores. En iPhone el encuentro se abre encima de la agenda. Tocar o deslizar en la fila puede registrar asistencia; el voluntariado mantiene selección manual. Excusadas, pendientes y registros retirados no cuentan en el porcentaje.

La [guía iOS](iOS/README.md) explica preparación de recursos y configuración opcional. La ejecución visual de la compilación actual sigue pendiente; consulta el estado de pruebas en el README principal.
