# Nexo

**Organiza encuentros, conoce la participación y coordina a tu equipo en un solo espacio.**

Nexo conecta el calendario de tu organización con las personas que participan, sus registros de asistencia, el voluntariado y los documentos de cada actividad. Está pensado para asociaciones, equipos de voluntariado y grupos que necesitan planificar y mantener un historial claro de su trabajo.

## Del próximo encuentro al registro completo

- **Planifica con contexto.** Reúne fechas, componentes, categorías y participantes en la agenda; edita o duplica encuentros y decide cuáles cuentan para asistencia.
- **Entiende la participación.** Consulta la ficha de cada persona y sus resultados por período o actividad, con estados e historial que explican el porcentaje.
- **Coordina el voluntariado.** Revisa sugerencias por participación anterior y elige a quién asignar, respetando los cupos de cada encuentro.
- **Prepara documentos con tu identidad.** Diseña plantillas desde cero o sobre un PDF y genera listas para firmas o registros de asistencia multipágina.
- **Elige cómo colaborar.** Trabaja con espacios locales y vincula a Google Drive los que necesites compartir. La colaboración es opcional y conserva alternativas cuando hay conflictos.

## Un producto abierto, en desarrollo

Nexo se distribuye como **código abierto bajo licencia MIT**. La fuente actual es **0.4.0 (10)** y está en [`Next/Experience`](Next/Experience/README.md). La experiencia comparte interfaz entre Mac, iPhone y iPad, con funciones nativas de almacenamiento y documentos.

Esta entrega es de código fuente: siguen pendientes la revisión visual nativa de la compilación actual, Sequoia real y la preparación de una distribución firmada/notarizada. Los requisitos, pruebas ejecutadas y límites se detallan abajo. VRR fue el prototipo anterior; sus releases y su cask no instalan el Nexo actual y no se incluyen en esta copia.

## Qué puedes hacer

| Área | Funciones |
| --- | --- |
| Encuentros | Agenda, semana y mes; crear, editar, duplicar o cancelar actividades; decidir cuáles cuentan para asistencia. |
| Personas | Grupos, pertenencias históricas, ficha individual, lista y tabla; resultados por período, componente y categoría. |
| Asistencia | Formar listas por grupos o personas; pendiente, presente, ausente y excusada; notas, registros retirados/restaurados y Deshacer. En Mac también se puede marcar con el teclado. |
| Voluntariado | Orden sugerido por menor participación, selección manual, cupos y estados separados de interés, selección y realización. |
| Documentos | Diseñar desde una hoja en blanco o un PDF; editar columnas, textos e imágenes; conservar borradores y exportar PDF multipágina para firmas o asistencia registrada. |
| Espacios y datos | Crear y renombrar espacios, enviarlos a Papelera y recuperarlos; exportar copias JSON, validar importaciones y conservar revisiones anteriores. |
| Colaboración | Vincular un espacio a Drive, abrir uno compartido, pausar o reanudar cambios y resolver versiones en conflicto. |

La interfaz se organiza en **Encuentros**, **Personas** y **Documentos**, con búsqueda, períodos, inglés/español y aspecto claro, oscuro o del sistema. Comparte la experiencia web entre Mac, iPhone y iPad, con contenedores y funciones nativas por plataforma.

El porcentaje de cada persona es `presente / (presente + ausente)`. Las excusadas y pendientes quedan visibles, pero no entran en el denominador. Tampoco cuentan los encuentros cancelados, los que no cuentan para asistencia ni los registros retirados. Una persona que no está en la lista no adquiere una ausencia por existir el encuentro.

## Requisitos

- **Mac:** destino mínimo configurado macOS 15; para desarrollo, Xcode completo y un toolchain compatible con Swift 6.1 o posterior.
- **Web:** Node compatible con Vite 8 (`^20.19.0 || >=22.12.0`) y pnpm **11.19.0**, fijado en `packageManager`. Ejecuta pnpm desde `Next/Experience` para que el gestor lea esa versión.
- **iPhone/iPad:** destino mínimo configurado iOS/iPadOS 18. La preparación necesita Xcode; XcodeGen solo al generar o regenerar el proyecto. Consulta la [guía iOS](Next/Experience/iOS/README.md).

La verificación de esta tarea se hizo en un Mac Apple Silicon con macOS 27.0.1, Swift 6.4 y Node 24.21.0. Los destinos mínimos no prueban ejecución en Sequoia ni en todos los dispositivos compatibles.

## Probar la interfaz web

Desde la raíz del repositorio:

```sh
cd Next/Experience
pnpm install --frozen-lockfile
pnpm dev
```

Abre `http://127.0.0.1:5188`. La vista de desarrollo usa datos ficticios; no ejecuta el almacenamiento nativo, la generación nativa de PDF ni la conexión real de Drive. La aplicación empaquetada incluye la interfaz y no necesita este servidor.

## Compilar y ejecutar las pruebas

Pruebas y compilación web, desde `Next/Experience`:

```sh
pnpm test
pnpm build
```

Pruebas nativas, desde la raíz. Los directorios temporales evitan interferencias de atributos de File Provider en el checkout:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Next --scratch-path /tmp/nexo-core-tests -j 2

NEXO_LIVE_DRIVE_TEST=0 \
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --package-path Next/Experience/Native --scratch-path /tmp/nexo-native-tests -j 2
```

La suite local usa datos sintéticos y un transporte de Drive en memoria. La prueba de Drive real es optativa y requiere una autorización separada para la cuenta y las operaciones remotas; queda desactivada en el comando anterior.

Para compilar el ejecutable Mac universal sin instalar una app:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift build --package-path Next/Experience/Native \
  --scratch-path /tmp/nexo-mac-build -c release --arch arm64 --arch x86_64 -j 2
```

### Preparar el paquete Mac

```sh
zsh Next/Experience/build-experience.sh
```

Este script compila web y nativo, crea `Nexo.app` y la instala en `~/Applications/Nexo.app`. Hay que cerrar Nexo antes: conserva la app anterior y, si existe, copia el archivo principal de datos y comprueba que permanece idéntico. Usa firma ad-hoc salvo que se configure expresamente otra identidad; no notariza la app. También puede incluir una configuración OAuth local si existe: revisa entradas y resultado antes de distribuirlo. Consulta [preparación de versiones](RELEASING.md).

## Almacenamiento y recuperación

| Plataforma | Archivo principal |
| --- | --- |
| Mac | `~/Library/Application Support/Valentina-Experience/workspace-v1.json` |
| iPhone/iPad | `Library/Application Support/Nexo/workspace-v1.json`, dentro del contenedor de la app |
| Alfa VRR | `~/Library/Application Support/VRR/vrr-data.json`; es otro formato y otra implementación |

Se conservan los nombres internos `Valentina-Experience` y `VRRCore` para mantener continuidad. No renombres directorios de datos ni copies el JSON de VRR sobre el de Nexo: la migración de la alfa necesita una prueba específica desde una copia.

`SnapshotStore` comprueba revisión y relaciones, conserva las revisiones anterior y nueva antes de reemplazar el archivo principal y no abre un espacio vacío sobre datos dañados. Al guardar, compacta `Backups`: retiene las 60 copias más recientes y después una por hora durante dos días, una por día hasta 60 días y una por semana para las más antiguas. El historial causal de Drive todavía no se compacta.

Las copias exportadas incluyen espacios, relaciones, asistencia, voluntariado y plantillas guardadas con sus PDF e imágenes. Las nuevas copias añaden una suma SHA-256 para detectar alteraciones; no es cifrado. Los borradores de plantillas se conservan por separado. Importar una copia valida el contenido, conserva el archivo previo y deja Drive en pausa. Mantén además una copia independiente del Mac y de Drive.

## Colaboración por Google Drive

La conexión es opcional. Cada espacio se vincula de forma explícita; conectar Google no sube por sí solo todos los espacios locales. El propietario comparte la carpeta en Drive y decide sus permisos; Nexo no envía invitaciones automáticamente.

Las ediciones se guardan localmente con su cola pendiente. La sincronización envía cambios y conserva alternativas cuando detecta ediciones concurrentes. Una copia importada mantiene historial, conflictos y cambios pendientes, pero requiere reanudar Drive conscientemente.

En Mac, OAuth usa el navegador externo y PKCE; los tokens se guardan en el llavero y no se entregan a la interfaz. La integración actual solicita el alcance `drive`. La configuración de desarrollo documentada está en modo de prueba; antes de distribuir deben revisarse el acceso entre cuentas, la alternativa Picker/`drive.file` y los requisitos de verificación. [Detalles y límites](Next/Experience/README.md#colaborar-por-google-drive).

Drive no sustituye una copia independiente. El propietario puede borrar archivos remotos; un equipo nuevo podría necesitar una copia exportada o recuperar la carpeta. No se promete pérdida cero ni disponibilidad remota continua.

## Arquitectura

| Ruta | Responsabilidad |
| --- | --- |
| `Next/Experience/src` | React 19, TypeScript y Motion: interfaz, navegación y estado presentado. |
| `Next/Experience/Native/Sources/ValentinaExperience` | Ventana AppKit, WKWebView, puente y diálogos Mac. |
| `Next/Experience/Native/Sources/ExperienceKit` | Operaciones locales, copias, borradores y colaboración Drive. |
| `Next/Sources/VRRCore` | Modelos, reglas de asistencia/voluntariado, persistencia recuperable, PDF e historial causal. |
| `Next/Experience/iOS` | Contenedor UIKit, integración iOS y proyecto Xcode. |
| Implementaciones anteriores | Los prototipos VRR, MacApp y Service no se incluyen en esta copia. El cliente actual no necesita un servidor Python. |

## Estado de verificación

Sobre el código `615057e`, el 21 de octubre de 2026 pasaron **34 pruebas del núcleo, 31 nativas y 26 web**; la prueba optativa de Drive real quedó omitida. También se completó una compilación Mac universal con firma local en una copia QA aislada.

La revisión visual nativa quedó pendiente por fallos del transporte de control del Mac. La app instalada declara 0.4.0 (10), pero sus cinco recursos web coinciden con una compilación del padre de `615057e`; no incluye la última corrección para evitar contenido invisible cuando WebKit aplaza animaciones. El mismo número de versión no identifica una compilación exacta.

Siguen pendientes la prueba en Sequoia real, la revisión de esta compilación en WebKit y dispositivos físicos, la colaboración entre dos Macs con cuentas distintas, una migración validada desde VRR y la preparación de firma/distribución. La rama conserva registros históricos de otras pruebas; no equivalen a repetirlas sobre esta compilación.

## Documentación

- [Guía del cliente actual](Next/Experience/README.md) · [iPhone y iPad](Next/Experience/iOS/README.md)
- [Contribuir](CONTRIBUTING.md) · [Límites y reportes de seguridad](SECURITY.md)
- [Preparación de versiones](RELEASING.md) · [Alcance de esta copia](docs/PUBLICATION_REVIEW.md)
- [Integraciones opcionales y dependencias](docs/INTEGRATIONS.md)
- [Código bajo licencia MIT](LICENSE) · [Avisos de terceros](Next/Experience/public/ThirdPartyNotices.txt)

Esta copia procede del código Nexo `615057e`; la procedencia técnica se conserva en `SOURCE_ORIGIN.txt`. No incluye historial Git, datos de usuario, configuración OAuth privada ni paquetes de la alfa. La disponibilidad de código no equivale a una release instalable ni a notarización.
