# Agentes en la reconstrucción

Este archivo manda dentro de `reconstruction/`. El `AGENTS.md` de la raíz remite aquí y no dice lo contrario.

- El núcleo de este directorio es la autoridad de las reglas nuevas.
- No edites `Core`, `Native`, `Web` ni `iOS` para repetir una regla de este núcleo.
- `apple/` es el adaptador. En Mac invoca este núcleo con Node y no copia las reglas. Solo escribe en un directorio temporal sintético. `NexoAdapterIOS` compila la misma orden para el simulador y no lo arranca.
- No leas ni escribas `workspace-v1.json`, `vrr-data.json`, espacios reales, cuentas ni OAuth.
- Los instantes van en UTC canónico. No fijes `America/Puerto_Rico` ni otra zona como regla de producto.
- La zona del espacio es un dato. La pertenencia a un período compara instantes en un intervalo semiabierto.
- Una asistencia sin registros computables es nula, no `0 %`.
- Si un texto no cabe, se informa entero. No se recorta.
- Un guardado local ya hecho no se convierte en fallo porque después falle Drive.
- Una restauración no añade subidas.
- Las pruebas usan datos sintéticos y directorios temporales.
- La CI de Ubuntu cubre este paquete. No afirmes que la app de Apple compiló si no se ejecutó en un Mac.
