import Foundation

@MainActor
protocol SwitchWorking: Sendable {
    func resolve(_ entries: [WindowEntry], token: OperationToken,
                 completion: @escaping @MainActor @Sendable (Result<EntryIdentity?, AccessibilityFailure>) -> Void)
    func focus(_ entry: WindowEntry, token: OperationToken,
               completion: @escaping @MainActor @Sendable (Result<Void, FocusFailure>) -> Void)
}

@MainActor
final class SwitchController {
    enum Disposition { case show, commit }
    struct Pending {
        let entries: [WindowEntry]
        let backwards: Bool
        let screenSize: CGSize
        let token: OperationToken
        var moves: [SwitchSession.Move] = []
        var disposition = Disposition.show
    }
    enum State {
        case idle
        case resolving(Pending)
        case showing(SwitchSession, OperationToken)
        case focusing(WindowEntry, OperationToken)

        var token: OperationToken? {
            switch self {
            case .idle: return nil
            case .resolving(let pending): return pending.token
            case .showing(_, let token), .focusing(_, let token): return token
            }
        }
    }
    private(set) var state = State.idle
    private let work: any SwitchWorking
    var changed: () -> Void = {}
    var observed: (EntryIdentity) -> Void = { _ in }
    var completed: (WindowEntry, Result<Void, FocusFailure>) -> Void = { _, _ in }
    var lookupFailed: (AccessibilityFailure) -> Void = { _ in }

    init(work: any SwitchWorking) { self.work = work }
    var isIdle: Bool { if case .idle = state { return true }; return false }
    var isActive: Bool {
        switch state {
        case .resolving(let pending): return pending.disposition == .show
        case .showing: return true
        default: return false
        }
    }
    var visibleSession: SwitchSession? {
        if case .showing(let session, _) = state { return session }
        return nil
    }

    func begin(entries: [WindowEntry], backwards: Bool, screenSize: CGSize) {
        cancel()
        guard !entries.isEmpty else { return }
        let token = OperationToken()
        state = .resolving(Pending(entries: entries, backwards: backwards, screenSize: screenSize, token: token))
        changed()
        work.resolve(entries, token: token) { [weak self] result in
            self?.resolved(result, token: token)
        }
    }

    func move(_ move: SwitchSession.Move) {
        switch state {
        case .resolving(var pending) where pending.disposition == .show:
            pending.moves.append(move)
            state = .resolving(pending)
        case .showing(var session, let token):
            session.move(move)
            state = .showing(session, token)
        default: return
        }
        changed()
    }

    func commit() {
        switch state {
        case .resolving(var pending):
            pending.disposition = .commit
            state = .resolving(pending)
            changed()
        case .showing(let session, let token): focus(session, token: token)
        default: break
        }
    }

    func cancel() {
        state.token?.cancel()
        state = .idle
        changed()
    }

    private func resolved(_ result: Result<EntryIdentity?, AccessibilityFailure>, token: OperationToken) {
        guard case .resolving(let pending) = state, pending.token === token, !token.isCancelled else { return }
        switch result {
        case .failure(let error):
            cancel()
            lookupFailed(error)
        case .success(let focused):
            var session = SwitchSession(entries: pending.entries, focused: focused,
                                        backwards: pending.backwards, screenSize: pending.screenSize)
            for move in pending.moves { session.move(move) }
            if let focused { observed(focused) }
            if pending.disposition == .commit { focus(session, token: token) }
            else { state = .showing(session, token); changed() }
        }
    }

    private func focus(_ session: SwitchSession, token: OperationToken) {
        guard let entry = session.selected else { cancel(); return }
        state = .focusing(entry, token)
        changed()
        work.focus(entry, token: token) { [weak self] result in
            guard let self, case .focusing(_, let current) = self.state,
                  current === token, !token.isCancelled else { return }
            self.state = .idle
            self.completed(entry, result)
            self.changed()
        }
    }
}
