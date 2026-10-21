# Límites y reportes de seguridad

Nexo está en desarrollo. Esta documentación no declara una auditoría completa, una versión pública con mantenimiento garantizado ni autorización para publicar el repositorio.

## Reportar un problema

Usa el reporte privado de vulnerabilidades de GitHub si está habilitado. Si no existe un canal privado, solicita uno con una descripción general, sin adjuntar datos personales, credenciales, listas de asistencia, plantillas institucionales ni detalles que permitan explotar el problema.

## Límites del cliente actual

- Los datos se guardan localmente; las copias exportadas contienen datos y plantillas y deben tratarse como archivos privados. Su suma SHA-256 detecta cambios, pero no cifra el contenido ni demuestra quién lo creó.
- Las importaciones validan esquema y relaciones. La restauración conserva el archivo previo y pausa los espacios vinculados a Drive; las revisiones y copias locales no sustituyen una copia independiente.
- Drive es opcional y supone comunicaciones con Google cuando se configura y utiliza. La implementación solicita el alcance `drive`; deben revisarse alcance, permisos entre cuentas y requisitos de verificación antes de distribuirla.
- En Mac, los tokens OAuth se guardan en el llavero y no se devuelven al puente JavaScript. No deben copiarse al repositorio, a informes o a artefactos.
- La firma ad-hoc de desarrollo no es una identidad Developer ID ni una notarización. No desactives Gatekeeper para distribuir o probar la app.

La alfa `Sources/VRR` no tiene la integración Drive del cliente actual. Sus antiguas afirmaciones de funcionamiento sin red no describen Nexo.

Antes de cualquier publicación, revisa [archivos, historial y artefactos](docs/PUBLICATION_REVIEW.md). Cambiar el último archivo o añadir una regla a `.gitignore` no elimina información ya versionada.
