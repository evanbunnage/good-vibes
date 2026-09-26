import Foundation

/// A resolved list and its selection. Lifecycle and pending input live in SwitchController.
struct SwitchSession {
    enum Move { case step(Int), direction(GridDirection) }
    private(set) var entries: [WindowEntry]
    private(set) var selection: Int
    let screenSize: CGSize

    init(entries: [WindowEntry], focused: EntryIdentity?, backwards: Bool, screenSize: CGSize) {
        var ordered = entries
        if let index = ordered.firstIndex(where: { $0.identity == focused && !$0.isApplicationOnly }) {
            ordered.insert(ordered.remove(at: index), at: 0)
        }
        self.entries = ordered
        self.selection = WindowStore.initialSelection(ordered, focused: focused, backwards: backwards)
        self.screenSize = screenSize
    }
    var selected: WindowEntry? { entries.indices.contains(selection) ? entries[selection] : nil }
    mutating func move(_ move: Move) {
        guard !entries.isEmpty else { return }
        switch move {
        case .step(let delta): selection = (selection + delta % entries.count + entries.count) % entries.count
        case .direction(let direction):
            selection = SwitcherLayout(count: entries.count, screenSize: screenSize).moving(selection, direction)
        }
    }
}

/// UI-owned ordering; discovery never mutates this state from its worker queue.
struct WindowCatalog {
    private(set) var entries: [WindowEntry] = []
    private var recent: [EntryIdentity] = []
    private(set) var revision = 0
    var mostRecent: EntryIdentity? { recent.first }

    func contains(_ identity: EntryIdentity) -> Bool { entries.contains { $0.identity == identity } }

    mutating func invalidate() { revision += 1 }
    mutating func clear() {
        invalidate()
        entries.removeAll()
        recent.removeAll()
    }
    mutating func receive(_ entries: [WindowEntry], revision: Int) {
        guard revision == self.revision else { return }
        recent.removeAll { identity in !entries.contains { $0.identity == identity } }
        self.entries = WindowStore.sorted(entries, recent: recent)
    }
    mutating func remember(_ identity: EntryIdentity) {
        invalidate()
        recent.removeAll { $0 == identity }
        recent.insert(identity, at: 0)
        entries = WindowStore.sorted(entries, recent: recent)
    }
}
