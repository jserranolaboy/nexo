# Preparar una versión de Nexo

Nexo actual está en `Next/Experience`. Los ZIP/DMG y el cask de VRR son históricos; no se deben renombrar ni reutilizar como una release de Nexo. Este documento no autoriza publicación, firma de distribución ni cambios de visibilidad.

## Comprobación local

1. Usa una copia o rama aislada y datos sintéticos. Ejecuta las [pruebas web y nativas](README.md#compilar-y-ejecutar-las-pruebas).
2. Mantén coherentes las versiones de `Next/Experience/package.json`, `Native/Info.plist`, `iOS/Info.plist` y `iOS/project.yml`. La 0.4.0 (10) tiene compilaciones distintas: registra también el commit y las sumas de los archivos entregados.
3. Revisa las entradas de `Next/Experience/build-experience.sh`. Por defecto instala en `~/Applications/Nexo.app`, conserva la app anterior, copia el archivo principal existente y verifica que no cambió. Hay que cerrar Nexo primero.
4. El script acepta `VALENTINA_BUILD_DIR` y `VALENTINA_APP_DIR` para cambiar las salidas. Cambiar solo la ruta de la app no aísla su almacenamiento. Las pruebas de ejecución necesitan un entorno QA separado; no abras dos copias contra los mismos datos.
5. Revisa `NEXO_GOOGLE_CONFIG`: el constructor puede incorporar `GoogleOAuth.json` desde el Mac. Las credenciales de usuario no forman parte de una entrega. No leas, exportes ni incluyas tokens para preparar el paquete.
6. Inspecciona versión, recursos web, icono, arquitecturas y firma de la app final. El script usa firma ad-hoc por defecto o la identidad de `NEXO_SIGN_IDENTITY`; no implementa notarización ni crea ZIP/DMG de Nexo.

## Antes de distribuir

- Completa la [revisión de publicación](docs/PUBLICATION_REVIEW.md) y la autorización específica del propietario.
- Prueba en Sequoia real, WebKit real y los dispositivos que vayas a anunciar. Una compilación universal o un destino mínimo no sustituyen esas pruebas.
- Verifica actualización, copias, restauración y plantillas con datos sintéticos, además de una migración desde una copia de VRR si se ofrece esa compatibilidad.
- Revisa Drive con cuentas y permisos autorizados, incluidas desconexión y ediciones concurrentes. Mantén copias independientes.
- Prepara por separado Developer ID/notarización para Mac o los requisitos de distribución iOS. No declares una entrega firmada o notarizada sin verificar los artefactos finales.
- Asigna una nueva versión/build y documenta lo comprobado y lo pendiente. Conserva checksums y procedencia del paquete realmente entregado.

## Alfa VRR

`AppBundle/Info.plist`, `scripts/build-app.sh`, `Casks/vrr.rb` y las releases `v0.2.0-beta.*` pertenecen a VRR. Sus variables `VRR_SIGNING_IDENTITY` y `VRR_NOTARY_PROFILE` no son las del constructor Nexo. Sus etiquetas, nombres y sumas históricas se conservan.
