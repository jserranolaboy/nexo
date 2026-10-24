import Foundation
#if canImport(UIKit)
import UIKit
#endif
@MainActor
public enum DeviceIdentity {
    public static var name: String {
        #if os(macOS)
        Host.current().localizedName ?? "Mac"
        #else
        UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone"
        #endif
    }
}
