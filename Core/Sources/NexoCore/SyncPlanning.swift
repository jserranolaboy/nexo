import Foundation

public enum SyncEntityKind: String, Codable, CaseIterable, Sendable {
    case period, member, group, membership, component, category
    case event, attendance, volunteer, template
}

public struct PendingSyncMutation: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let organizationID: UUID
    public let kind: SyncEntityKind
    public let entityID: UUID
    public let expectedRevision: Int?
    public let payload: [String: JSONValue]
    public let queuedAt: Date
}

public struct SyncConflict: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let mutationID: UUID
    public let kind: SyncEntityKind
    public let entityID: UUID
    public let serverRevision: Int?
    public let serverPayload: [String: JSONValue]?
    public let detectedAt: Date
}

public enum SyncResolutionChoice: String, Codable, Sendable {
    case keepLocal, useServer
}

public struct ResolvedSyncConflict: Codable, Equatable, Identifiable, Sendable {
    public let id: UUID
    public let organizationID: UUID
    public let kind: SyncEntityKind
    public let entityID: UUID
    public let discardedMutationIDs: [UUID]
    public let localPayload: [String: JSONValue]
    public let serverPayload: [String: JSONValue]
    public let serverRevision: Int
    public let choice: SyncResolutionChoice
    public let resolvedAt: Date
}

public struct OrganizationSyncState: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID { organizationID }
    public let organizationID: UUID
    public let creationMutationID: UUID
    public let role: WorkspaceRole
    public var remoteCreated: Bool
    public var cursor: Int
    public var revisions: [String: Int]
    public var pending: [PendingSyncMutation]
    public var conflicts: [SyncConflict]

    public init(organizationID: UUID, creationMutationID: UUID = UUID(),
                role: WorkspaceRole = .administrator) {
        self.organizationID = organizationID
        self.creationMutationID = creationMutationID
        self.role = role
        self.remoteCreated = false
        self.cursor = 0
        self.revisions = [:]
        self.pending = []
        self.conflicts = []
    }

    public static func key(_ kind: SyncEntityKind, _ entityID: UUID) -> String {
        "\(kind.rawValue):\(entityID.uuidString)"
    }

    public mutating func stage<T: Encodable>(
        _ entity: T, kind: SyncEntityKind, id entityID: UUID, queuedAt: Date = .now
    ) throws {
        let key = Self.key(kind, entityID)
        let expectedRevision: Int?
        if let earlier = pending.last(where: { $0.kind == kind && $0.entityID == entityID }) {
            expectedRevision = (earlier.expectedRevision ?? 0) + 1
        } else {
            expectedRevision = revisions[key]
        }
        pending.append(PendingSyncMutation(
            id: UUID(), organizationID: organizationID, kind: kind,
            entityID: entityID, expectedRevision: expectedRevision,
            payload: try RemoteWorkspaceClient.payload(for: entity), queuedAt: queuedAt
        ))
    }

    /// The exact mutation ID survives network retries and app restarts.
    public mutating func acknowledge(_ mutationID: UUID, revision: Int) throws {
        guard let first = pending.first, first.id == mutationID,
              revision == (first.expectedRevision ?? 0) + 1
        else { throw SyncPlanningError.invalidAcknowledgement }
        revisions[Self.key(first.kind, first.entityID)] = revision
        pending.removeFirst()
    }

    public mutating func recordConflict(
        for mutationID: UUID, revision: Int?, payload: [String: JSONValue]?
    ) throws {
        guard let mutation = pending.first(where: { $0.id == mutationID })
        else { throw SyncPlanningError.invalidAcknowledgement }
        if let index = conflicts.firstIndex(where: { $0.mutationID == mutationID }) {
            let current = conflicts[index]
            if let revision, revision > (current.serverRevision ?? 0) {
                conflicts[index] = SyncConflict(
                    id: current.id, mutationID: mutationID, kind: mutation.kind,
                    entityID: mutation.entityID, serverRevision: revision,
                    serverPayload: payload, detectedAt: current.detectedAt
                )
            }
            return
        }
        conflicts.append(SyncConflict(
            id: UUID(), mutationID: mutationID, kind: mutation.kind,
            entityID: mutation.entityID, serverRevision: revision,
            serverPayload: payload, detectedAt: .now
        ))
    }
}

public enum SyncPlanningError: Error, Equatable, Sendable {
    case organizationNotFound
    case alreadyActivated
    case organizationAlreadyExists
    case invalidRemoteRole
    case readOnlyAssociation
    case unsupportedRemoval
    case invalidVolunteerTransition
    case invalidAcknowledgement
}

public enum SyncPlanner {
    /// Queues a copied association in dependency order. The service creates
    /// the association using `creationMutationID` before receiving its rows.
    public static func activate(_ snapshot: inout WorkspaceSnapshot, organizationID: UUID) throws {
        guard snapshot.organizations.contains(where: { $0.id == organizationID })
        else { throw SyncPlanningError.organizationNotFound }
        guard !snapshot.syncStates.contains(where: { $0.organizationID == organizationID })
        else { throw SyncPlanningError.alreadyActivated }
        var state = OrganizationSyncState(organizationID: organizationID)
        try captureEntities(from: WorkspaceSnapshot(), to: snapshot,
                            organizationID: organizationID, into: &state)
        snapshot.syncStates.append(state)
    }

    /// Starts a second Mac from the service's association list. Existing
    /// local records are never silently merged with an unrelated cloud copy.
    public static func join(_ snapshot: inout WorkspaceSnapshot,
                            remote: RemoteOrganization) throws {
        guard !snapshot.organizations.contains(where: { $0.id == remote.id })
        else { throw SyncPlanningError.organizationAlreadyExists }
        guard let role = WorkspaceRole(rawValue: remote.role)
        else { throw SyncPlanningError.invalidRemoteRole }
        snapshot.organizations.append(Organization(
            id: remote.id, name: remote.name, timeZoneIdentifier: remote.timeZone
        ))
        var state = OrganizationSyncState(organizationID: remote.id, role: role)
        state.remoteCreated = true
        snapshot.syncStates.append(state)
    }

    /// Call before the local snapshot is atomically saved. No queue entry is
    /// created in local-only mode, where no service account exists yet.
    public static func captureChanges(
        from previous: WorkspaceSnapshot, into proposed: inout WorkspaceSnapshot
    ) throws {
        for index in proposed.syncStates.indices {
            let organizationID = proposed.syncStates[index].organizationID
            let oldCount = proposed.syncStates[index].pending.count
            try captureEntities(from: previous, to: proposed,
                                organizationID: organizationID,
                                into: &proposed.syncStates[index])
            if proposed.syncStates[index].role == .reader &&
                proposed.syncStates[index].pending.count > oldCount {
                throw SyncPlanningError.readOnlyAssociation
            }
        }
    }

    private static func captureEntities(
        from previous: WorkspaceSnapshot, to next: WorkspaceSnapshot,
        organizationID: UUID, into state: inout OrganizationSyncState
    ) throws {
        try capture(previous.periods, next.periods, kind: .period,
                    belongs: { $0.organizationID == organizationID }, into: &state)
        try capture(previous.members, next.members, kind: .member,
                    belongs: { $0.organizationID == organizationID }, into: &state)
        try capture(previous.groups, next.groups, kind: .group,
                    belongs: { $0.organizationID == organizationID }, into: &state)
        try capture(previous.memberships, next.memberships, kind: .membership,
                    belongs: { membership in
                        next.members.first { $0.id == membership.memberID }?.organizationID == organizationID
                    }, into: &state)
        try capture(previous.components, next.components, kind: .component,
                    belongs: { $0.organizationID == organizationID }, into: &state)
        try capture(previous.categories, next.categories, kind: .category,
                    belongs: { category in
                        next.components.first { $0.id == category.componentID }?.organizationID == organizationID
                    }, into: &state)
        try capture(previous.events, next.events, kind: .event,
                    belongs: { $0.organizationID == organizationID }, into: &state)
        try capture(previous.attendance, next.attendance, kind: .attendance,
                    belongs: { entry in
                        next.events.first { $0.id == entry.eventID }?.organizationID == organizationID
                    }, into: &state)
        try captureVolunteers(previous.volunteers, next.volunteers, events: next.events,
                              organizationID: organizationID, into: &state)
        try capture(previous.templates, next.templates, kind: .template,
                    belongs: { $0.organizationID == organizationID }, into: &state)
    }

    private static func capture<T: Codable & Equatable & Identifiable>(
        _ old: [T], _ new: [T], kind: SyncEntityKind,
        belongs: (T) -> Bool, into state: inout OrganizationSyncState
    ) throws where T.ID == UUID {
        let oldByID = Dictionary(uniqueKeysWithValues: old.map { ($0.id, $0) })
        let newIDs = Set(new.map(\.id))
        guard !old.contains(where: { belongs($0) && !newIDs.contains($0.id) })
        else { throw SyncPlanningError.unsupportedRemoval }
        for entity in new where belongs(entity) && oldByID[entity.id] != entity {
            try state.stage(entity, kind: kind, id: entity.id)
        }
    }

    private static func captureVolunteers(
        _ old: [VolunteerEntry], _ new: [VolunteerEntry], events: [ActivityEvent],
        organizationID: UUID, into state: inout OrganizationSyncState
    ) throws {
        let oldByID = Dictionary(uniqueKeysWithValues: old.map { ($0.id, $0) })
        let newIDs = Set(new.map(\.id))
        let eventIDs = Set(events.filter { $0.organizationID == organizationID }.map(\.id))
        guard !old.contains(where: { eventIDs.contains($0.eventID) && !newIDs.contains($0.id) })
        else { throw SyncPlanningError.unsupportedRemoval }
        for entry in new where eventIDs.contains(entry.eventID) && oldByID[entry.id] != entry {
            let previous = oldByID[entry.id]
            guard previous == nil || (previous?.eventID == entry.eventID &&
                                      previous?.memberID == entry.memberID &&
                                      previous?.registeredAt == entry.registeredAt)
            else { throw SyncPlanningError.invalidVolunteerTransition }
            let steps: [VolunteerStatus]
            switch (previous?.status, entry.status) {
            case (nil, .interested): steps = [.interested]
            case (nil, .selected): steps = [.interested, .selected]
            case (nil, .completed): steps = [.interested, .selected, .completed]
            case (nil, .declined): steps = [.interested, .declined]
            case (nil, .noShow): steps = [.interested, .selected, .noShow]
            case (.interested, .selected): steps = [.selected]
            case (.interested, .completed): steps = [.selected, .completed]
            case (.interested, .noShow): steps = [.selected, .noShow]
            case (.interested, .declined), (.selected, .declined),
                 (.selected, .completed), (.selected, .noShow): steps = [entry.status]
            default: throw SyncPlanningError.invalidVolunteerTransition
            }
            for step in steps {
                var staged = entry
                staged.status = step
                try state.stage(staged, kind: .volunteer, id: entry.id)
            }
        }
    }
}
