import SwiftUI

public enum InterfaceBridge {
    nonisolated(unsafe) public static var submit: (URL, String) -> String = { _, _ in
        "Error: missing-kernel"
    }
}

struct FormPerson: Decodable, Identifiable {
    var id: String
    var name: String
    var listed: Bool
    var line: String
    var volunteer: String
}

struct FormScreen: Decodable {
    var people: [FormPerson] = []
    var encounterTitle = ""
    var suggestion = ""
    var draft = ""
    var warning = ""
    var error = ""
}

@MainActor
final class InterfaceModel: ObservableObject {
    @Published var english = false
    @Published var screen = FormScreen()
    let directory: URL

    init() {
        directory = FormDirectory.current()
    }

    func reload() {
        send(["op": "open"])
    }

    func send(_ fields: [String: Any]) {
        var body = fields
        body["lang"] = english ? "en" : "es"
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let payload = String(data: data, encoding: .utf8) else { return }
        let raw = InterfaceBridge.submit(directory, payload)
        guard let json = raw.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(FormScreen.self, from: json) else {
            screen.error = raw
            return
        }
        screen = decoded
    }
}

enum FormDirectory {
    static func current() -> URL {
        let marker = FileManager.default.temporaryDirectory.appendingPathComponent("nexo-formulario.txt")
        if let saved = try? String(contentsOf: marker, encoding: .utf8) {
            let path = saved.trimmingCharacters(in: .whitespacesAndNewlines)
            if !path.isEmpty, FileManager.default.fileExists(atPath: path) {
                return URL(fileURLWithPath: path, isDirectory: true)
            }
        }
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("nexo-formulario-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? folder.path.write(to: marker, atomically: true, encoding: .utf8)
        return folder
    }
}

public struct InterfaceView: View {
    public init() {}
    @StateObject private var model = InterfaceModel()
    @State private var personName = ""
    @State private var encounterTitle = ""
    @State private var roster: Set<String> = []
    @State private var draft = ""

    public var body: some View {
        let en = model.english
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Nexo").font(.largeTitle.bold())
                Text(en ? "Type a name and a title. The kernel saves this temporary directory." : "Escribe un nombre y un título. El núcleo guarda este directorio temporal.")
                    .foregroundStyle(.secondary)
                Picker(en ? "Language" : "Idioma", selection: $model.english) {
                    Text("Español").tag(false)
                    Text("English").tag(true)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("nexo.language")
                .onChange(of: model.english) { _, _ in model.reload() }

                TextField(en ? "Person name" : "Nombre de la persona", text: $personName)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("nexo.person-name")
                    .onSubmit { addPerson() }
                Button(en ? "Add person" : "Dar de alta") { addPerson() }
                .accessibilityIdentifier("nexo.add-person")

                if model.screen.encounterTitle.isEmpty {
                    TextField(en ? "Encounter title" : "Título del encuentro", text: $encounterTitle)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("nexo.encounter-title")
                        .onSubmit { createEncounter() }
                    ForEach(model.screen.people) { person in
                        Button(roster.contains(person.id) ? "\(en ? "On the list" : "En la lista") \(person.name)" : "\(en ? "Off the list" : "Fuera") \(person.name)") {
                            if roster.contains(person.id) { roster.remove(person.id) } else { roster.insert(person.id) }
                        }
                        .accessibilityIdentifier("nexo.roster.\(person.id)")
                    }
                    Button(en ? "Create encounter" : "Crear encuentro") { createEncounter() }
                    .accessibilityIdentifier("nexo.add-encounter")
                } else {
                    Text(model.screen.encounterTitle)
                        .accessibilityIdentifier("nexo.encounter-title-label")
                }

                ForEach(model.screen.people) { person in
                    if person.listed {
                        Button(person.line) { model.send(["op": "cycle", "personId": person.id]) }
                            .accessibilityIdentifier("nexo.person.\(person.id)")
                    } else if !model.screen.encounterTitle.isEmpty {
                        Text(person.line)
                            .accessibilityIdentifier("nexo.offlist.\(person.id)")
                    }
                }

                if !model.screen.encounterTitle.isEmpty {
                    Text(model.screen.suggestion)
                        .accessibilityIdentifier("nexo.suggestion")
                    ForEach(model.screen.people.filter(\.listed)) { person in
                        HStack {
                            Button(en ? "Interested \(person.name)" : "Me interesa \(person.name)") {
                                model.send(["op": "interest", "personId": person.id])
                            }
                            .accessibilityIdentifier("nexo.interest.\(person.id)")
                            Button(en ? "Choose \(person.name)" : "Elegir \(person.name)") {
                                model.send(["op": "choose", "personId": person.id])
                            }
                            .accessibilityIdentifier("nexo.choose.\(person.id)")
                            if !person.volunteer.isEmpty {
                                Text(person.volunteer)
                            }
                        }
                    }
                }

                TextField(en ? "Draft" : "Borrador", text: $draft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("nexo.draft-text")
                Button(en ? "Save draft" : "Guardar borrador") {
                    model.send(["op": "draft", "text": draft])
                }
                .accessibilityIdentifier("nexo.save-draft")
                if !model.screen.draft.isEmpty {
                    Text(model.screen.draft).accessibilityIdentifier("nexo.draft-saved")
                }
                if !model.screen.warning.isEmpty {
                    Text(model.screen.warning).accessibilityIdentifier("nexo.draft-warning")
                }
                if !model.screen.error.isEmpty {
                    Text(model.screen.error).accessibilityIdentifier("nexo.error")
                }
            }
            .buttonStyle(.bordered)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .preferredColorScheme(.light)
        .onAppear { model.reload() }
    }

    private func addPerson() {
        let name = personName
        personName = ""
        model.send(["op": "add-person", "name": name])
    }

    private func createEncounter() {
        model.send([
            "op": "create-encounter",
            "title": encounterTitle,
            "roster": model.screen.people.filter { roster.contains($0.id) }.map(\.id),
        ])
    }
}
