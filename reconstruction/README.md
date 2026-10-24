# Reconstrucción de Nexo

Este directorio es el núcleo nuevo. No sustituye al cliente de Mac, iPhone e iPad que sigue en `Core`, `Native`, `Web` e `iOS`, y no abre `workspace-v1.json` ni `vrr-data.json`.

El archivo local se llama `nexo-reconstruction-v1.json`. Los instantes se guardan en UTC con milisegundos. Los períodos incluyen el inicio y excluyen el final. La zona del espacio se guarda como dato y no desplaza esos instantes. No hay una zona regional predeterminada.

La asistencia es `presentes / (presentes + ausentes)`. Si no hay registros computables, el resultado es nulo, no cero. Quien no está en la lista no recibe una ausencia. Duplicar un encuentro crea filas pendientes y no copia las marcas anteriores.

La colaboración es opcional y no tiene cuenta ni carpeta. Si el puerto de sincronización falla después de guardar, el archivo local permanece. Un conflicto conserva las alternativas y una escritura vieja no las reemplaza. Restaurar deja la sincronización en pausa y no encola una subida.

## Colaboración

Recorrido sintético, y lectura en otro proceso:

```sh
node --experimental-strip-types src/cli.ts collaborate --directory /tmp/nexo-colaboracion --lang es
node --experimental-strip-types src/cli.ts collaborate-show --directory /tmp/nexo-colaboracion --lang en
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
