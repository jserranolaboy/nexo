# Integraciones y dependencias

| Componente existente | Necesidad |
| --- | --- |
| Google Drive/OAuth | Opcional al usar la app. Sin configuración o inicio de sesión se usan los espacios y herramientas locales. No se incluye configuración del propietario. |
| GoogleSignIn-iOS | Dependencia de compilación del proyecto iOS actual; su función es la conexión opcional con Google. No se añadió ni se retiró el SDK. |
| React, React DOM, Motion y Lucide | Bibliotecas de interfaz incluidas por el constructor, no servicios remotos que haya que contratar o configurar. |
| Vite, TypeScript y Vitest | Herramientas de desarrollo y pruebas; la app empaquetada no necesita el servidor Vite abierto. |
| Swift/AppKit/UIKit/WebKit/PDFKit | Componentes nativos de las plataformas Apple para interfaz, almacenamiento y documentos. |
| Antiguo servicio Python y cliente genérico del núcleo | El servicio no se incluye ni despliega. El núcleo conserva código y pruebas históricos de sincronización, pero el cliente actual no instancia ese servicio para sus flujos locales o Drive. |

Para compilar sin configuración de cuentas, sigue los comandos web/nativos del [README](../README.md). No activan la prueba optativa de Drive real. Para empaquetar Mac sin copiar una configuración local, establece `NEXO_GOOGLE_CONFIG` a una ruta inexistente. El uso local no requiere claves API, Firebase, un backend propio ni servicios adicionales. La instalación de dependencias sí necesita los registros habituales o una caché disponible.

Los únicos destinos de red específicos de la aplicación encontrados en el código del cliente corresponden a OAuth/Drive de Google y al retorno OAuth local; el proyecto iOS resuelve su SDK desde GitHub. Esta observación de código no es una captura completa de tráfico de todos los SDKs. Conserva y revisa los [avisos de terceros](../Next/Experience/public/ThirdPartyNotices.txt).
