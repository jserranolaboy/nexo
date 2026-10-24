# Agentes en la reconstrucción

Este archivo manda dentro de `reconstruction/`. El `AGENTS.md` de la raíz remite aquí y no dice lo contrario.

- El núcleo de este directorio es la autoridad de las reglas nuevas.
- No edites `Core`, `Native`, `Web` ni `iOS` para repetir una regla de este núcleo.
- `apple/` es el adaptador. Reenvía el comando al núcleo y no copia las reglas. Solo escribe en un directorio temporal sintético. `NexoAdapterIOS` compila la misma orden para el simulador y no la ejecuta.
- La ventana de Mac y la pantalla de iPhone e iPad llaman a este núcleo. En iOS el paquete corre dentro de la app, en JavaScriptCore, y los archivos van a un directorio temporal del simulador. El puente de archivos no tiene reglas de dominio.
- No leas Application Support, espacios reales, cuentas ni OAuth. No leas ni implementes `vrr-data.json`. Un `workspace-v1.json` solo se lee si la ruta es explícita y sintética, y no se reescribe. Si la migración no comprueba, no sustituyas `nexo-reconstruction-v1.json` por un archivo vacío.
- Los instantes van en UTC canónico. No fijes `America/Puerto_Rico` ni otra zona como regla de producto.
- La zona del espacio es un dato. La pertenencia a un período compara instantes en un intervalo semiabierto.
- Una asistencia sin registros computables es nula, no `0 %`.
- Si un texto no cabe, se informa entero. No se recorta. El borrador, la cuadrícula y `export.pdf` viven en `document-drafts/` y no entran en las copias del espacio. Ese PDF no es el de CoreGraphics.
- La sugerencia de voluntariado no selecciona. El ámbito con categoría y los rechazos de cupo, encuentro cancelado, persona inactiva, otro espacio y período usan las funciones que ya existen. Un comando rechazado no se guarda. No dupliques esas reglas.
- Un guardado local ya hecho no se convierte en fallo porque después falle el puerto de sincronización. No uses OAuth, Drive real ni cuentas.
- Una restauración deja la sincronización en pausa y no encola una subida. Un conflicto conserva las alternativas. Elegir una las deja sola en el archivo activo y, en pausa, no encola una subida ni habla con Drive.
- Las pruebas usan datos sintéticos y directorios temporales.
- La CI de Ubuntu cubre este paquete. No afirmes que la app de Apple compiló si no se ejecutó en un Mac.
