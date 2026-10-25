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

struct FormAlternative: Decodable, Identifiable {
    var id: String
    var value: String
}

struct FormScreen: Decodable {
    var people: [FormPerson] = []
    var encounterTitle = ""
    var suggestion = ""
    var draft = ""
    var warning = ""
    var error = ""
    var refusal = ""
    var collaboration = ""
    var alternatives: [FormAlternative] = []
    var spaceName = ""
    var periodName = ""
    var timeZone = "Etc/UTC"
    var startsAt = ""
    var componentName = ""
    var registered = 0
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

private enum NexoSection: String, CaseIterable {
    case encounters, people, attendance, templates, organize
}

public struct InterfaceView: View {
    public init() {}
    @StateObject private var model = InterfaceModel()
    @State private var personName = ""
    @State private var encounterTitle = ""
    @State private var roster: Set<String> = []
    @State private var draft = ""
    @State private var query = ""
    @State private var creating = false
    @State private var section = NexoSection.encounters
    @Environment(\.horizontalSizeClass) private var sizeClass

    private let canvas = Color(red: 0.965, green: 0.965, blue: 0.972)
    private let cardInk = Color(red: 0.149, green: 0.149, blue: 0.161)

    public var body: some View {
        let en = model.english
        let wide = sizeClass != .compact
        ZStack(alignment: .bottom) {
            canvas.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar(en)
                ScrollView {
                    page(en, wide: wide)
                        .padding(.horizontal, wide ? 36 : 20)
                        .padding(.top, 28)
                        .padding(.bottom, 120)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            bottomBar(en, wide: wide)
        }
        .preferredColorScheme(.light)
        .onAppear { model.reload() }
        .onChange(of: model.english) { _, _ in model.reload() }
    }

    private func topBar(_ en: Bool) -> some View {
        ViewThatFits(in: .horizontal) {
            topBarRow(en)
            compactBar(en)
        }
    }

    private func compactBar(_ en: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("N").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 24, height: 24).background(Color.black, in: RoundedRectangle(cornerRadius: 6))
                Text("Nexo").font(.system(size: 17, weight: .semibold)).lineLimit(1)
                Text(model.screen.spaceName).font(.system(size: 14)).lineLimit(1).accessibilityIdentifier("nexo.space")
                Spacer(minLength: 8)
                Button(en ? "Español" : "English") { model.english.toggle() }
                    .buttonStyle(.plain).font(.system(size: 13)).lineLimit(1)
                    .accessibilityIdentifier("nexo.language")
            }
            HStack(spacing: 8) {
                Text(model.screen.periodName).font(.system(size: 13)).lineLimit(1).accessibilityIdentifier("nexo.period")
                Spacer(minLength: 8)
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("", text: $query).textFieldStyle(.plain).frame(width: 72).accessibilityIdentifier("nexo.search")
                Button { section = .organize } label: {
                    Text(en ? "Review Drive" : "Revisar Drive").font(.system(size: 13)).lineLimit(1)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("nexo.review-drive")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func topBarRow(_ en: Bool) -> some View {
        HStack(spacing: 14) {
            HStack(spacing: 8) {
                Text("N")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 26, height: 26)
                    .background(Color.black, in: RoundedRectangle(cornerRadius: 7))
                    .foregroundStyle(.white)
                Text("Nexo").font(.system(size: 17, weight: .semibold))
            }
            Text(model.screen.spaceName)
                .font(.system(size: 15))
                .lineLimit(1)
                .accessibilityIdentifier("nexo.space")
            Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(model.screen.periodName)
                .font(.system(size: 14))
                .lineLimit(1)
                .accessibilityIdentifier("nexo.period")
            Image(systemName: "chevron.down").font(.system(size: 11)).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("", text: $query)
                    .textFieldStyle(.plain)
                    .frame(width: 88)
                    .accessibilityIdentifier("nexo.search")
                Text("⌘K").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.primary.opacity(0.05), in: Capsule())
            Button(en ? "Español" : "English") { model.english.toggle() }
                .buttonStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("nexo.language")
            Button { section = .organize } label: {
                HStack(spacing: 6) {
                    Circle().fill(Color.primary.opacity(0.55)).frame(width: 6, height: 6)
                    Text(en ? "Review Drive" : "Revisar Drive").font(.system(size: 14))
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("nexo.review-drive")
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private func page(_ en: Bool, wide: Bool) -> some View {
        switch section {
        case .encounters: encounters(en, wide: wide)
        case .people: people(en)
        case .attendance: attendance(en)
        case .templates: templates(en)
        case .organize: organize(en)
        }
        if !model.screen.error.isEmpty {
            Text(model.screen.error).accessibilityIdentifier("nexo.error").padding(.top, 8)
        }
    }

    private func encounters(_ en: Bool, wide: Bool) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            ViewThatFits(in: .horizontal) {
                encounterHeading(en, wide: wide, stacked: false)
                encounterHeading(en, wide: wide, stacked: true)
            }
            if creating || model.screen.encounterTitle.isEmpty {
                createCard(en)
            }
            if wide {
                HStack(alignment: .top, spacing: 36) {
                    calendarColumn(en).frame(maxWidth: .infinity, alignment: .leading)
                    encounterCard(en, wide: wide).frame(maxWidth: .infinity)
                }
            } else {
                calendarColumn(en)
                encounterCard(en, wide: wide)
            }
        }
    }

    private func encounterHeading(_ en: Bool, wide: Bool, stacked: Bool) -> some View {
        let heading = Text(en ? "Encounters" : "Encuentros")
            .font(.system(size: wide ? 40 : 34, weight: .bold))
            .lineLimit(1)
        let create = Button(action: createEncounter) {
                    Text(en ? "+ Create encounter" : "+ Crear encuentro")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.black, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("nexo.add-encounter")
        return Group {
            if stacked {
                VStack(alignment: .leading, spacing: 12) { heading; create }
            } else {
                HStack(alignment: .center) { heading; Spacer(minLength: 12); create }
            }
        }
    }

    private func createCard(_ en: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
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
        }
        .buttonStyle(.bordered)
    }

    private func calendarColumn(_ en: Bool) -> some View {
        let days = week(model.screen.startsAt)
        return VStack(alignment: .leading, spacing: 16) {
            Text(monthTitle(model.screen.startsAt, en: en))
                .font(.system(size: 17))
                .lineLimit(1)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                ForEach(days) { day in
                    VStack(spacing: 8) {
                        Text(day.weekday).font(.system(size: 10)).foregroundStyle(day.selected ? .white : .secondary)
                        Text(day.number).font(.system(size: 21, weight: .regular)).foregroundStyle(day.selected ? .white : .primary)
                        Circle().fill(day.selected ? Color.white : Color.clear).frame(width: 4, height: 4)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(day.selected ? cardInk : Color.clear, in: RoundedRectangle(cornerRadius: 30))
                }
            }
            Text(en ? "On the calendar" : "En el calendario")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .padding(.top, 8)
            if !model.screen.encounterTitle.isEmpty, matches(model.screen.encounterTitle) {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(dayNumber(model.screen.startsAt)).font(.system(size: 22, weight: .semibold))
                        Text(monthAbbrev(model.screen.startsAt, en: en)).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.screen.encounterTitle).font(.system(size: 16, weight: .semibold))
                        Text("\(model.screen.componentName) · \(clock(model.screen.startsAt, en: en))")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(.vertical, 8)
                .overlay(alignment: .top) { Divider() }
            }
        }
    }

    private func encounterCard(_ en: Bool, wide: Bool) -> some View {
        let title = model.screen.encounterTitle
        let listed = model.screen.people.filter(\.listed)
        return VStack(alignment: .leading, spacing: 14) {
            ZStack(alignment: .topLeading) {
                EncounterWaves()
                    .stroke(Color(white: 0.67), lineWidth: 1)
                    .opacity(0.45)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .offset(x: 36)
                    .allowsHitTesting(false)
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        if !model.screen.componentName.isEmpty, !title.isEmpty {
                            Text(model.screen.componentName)
                                .font(.system(size: 10, weight: .medium))
                                .tracking(1)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.white.opacity(0.12), in: Capsule())
                        }
                        Spacer()
                        if !title.isEmpty {
                            Text(badge(model.screen.startsAt, en: en))
                                .font(.system(size: 10, weight: .semibold))
                                .tracking(1)
                        }
                    }
                    Spacer(minLength: wide ? 80 : 28)
                    if !title.isEmpty {
                        Text(clock(model.screen.startsAt, en: en))
                            .font(.system(size: 11))
                            .foregroundStyle(Color(white: 0.78))
                            .padding(.bottom, 8)
                    }
                    Text(title.isEmpty ? (en ? "No encounter" : "Sin encuentro") : title)
                        .font(.system(size: wide ? 44 : 32, weight: .semibold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .accessibilityIdentifier("nexo.encounter-title-label")
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: -8) {
                                ForEach(Array(listed.prefix(4).enumerated()), id: \.element.id) { index, person in
                                    Text(String(person.name.prefix(1)).uppercased())
                                        .font(.system(size: 12, weight: .medium))
                                        .frame(width: 35, height: 35)
                                        .background(avatarFill(index), in: Circle())
                                        .overlay(Circle().stroke(cardInk, lineWidth: 2))
                                }
                            }
                            Text(title.isEmpty ? (en ? "List to prepare" : "Lista por preparar") : registeredLine(en))
                                .font(.system(size: 10))
                                .foregroundStyle(Color(white: 0.79))
                        }
                        Spacer()
                        Button { section = .attendance } label: {
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 44, height: 44)
                                .background(Color.white.opacity(0.08), in: Circle())
                                .overlay(Circle().stroke(Color.white.opacity(0.25), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("nexo.open-attendance")
                    }
                    .padding(.top, 24)
                }
                .padding(wide ? 30 : 20)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: wide ? 360 : 240, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [Color(red: 0.204, green: 0.204, blue: 0.220), Color(red: 0.125, green: 0.125, blue: 0.137)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 20))
            HStack(spacing: 10) {
                Text("✳").font(.system(size: 22)).foregroundStyle(Color(white: 0.68))
                Text(peopleLine(en)).font(.system(size: 12, weight: .medium))
                Spacer()
                Button(en ? "Add" : "Añadir") { section = .people }
                    .buttonStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("nexo.show-people")
            }
        }
    }

    private func people(_ en: Bool) -> some View {
        let shown = model.screen.people.filter { matches($0.name) }
        return VStack(alignment: .leading, spacing: 28) {
            HStack(alignment: .bottom) {
                Text(en ? "People" : "Personas")
                    .font(.system(size: 40, weight: .semibold))
                    .tracking(-1.2)
                Spacer()
                Button(en ? "Add" : "Añadir", action: addPerson)
                    .buttonStyle(.plain)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(cardInk, in: RoundedRectangle(cornerRadius: 9))
                    .accessibilityIdentifier("nexo.add-person")
            }
            TextField(en ? "Person name" : "Nombre de la persona", text: $personName)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("nexo.person-name")
                .onSubmit { addPerson() }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 17)], spacing: 17) {
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, person in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(String(person.name.prefix(1)).uppercased())
                            .font(.system(size: 22, weight: .medium))
                            .frame(width: 64, height: 64)
                            .background(avatarFill(index), in: Circle())
                        Text(person.name).font(.system(size: 16, weight: .medium))
                        Text(person.line)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    .padding(22)
                    .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                    .background(Color(white: 0.98), in: RoundedRectangle(cornerRadius: 15))
                    .overlay(RoundedRectangle(cornerRadius: 15).stroke(Color(white: 0.87), lineWidth: 1))
                }
            }
        }
    }

    private func attendance(_ en: Bool) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            Text(en ? "Attendance" : "Asistencia")
                .font(.system(size: 40, weight: .semibold))
                .tracking(-1.2)
            Text(en ? "Whole space" : "Todo el espacio")
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(white: 0.9), in: Capsule())
            HStack {
                Text(en ? "Person" : "Persona").frame(maxWidth: .infinity, alignment: .leading)
                Text(en ? "Attendance" : "Asistencia").frame(width: 220, alignment: .leading)
                if !model.screen.encounterTitle.isEmpty {
                    Text(badge(model.screen.startsAt, en: en)).frame(width: 72, alignment: .trailing)
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            Text(en ? "Individual attendance" : "Asistencia individual").font(.system(size: 18, weight: .semibold))
            ForEach(model.screen.people.filter { matches($0.name) }) { person in
                if person.listed {
                    Button(person.line) { model.send(["op": "cycle", "personId": person.id]) }
                        .accessibilityIdentifier("nexo.person.\(person.id)")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                } else if !model.screen.encounterTitle.isEmpty {
                    Text(person.line)
                        .accessibilityIdentifier("nexo.offlist.\(person.id)")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 8)
                }
            }
        }
        .buttonStyle(.bordered)
    }

    private func templates(_ en: Bool) -> some View {
        VStack(alignment: .leading, spacing: 28) {
            Text(en ? "Templates" : "Plantillas")
                .font(.system(size: 40, weight: .semibold))
                .tracking(-1.2)
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    TextField(en ? "Draft" : "Borrador", text: $draft, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("nexo.draft-text")
                    Button(en ? "Save draft" : "Guardar borrador") {
                        model.send(["op": "draft", "text": draft])
                    }
                    .accessibilityIdentifier("nexo.save-draft")
                    if !model.screen.draft.isEmpty {
                        Text(model.screen.draft).font(.system(size: 12)).accessibilityIdentifier("nexo.draft-saved")
                    }
                    if !model.screen.warning.isEmpty {
                        Text(model.screen.warning).font(.system(size: 12)).accessibilityIdentifier("nexo.draft-warning")
                    }
                }
                .padding(22)
                .frame(maxWidth: 280, minHeight: 220, alignment: .topLeading)
                .background(.white, in: RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.89), lineWidth: 1))
                VStack(spacing: 12) {
                    Image(systemName: "doc")
                        .font(.system(size: 28, weight: .light))
                        .foregroundStyle(.secondary)
                    Text(en ? "Blank template" : "Plantilla en blanco")
                        .font(.system(size: 16, weight: .medium))
                }
                .frame(width: 160, height: 220)
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(white: 0.8), style: StrokeStyle(lineWidth: 1, dash: [5])))
            }
        }
        .buttonStyle(.bordered)
    }

    private func organize(_ en: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .bottom) {
                Text(en ? "Organization" : "Organización")
                    .font(.system(size: 40, weight: .semibold))
                    .tracking(-1.2)
                Spacer()
                Text(en ? "Create component" : "Crear componente")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(cardInk, in: RoundedRectangle(cornerRadius: 9))
            }
            VStack(alignment: .leading, spacing: 12) {
                Text("01").font(.system(size: 11)).foregroundStyle(.secondary)
                Text(model.screen.componentName.isEmpty ? (en ? "Component" : "Componente") : model.screen.componentName)
                    .font(.system(size: 32, weight: .semibold))
                Text(model.screen.encounterTitle.isEmpty ? (en ? "0 encounters" : "0 encuentros") : (en ? "1 encounter" : "1 encuentro"))
                    .font(.system(size: 12))
            }
            .padding(24)
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
            .background(Color(red: 0.886, green: 0.890, blue: 0.906), in: RoundedRectangle(cornerRadius: 16))
            Text(en ? "People groups" : "Grupos de personas")
                .font(.system(size: 18, weight: .semibold))
            Text(en ? "No groups" : "Sin grupos")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            Text(en ? "Review Drive stays on this Mac. Nothing is uploaded." : "Revisar Drive se queda en este Mac. No hay subidas.")
                .foregroundStyle(.secondary)
            if !model.screen.encounterTitle.isEmpty {
                Text(model.screen.suggestion).accessibilityIdentifier("nexo.suggestion")
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
                        if !person.volunteer.isEmpty { Text(person.volunteer) }
                    }
                }
            }
            if !model.screen.refusal.isEmpty {
                Text(model.screen.refusal).accessibilityIdentifier("nexo.refusal")
            }
            Button(en ? "Save collaboration" : "Guardar colaboración") { model.send(["op": "collaborate"]) }
                .accessibilityIdentifier("nexo.collaborate")
            if !model.screen.collaboration.isEmpty {
                Text(model.screen.collaboration).accessibilityIdentifier("nexo.collaboration")
                ForEach(model.screen.alternatives) { alternative in
                    Button(en ? "Choose \(alternative.value)" : "Elegir \(alternative.value)") {
                        model.send(["op": "choose-alternative", "versionId": alternative.id])
                    }
                    .accessibilityIdentifier("nexo.alternative.\(alternative.id)")
                }
                Button(en ? "Restore" : "Restaurar") { model.send(["op": "restore"]) }
                    .accessibilityIdentifier("nexo.restore")
            }
            Button(en ? "Migrate" : "Migrar") { model.send(["op": "migrate"]) }
                .accessibilityIdentifier("nexo.migrate")
            Button(en ? "Revert" : "Revertir") { model.send(["op": "revert"]) }
                .accessibilityIdentifier("nexo.revert")
        }
        .buttonStyle(.bordered)
    }

    private func bottomBar(_ en: Bool, wide: Bool) -> some View {
        HStack(spacing: wide ? 4 : 0) {
            ForEach(NexoSection.allCases, id: \.self) { item in
                Button { section = item } label: {
                    VStack(spacing: 4) {
                        Image(systemName: icon(item)).font(.system(size: 16))
                        Text(label(item, en: en)).font(.system(size: wide ? 11 : 10, weight: .medium)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .frame(minWidth: wide ? 64 : 46)
                    .padding(.vertical, 8)
                    .padding(.horizontal, wide ? 6 : 2)
                    .background(section == item ? Color.primary.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .accessibilityIdentifier("nexo.section.\(item.rawValue)")
            }
            Button { creating = true; section = .encounters } label: {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(Color.black, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("nexo.section.add")
            .padding(.leading, 6)
        }
        .padding(wide ? 8 : 6)
        .background(.white, in: Capsule())
        .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
        .padding(.horizontal, wide ? 0 : 8)
        .padding(.bottom, 12)
    }

    private func label(_ item: NexoSection, en: Bool) -> String {
        switch item {
        case .encounters: en ? "Encounters" : "Encuentros"
        case .people: en ? "People" : "Personas"
        case .attendance: en ? "Attendance" : "Asistencia"
        case .templates: en ? "Templates" : "Plantillas"
        case .organize: en ? "Organize" : "Organizar"
        }
    }

    private func icon(_ item: NexoSection) -> String {
        switch item {
        case .encounters: "calendar"
        case .people: "person.2"
        case .attendance: "waveform.path.ecg"
        case .templates: "doc.text"
        case .organize: "square.stack.3d.up"
        }
    }

    private func addPerson() {
        let name = personName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        personName = ""
        model.send(["op": "add-person", "name": name])
    }

    private func createEncounter() {
        let title = encounterTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty {
            creating = true
            return
        }
        model.send([
            "op": "create-encounter",
            "title": title,
            "roster": model.screen.people.filter { roster.contains($0.id) }.map(\.id),
        ])
        creating = false
    }

    private func matches(_ text: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return needle.isEmpty || text.localizedCaseInsensitiveContains(needle)
    }

    private func avatarFill(_ index: Int) -> Color {
        let fills = [
            Color(red: 0.886, green: 0.890, blue: 0.906),
            Color(red: 0.859, green: 0.867, blue: 0.886),
            Color(red: 0.914, green: 0.914, blue: 0.925),
        ]
        return fills[index % fills.count]
    }

    private func registeredLine(_ en: Bool) -> String {
        let count = model.screen.registered
        return en ? "\(count) of \(count) registered" : "\(count) de \(count) registrados"
    }

    private func peopleLine(_ en: Bool) -> String {
        let count = model.screen.encounterTitle.isEmpty ? model.screen.people.count : model.screen.registered
        if en { return count == 1 ? "1 person" : "\(count) people" }
        return count == 1 ? "1 persona" : "\(count) personas"
    }

    private func date(from iso: String) -> Date? {
        guard !iso.isEmpty else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    private func zone() -> TimeZone {
        TimeZone(identifier: model.screen.timeZone) ?? .gmt
    }

    private func week(_ iso: String) -> [WeekDay] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone()
        calendar.firstWeekday = 1
        let anchor = date(from: iso) ?? Date()
        let start = calendar.dateInterval(of: .weekOfYear, for: anchor)?.start ?? anchor
        let symbols = model.english
            ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
            : ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"]
        return (0..<7).compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: start) else { return nil }
            let number = calendar.component(.day, from: day)
            let selected = calendar.isDate(day, inSameDayAs: anchor)
            return WeekDay(weekday: symbols[offset], number: "\(number)", selected: selected)
        }
    }

    private func monthTitle(_ iso: String, en: Bool) -> String {
        guard let day = date(from: iso) else { return en ? "No date" : "Sin fecha" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: en ? "en_US" : "es_ES")
        formatter.timeZone = zone()
        formatter.dateFormat = "LLLL yyyy"
        return formatter.string(from: day).capitalized
    }

    private func monthAbbrev(_ iso: String, en: Bool) -> String {
        guard let day = date(from: iso) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: en ? "en_US" : "es_ES")
        formatter.timeZone = zone()
        formatter.dateFormat = "MMM"
        return formatter.string(from: day).lowercased()
    }

    private func dayNumber(_ iso: String) -> String {
        guard let day = date(from: iso) else { return "" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone()
        return "\(calendar.component(.day, from: day))"
    }

    private func badge(_ iso: String, en: Bool) -> String {
        guard let day = date(from: iso) else { return "" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone()
        let number = calendar.component(.day, from: day)
        return "\(number) \(monthAbbrev(iso, en: en).uppercased())"
    }

    private func clock(_ iso: String, en: Bool) -> String {
        guard let day = date(from: iso) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: en ? "en_US" : "es_ES")
        formatter.timeZone = zone()
        formatter.dateFormat = "h:mm a"
        formatter.amSymbol = en ? "a.m." : "a. m."
        formatter.pmSymbol = en ? "p.m." : "p. m."
        return formatter.string(from: day)
    }
}

private struct EncounterWaves: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 500
        let sy = rect.height / 400
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * sx, y: y * sy) }
        var path = Path()
        path.move(to: p(-10, 340))
        path.addCurve(to: p(235, 80), control1: p(100, 350), control2: p(64, 110))
        path.addCurve(to: p(510, 125), control1: p(406, 50), control2: p(395, 227))
        path.move(to: p(-10, 368))
        path.addCurve(to: p(246, 110), control1: p(130, 364), control2: p(75, 137))
        path.addCurve(to: p(520, 160), control1: p(417, 83), control2: p(410, 251))
        path.move(to: p(-10, 394))
        path.addCurve(to: p(256, 140), control1: p(140, 390), control2: p(95, 168))
        path.addCurve(to: p(520, 194), control1: p(417, 112), control2: p(427, 280))
        return path
    }
}

private struct WeekDay: Identifiable {
    var weekday: String
    var number: String
    var selected: Bool
    var id: String { "\(weekday)-\(number)" }
}
