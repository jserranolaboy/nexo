# Contribuir a Nexo

El cliente actual vive en `Next/Experience`. Consulta el [README](README.md) para arquitectura y reglas. Esta copia excluye el prototipo VRR y las notas privadas del proyecto.

## Cambios y pruebas

- Mantén cada cambio centrado en un resultado y conserva trabajo ajeno.
- La interfaz es React/TypeScript; las operaciones nativas están en `ExperienceKit` y las reglas compartidas en `VRRCore`. Mantén la validación en la capa que aplica el cambio.
- Conserva claves, formatos y directorios salvo una migración revisada con pruebas desde copias.
- Añade textos nuevos al sistema inglés/español. Comprueba los catálogos con `node Next/Experience/scripts/sync-locales.mjs --check`.
- Usa datos sintéticos y directorios temporales. Las pruebas de Drive real requieren autorización para la cuenta y las operaciones; no actives `NEXO_LIVE_DRIVE_TEST` en la suite habitual.
- Ejecuta las [pruebas web y nativas](README.md#compilar-y-ejecutar-las-pruebas) y las comprobaciones del área modificada. Distingue compilación, pruebas automatizadas, revisión visual y dispositivos físicos.

Sitúate en `Next/Experience` al ejecutar pnpm para usar la versión fijada en `packageManager`. No necesitas instalar la app para compilar o ejecutar las suites locales.

## Datos y publicación

No incluyas personas reales, asistencia, plantillas institucionales, credenciales, exportaciones o capturas de cuentas en código, issues o cambios compartidos. La sincronización remota, los permisos y nuevas llamadas de red necesitan una decisión explícita de producto.

Describe el problema, el resultado visible y las pruebas realmente ejecutadas. Las capturas deben usar datos ficticios y pasar revisión de contenido y metadatos. Consulta la [revisión de publicación](docs/PUBLICATION_REVIEW.md).

La suite Swift de la raíz y `scripts/build-app.sh` pertenecen a la alfa VRR: no compilan ni verifican el cliente Nexo actual. No publiques `main`, renombres el repositorio ni cambies su visibilidad como consecuencia de una tarea de documentación.
