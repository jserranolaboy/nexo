import SwiftUI
import NexoInterfazUI

@main
struct NexoInterfazIOSApp: App {
    init() {
        InterfaceBridge.press = EmbeddedKernel.press
    }

    var body: some Scene {
        WindowGroup {
            InterfaceView()
        }
    }
}
