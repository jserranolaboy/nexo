# Núcleo y clientes de Nexo

El cliente actual es [Nexo en `Experience`](Experience/README.md): React/Motion en WKWebView, AppKit en Mac y UIKit en iPhone/iPad. Consulta el [README principal](../README.md) para requisitos, compilación, pruebas y estado de verificación.

## Código actual

- `Sources/VRRCore`: modelos, reglas, persistencia local recuperable, PDF e historial causal de Drive.
- `Tests/VRRCoreTests`: pruebas del núcleo con datos sintéticos.
- `Experience/src`: interfaz y coordinación con el puente nativo.
- `Experience/Native`: cliente Mac y `ExperienceKit`, compartido con iOS.
- `Experience/iOS`: contenedor UIKit y proyecto Xcode.

Cada asociación contiene personas, grupos, períodos, componentes, categorías, encuentros, asistencia, voluntariado y plantillas. Los porcentajes son individuales: `presente / (presente + ausente)`. Las personas fuera de una lista no adquieren ausencias; excusadas, pendientes, registros retirados y encuentros cancelados o que no cuentan quedan fuera del denominador.

El voluntariado sugiere un orden por menor participación realizada, con selección manual y cupos. Mostrar interés o ser seleccionado no da crédito de participación. Las plantillas afectan al documento, no al resultado de asistencia.

`SnapshotStore` conserva revisiones y copias antes de reemplazar el archivo principal y compacta las copias locales más antiguas. La colaboración actual usa Google Drive; no necesita el servicio Python conservado aquí. Drive y la persistencia local no sustituyen una copia independiente.

## Procedencia

Los prototipos SwiftUI MacApp, Service y VRR no forman parte de esta copia. El núcleo conserva sus nombres internos para mantener formatos y continuidad de datos. La migración desde la alfa VRR sigue pendiente de validación con copias.
