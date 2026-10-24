import AppKit
import SwiftUI
import NexoInterfazUI

@main
struct NexoInterfazApp: App {
    init() {
        InterfaceBridge.press = MacKernel.press
        NSApplication.shared.setActivationPolicy(.regular)
    }

    var body: some Scene {
        WindowGroup("Nexo") {
            InterfaceView()
                .frame(minWidth: 880, minHeight: 720)
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    NSApplication.shared.windows.first?.setFrame(NSRect(x: 40, y: 40, width: 980, height: 840), display: true)
                }
        }
        .defaultSize(width: 980, height: 840)
    }
}
