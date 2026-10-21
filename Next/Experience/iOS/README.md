# Nexo para iPhone y iPad

Contenedor UIKit para la misma interfaz React de Nexo, con persistencia y PDF nativos. Destino mínimo configurado: iOS/iPadOS 18; fuente 0.4.0 (10). Esto no prueba ejecución en todos los dispositivos ni una entrega por TestFlight.

## Preparar y compilar

Desde la raíz, con Xcode, Node, pnpm y XcodeGen disponibles:

```sh
Next/Experience/iOS/prepare.sh
open Next/Experience/iOS/Nexo.xcodeproj
```

`prepare.sh` compila web con dependencias fijadas, copia recursos y genera el icono desde código. Ejecútalo antes de abrir el proyecto de esta copia, que no incluye el PNG generado ni recursos Web compilados. Regenera el proyecto con `--generate-project` solo cuando sea necesario; la actualización habitual conserva los ajustes locales de firma.

Esta copia no incluye equipo de firma personal ni IDs OAuth. Elige un simulador para desarrollo. Para un dispositivo físico, el propietario configura su equipo y los requisitos de Apple localmente; no se crean credenciales ni se distribuyen perfiles desde este repositorio.

## Usar sin configurar Drive

Espacios, personas, agenda, asistencia, voluntariado, plantillas, PDF y copias son funciones locales del cliente. GoogleSignIn permanece como dependencia porque el código de colaboración la usa, pero no hace falta configurar Google ni iniciar sesión para usar espacios locales. No hay un servidor de la aplicación que desplegar.

Para habilitar Drive, configura en tu copia local el cliente OAuth iOS y su URL de retorno conforme a los requisitos de GoogleSignIn. `GIDClientID` y `CFBundleURLTypes` específicos del proyecto de desarrollo se retiraron del `Info.plist` de publicación. No añadas tokens, contraseñas o sesiones al repositorio. La configuración y validación de colaboración entre cuentas son pasos separados de compilar el cliente local.

## Interacción y almacenamiento

Tres áreas: Encuentros, Personas y Documentos. En iPhone el encuentro se abre sobre la agenda y se vuelve deslizando hacia la derecha. En asistencia, un toque puede marcar presente; deslizar derecha marca presente e izquierda ausente. La ficha permite excusar, añadir nota y retirar/restaurar registros; cada cambio ofrece Deshacer. El voluntariado se selecciona manualmente.

En iPad vertical, agenda y encuentro aparecen juntos con pestañas abajo; desde 1100 puntos hay barra lateral. Los detalles se convierten en hojas cuando falta anchura. El editor conserva controles táctiles para columnas, textos, imágenes y PDF.

Los datos se guardan en `Library/Application Support/Nexo/workspace-v1.json` dentro del contenedor. Los borradores se conservan por separado y las copias JSON comparten el formato Nexo de Mac. Consulta [guardado y límites](../README.md#guardado-y-recuperación).

Las suites compartidas se ejecutaron en Mac durante esta tarea. No se recompiló, instaló ni verificó físicamente esta copia iOS; esos pasos siguen pendientes.
