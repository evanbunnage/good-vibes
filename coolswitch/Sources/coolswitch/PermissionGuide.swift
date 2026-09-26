import AppKit

/// While the person is in System Settings granting Accessibility, a small panel sits in
/// the bottom of System Settings' content column, under the app list, with a CoolSwitch
/// row to drag into the list. That adds and turns on CoolSwitch without hunting for it
/// behind the + button.
///
/// Window positions come from `CGWindowListCopyWindowInfo`, which doesn't need Screen
/// Recording (only window titles do). No Accessibility calls: we don't have that yet, so
/// the list's exact position is unknown and the panel uses System Settings' layout.
@MainActor
final class PermissionGuide {
    private static let settingsBundleIdentifier = "com.apple.systempreferences"
    /// System Settings' sidebar width; the panel spans the content column to its right.
    private static let sidebarWidth: CGFloat = 230
    private static let height: CGFloat = 116
    private var panel: NSPanel?
    private var timer: Timer?
    private var sawSettings = false
    private var source: CGRect?

    var isActive: Bool { timer != nil }

    /// `source` is where the request came from, in screen coordinates; the panel flies
    /// in from there the first time System Settings appears.
    func start(from source: CGRect?) {
        guard timer == nil else { return }
        sawSettings = false
        self.source = source
        let timer = Timer(timeInterval: 0.15, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.follow() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        follow()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        panel?.orderOut(nil)
        panel = nil
    }

    private func follow() {
        let settings = NSRunningApplication.runningApplications(withBundleIdentifier: Self.settingsBundleIdentifier).first
        if settings != nil { sawSettings = true }
        // System Settings quit without granting: nothing left to guide.
        if settings == nil, sawSettings { stop(); return }
        guard let settings, settings.isActive, let window = Self.mainWindowFrame(of: settings.processIdentifier) else {
            panel?.orderOut(nil)
            return
        }
        let target = Self.targetFrame(in: window)
        if let panel, panel.isVisible {
            if panel.frame != target { panel.setFrame(target, display: true) }
            return
        }
        let panel = self.panel ?? makePanel()
        self.panel = panel
        present(panel, at: target)
    }

    /// Flies in from the request's source the first time, then just appears.
    private func present(_ panel: NSPanel, at target: CGRect) {
        guard let source, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else {
            panel.setFrame(target, display: true)
            panel.alphaValue = 1
            panel.orderFrontRegardless()
            return
        }
        self.source = nil
        let start = CGRect(x: source.midX - target.width / 2, y: source.midY - target.height / 2,
                           width: target.width, height: target.height)
        panel.setFrame(start, display: true)
        panel.alphaValue = 0
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.45
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
            panel.animator().setFrame(target, display: true)
            panel.animator().alphaValue = 1
        }
    }

    /// Across the bottom of the content column, inside the window, like Codex does.
    private static func targetFrame(in window: CGRect) -> CGRect {
        let columnMinX = window.minX + min(sidebarWidth, window.width * 0.4)
        let width = min(max(window.maxX - columnMinX - 40, 360), 560)
        let x = columnMinX + (window.maxX - columnMinX - width) / 2
        let screen = NSScreen.screens.first { $0.frame.intersects(window) }?.visibleFrame ?? window
        let y = max(window.minY + 18, screen.minY + 8)
        return CGRect(x: x.rounded(), y: y.rounded(), width: width.rounded(), height: height)
    }

    /// The largest on-screen, normal-level window of the process, in AppKit coordinates.
    private static func mainWindowFrame(of pid: pid_t) -> CGRect? {
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else { return nil }
        let frames = windows.compactMap { info -> CGRect? in
            guard info[kCGWindowOwnerPID as String] as? pid_t == pid,
                  info[kCGWindowLayer as String] as? Int == 0,
                  let bounds = info[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: bounds),
                  frame.width > 320, frame.height > 240 else { return nil }
            return frame
        }
        guard let frame = frames.max(by: { $0.width * $0.height < $1.width * $1.height }),
              let primary = NSScreen.screens.first else { return nil }
        // Window server coordinates start at the primary screen's top-left; AppKit's at its bottom-left.
        return CGRect(x: frame.minX, y: primary.frame.maxY - frame.maxY, width: frame.width, height: frame.height)
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: Self.height),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        // The system's own translucent surfaces, so the panel matches System Settings.
        let content = NSView()
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.cornerRadius = 18
            glass.contentView = content
            panel.contentView = glass
        } else {
            let effect = NSVisualEffectView()
            effect.material = .menu
            effect.state = .active
            effect.wantsLayer = true
            effect.layer?.cornerRadius = 14
            effect.layer?.masksToBounds = true
            effect.addSubview(content)
            content.frame = effect.bounds
            content.autoresizingMask = [.width, .height]
            panel.contentView = effect
        }

        let arrow = NSImageView(image: NSImage(systemSymbolName: "arrowshape.up.fill", accessibilityDescription: nil)!)
        arrow.symbolConfiguration = .init(pointSize: 22, weight: .bold)
        arrow.contentTintColor = .controlAccentColor
        let name = AppIdentity.displayName
        let prompt = NSMutableAttributedString(string: "Drag \(name) to the list above", attributes: [
            .font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.secondaryLabelColor
        ])
        prompt.addAttributes([.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.labelColor],
                             range: (prompt.string as NSString).range(of: name))
        let title = NSTextField(labelWithAttributedString: prompt)
        let header = NSStackView(views: [arrow, title])
        header.alignment = .centerY
        header.spacing = 10
        let row = AppRow()
        let stack = NSStackView(views: [header, row])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            row.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        return panel
    }
}

/// A stand-in for CoolSwitch's row in the Accessibility list, as a drag source. The
/// payload is the app itself, so dropping it on the list is the same as adding it with
/// the + button. The icon hops toward the list every few seconds and the row brightens
/// on hover, unless Reduce Motion is on.
private final class AppRow: NSView, NSDraggingSource {
    private let icon = CALayer()
    // The list shows names as Finder does, with ".app" only when extensions are shown.
    private let name = NSTextField(labelWithString: FileManager.default.displayName(atPath: Bundle.main.bundlePath))

    init() {
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        layer?.cornerRadius = 10
        layer?.borderWidth = 1
        setAccessibilityLabel("\(AppIdentity.displayName) app. Drag to the Accessibility list.")
        icon.contents = NSApp.applicationIconImage
        icon.contentsGravity = .resizeAspect
        layer?.addSublayer(icon)
        name.font = .systemFont(ofSize: 13)
        name.translatesAutoresizingMaskIntoConstraints = false
        addSubview(name)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 44),
            name.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 50),
            name.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self, userInfo: nil))
        updateColors(hovered: false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layout() {
        super.layout()
        icon.frame = CGRect(x: 12, y: (bounds.height - 28) / 2, width: 28, height: 28)
        startHopping()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateColors(hovered: false)
    }

    private func updateColors(hovered: Bool) {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            layer?.backgroundColor = NSColor.labelColor.withAlphaComponent(hovered ? 0.1 : 0.05).cgColor
            layer?.borderColor = NSColor.separatorColor.cgColor
        }
    }

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// A short hop toward the list, then a rest, repeating.
    private func startHopping() {
        guard !reduceMotion, icon.animation(forKey: "hop") == nil else { return }
        let hop = CAKeyframeAnimation(keyPath: "transform.translation.y")
        hop.values = [0, 5, 0, 2.5, 0]
        hop.keyTimes = [0, 0.12, 0.24, 0.32, 0.4]
        hop.duration = 2.8
        hop.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: 4)
        hop.repeatCount = .infinity
        icon.add(hop, forKey: "hop")
    }

    override func mouseEntered(with event: NSEvent) { updateColors(hovered: true) }
    override func mouseExited(with event: NSEvent) { updateColors(hovered: false) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }

    private var dragStarted = false

    override func mouseDown(with event: NSEvent) { dragStarted = false }

    override func mouseDragged(with event: NSEvent) {
        guard !dragStarted else { return }
        dragStarted = true
        let item = NSDraggingItem(pasteboardWriter: Bundle.main.bundleURL as NSURL)
        item.setDraggingFrame(icon.frame, contents: NSApp.applicationIconImage)
        let session = beginDraggingSession(with: [item], event: event, source: self)
        session.animatesToStartingPositionsOnCancelOrFail = true
    }

    /// Apps can't add themselves to the list, so a click points at the drag instead:
    /// a firm hop toward the list and a flash of the row.
    override func mouseUp(with event: NSEvent) {
        guard !dragStarted else { return }
        let flash = CABasicAnimation(keyPath: "backgroundColor")
        effectiveAppearance.performAsCurrentDrawingAppearance {
            flash.fromValue = NSColor.controlAccentColor.withAlphaComponent(0.25).cgColor
        }
        flash.duration = 0.5
        layer?.add(flash, forKey: "flash")
        guard !reduceMotion else { return }
        let hop = CAKeyframeAnimation(keyPath: "transform.translation.y")
        hop.values = [0, 12, 0, 7, 0, 3, 0]
        hop.duration = 0.6
        hop.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeOut), count: 6)
        icon.add(hop, forKey: "click")
    }

    func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) { alphaValue = 0.4 }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        alphaValue = 1
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        .copy
    }
}
