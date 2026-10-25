import AppKit
import SwiftUI
import NexoInterfazUI

@main
struct NexoInterfazApp: App {
    init() {
        InterfaceBridge.submit = MacKernel.submit
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("Nexo") {
            InterfaceView()
                .frame(minWidth: 1080, minHeight: 760)
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    NSApplication.shared.windows.first?.setFrame(NSRect(x: 80, y: 60, width: 1280, height: 840), display: true)
                }
        }
        .defaultSize(width: 1280, height: 840)
    }
}
