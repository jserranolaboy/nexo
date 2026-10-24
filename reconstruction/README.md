# Reconstrucción de Nexo

Este directorio es el núcleo nuevo. No sustituye al cliente de Mac, iPhone e iPad que sigue en `Core`, `Native`, `Web` e `iOS`. No lee espacios reales, Application Support ni `vrr-data.json`. La migración solo acepta un `workspace-v1.json` sintético indicado en la ruta y no lo reescribe.

El archivo local se llama `nexo-reconstruction-v1.json`. Los instantes se guardan en UTC con milisegundos. Los períodos incluyen el inicio y excluyen el final. La zona del espacio se guarda como dato y no desplaza esos instantes. No hay una zona regional predeterminada.

La asistencia es `presentes / (presentes + ausentes)`. Si no hay registros computables, el resultado es nulo, no cero. Quien no está en la lista no recibe una ausencia. Duplicar un encuentro crea filas pendientes y no copia las marcas anteriores.

La sugerencia de voluntariado ordena a quien ya está interesado, según participaciones completadas previas del mismo ámbito. Si el encuentro tiene categoría, el ámbito es esa categoría. La elección es un comando aparte. El cupo se rechaza al elegir, al importar y al combinar. Un encuentro cancelado, sin cupo, una persona inactiva, otro espacio o un encuentro fuera del período también se rechazan, y ese rechazo no cambia el archivo.

La colaboración es opcional y no tiene cuenta ni carpeta. Si el puerto de sincronización falla después de guardar, el archivo local permanece. Un conflicto conserva las alternativas y una escritura vieja no las reemplaza. Restaurar deja la sincronización en pausa y no encola una subida. Elegir una alternativa deja solo esa en el archivo activo; en pausa, la elección no encola una subida.

## Documentos

El borrador documental se guarda en `document-drafts/document.json`. La cuadrícula de páginas queda en `document-drafts/export.json` y, a partir de ella, el archivo que se entrega es `document-drafts/export.pdf`. Ninguno entra en `nexo-reconstruction-v1.json` ni en `revision-copies`.

Ese PDF es un archivo PDF 1.4 con una página por cada página del diseño. Conserva el título, el encabezado, el pie, el contenido y las notas. Si algo no cabe en la página, o un carácter no entra en la codificación WinAnsi de esta fuente, el aviso trae el texto completo y no se reemplazan el PDF anterior ni el borrador. No es el PDF de CoreGraphics ni una hoja de firma de la app de Apple.

## Voluntariado

```sh
node --experimental-strip-types src/cli.ts volunteers --directory /tmp/nexo-voluntarios --lang es
node --experimental-strip-types src/cli.ts volunteers-show --directory /tmp/nexo-voluntarios --lang en
```

## Colaboración

```sh
node --experimental-strip-types src/cli.ts collaborate --directory /tmp/nexo-colaboracion --lang es
node --experimental-strip-types src/cli.ts collaborate-show --directory /tmp/nexo-colaboracion --lang en
node --experimental-strip-types src/cli.ts collaborate-choose --directory /tmp/nexo-colaboracion --version cccccccc-cccc-4ccc-8ccc-ccccccccccc1 --lang es
```

## Migración

Copia sintética mínima. Conserva los bytes de origen, comprueba personas, encuentros y asistencias, y escribe `nexo-reconstruction-v1.json`. Si la comprobación falla, no deja un archivo nuevo vacío. `migrate-revert` vuelve a la copia nueva anterior.

```sh
node --experimental-strip-types src/cli.ts migrate --directory /tmp/nexo-migracion --source /tmp/nexo-migracion/origen/workspace-v1.json --lang es
node --experimental-strip-types src/cli.ts migrate-revert --directory /tmp/nexo-migracion --lang es
```

## Comandos

Hace falta Node `22.23.4`. Desde este directorio:

```sh
npm ci
npm test
npm run typecheck
```

Recorrido sintético, y lectura en otro proceso:

```sh
node --experimental-strip-types src/cli.ts journey --directory /tmp/nexo-synthetic --lang es
node --experimental-strip-types src/cli.ts show --directory /tmp/nexo-synthetic --lang en
```

`npm test` también ejecuta ese recorrido. Los datos son ficticios. No usa Drive, cuentas ni documentos reales.

El cliente legado sigue dependiendo de un Mac con Xcode, como describe el README de la raíz. Este paquete no lo sustituye.

## Interfaz

Un proceso guarda asistencia, borrador, PDF, voluntariado, colaboración y migración. Otro proceso los lee. El aviso de lo que no cabe trae el texto completo.

```sh
node --experimental-strip-types src/cli.ts interface --directory /tmp/nexo-interfaz --lang es
node --experimental-strip-types src/cli.ts interface-show --directory /tmp/nexo-interfaz --lang en
```

## Adaptador de Mac

`apple/` no tiene reglas de dominio. El ejecutable `nexo-adapter` reenvía el comando, `--source` y `--version` a `src/cli.ts`. Un proceso ejecuta `interface` y otro `interface-show`. El directorio es temporal y los datos son los sintéticos del núcleo. No abre Application Support, no firma con Developer ID y no publica.

`xcode-select` puede seguir en Command Line Tools. La compilación usa Xcode por `DEVELOPER_DIR`:

```sh
make test-adapter
```

Eso equivale a `xcodebuild -scheme nexo-adapter-Package -destination 'platform=macOS'` dentro de `apple/`, con datos derivados en `/tmp/nexo-adapter-dd`.

`NexoAdapterIOS` es la misma orden para iPhone e iPad. Compila contra el SDK del simulador y no lanza Node. Si el runtime no está instalado, el esquema solo se compila:

```sh
make build-adapter-ios
```

## Autoridad

Las reglas nuevas de esta línea viven solo en este paquete. `NexoCore` y `Web/src/domain.ts` siguen siendo el cliente legado hasta una migración explícita. No se implementan las dos a la vez para el mismo cambio.

La licencia MIT y la atribución a VRR Contributors están en `LICENSE`, en la raíz. Este paquete no añade dependencias de ejecución.
