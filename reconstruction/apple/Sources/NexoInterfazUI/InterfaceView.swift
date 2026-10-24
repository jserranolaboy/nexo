import SwiftUI

public enum InterfaceBridge {
    nonisolated(unsafe) public static var press: (URL, String, String) -> String = { _, _, _ in
        "Error: missing-kernel"
    }
}

@MainActor
final class InterfaceModel: ObservableObject {
    @Published var english = false
    @Published var output = ""
    @Published var trace: [String] = []
    let directory: URL

    init() {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("nexo-ventana-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        directory = folder
    }

    func press(id: String, title: String) {
        trace.append(title)
        output = InterfaceBridge.press(directory, id, english ? "en" : "es")
    }

    var hint: String {
        english ? "Press. The kernel saves in a temporary directory." : "Pulsa. El núcleo guarda en un directorio temporal."
    }

    var traceTitle: String {
        english ? "Pressed: " : "Pulsado: "
    }

    var placeholder: String {
        english ? "The result shows up here." : "El resultado aparece aquí."
    }
}

struct InterfaceAction: Identifiable {
    var id: String
    var es: String
    var en: String
}

public struct InterfaceView: View {
    public init() {}
    @StateObject private var model = InterfaceModel()
    private let actions = [
        InterfaceAction(id: "attendance", es: "Crear espacio", en: "Create space"),
        InterfaceAction(id: "attendance-read", es: "Ver asistencia", en: "See attendance"),
        InterfaceAction(id: "document", es: "Guardar borrador", en: "Save draft"),
        InterfaceAction(id: "volunteers", es: "Ver voluntariado", en: "See volunteering"),
        InterfaceAction(id: "collaboration", es: "Guardar colaboración", en: "Save collaboration"),
        InterfaceAction(id: "collaboration-choose", es: "Elegir alternativa", en: "Choose alternative"),
        InterfaceAction(id: "migration", es: "Migrar", en: "Migrate"),
        InterfaceAction(id: "migration-revert", es: "Revertir", en: "Revert"),
    ]

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Nexo")
                    .font(.largeTitle.bold())
                Text(model.hint)
                    .font(.body)
                    .foregroundStyle(.secondary)
                Picker(model.english ? "Language" : "Idioma", selection: $model.english) {
                    Text("Español").tag(false)
                    Text("English").tag(true)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("nexo.language")
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(actions) { action in
                        let title = model.english ? action.en : action.es
                        Button { model.press(id: action.id, title: title) } label: {
                            Text(title)
                                .frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier(action.id)
                    }
                }
                if !model.trace.isEmpty {
                    Text(model.traceTitle + model.trace.joined(separator: " · "))
                        .font(.callout)
                        .accessibilityIdentifier("nexo.trace")
                }
                Text(model.output.isEmpty ? model.placeholder : model.output)
                    .font(.system(size: 15, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("nexo.result")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .preferredColorScheme(.light)
    }
}
