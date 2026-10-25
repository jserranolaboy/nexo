import SwiftUI
import NexoInterfazUI

@main
struct NexoInterfazIOSApp: App {
    init() {
        InterfaceBridge.submit = EmbeddedKernel.submit
    }

    var body: some Scene {
        WindowGroup {
            InterfaceView()
        }
    }
}
