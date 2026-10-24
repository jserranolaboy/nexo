# Reconstrucción de Nexo

Este directorio es el núcleo nuevo. No sustituye al cliente de Mac, iPhone e iPad que sigue en `Core`, `Native`, `Web` e `iOS`. No lee espacios reales, Application Support ni `vrr-data.json`. La migración solo acepta un `workspace-v1.json` sintético indicado en la ruta y no lo reescribe.

El archivo local se llama `nexo-reconstruction-v1.json`. Los instantes se guardan en UTC con milisegundos. Los períodos incluyen el inicio y excluyen el final. La zona del espacio se guarda como dato y no desplaza esos instantes. No hay una zona regional predeterminada.

La asistencia es `presentes / (presentes + ausentes)`. Si no hay registros computables, el resultado es nulo, no cero. Quien no está en la lista no recibe una ausencia. Duplicar un encuentro crea filas pendientes y no copia las marcas anteriores.

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

Las compilaciones de la app Apple no corren aquí. Siguen dependiendo de un Mac con Xcode, como describe el README de la raíz.

## Autoridad

Las reglas nuevas de esta línea viven solo en este paquete. `NexoCore` y `Web/src/domain.ts` siguen siendo el cliente legado hasta una migración explícita. No se implementan las dos a la vez para el mismo cambio.

La licencia MIT y la atribución a VRR Contributors están en `LICENSE`, en la raíz. Este paquete no añade dependencias de ejecución.
