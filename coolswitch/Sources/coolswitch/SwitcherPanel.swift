import AppKit

private final class SwitcherGridView: NSView {
    override var isFlipped: Bool { true }
}

final class SwitcherPanel: NSPanel {
    private let grid = SwitcherGridView()
    private let scroll = NSScrollView()
    private var rows: [NSView] = []
    private var desktopLabels: [(entry: WindowEntry, label: NSTextField)] = []
    private var layout = SwitcherLayout(count: 0, screenSize: CGSize(width: 800, height: 600))
    private var screenFrame = CGRect.zero

    var availableSize: CGSize { screenFrame.size }

    func prepare(count: Int) {
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main
        screenFrame = screen?.visibleFrame ?? CGRect(x: 0, y: 0, width: 800, height: 600)
        layout = SwitcherLayout(count: count, screenSize: screenFrame.size)
    }

    init() {
        super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        level = .popUpMenu
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        hidesOnDeactivate = false
        // Let AppKit render the translucent surface and adapt it to system
        // appearance/accessibility settings. Keep text and icons fully opaque.
        let background: NSView
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.style = .clear
            glass.cornerRadius = 12
            let content = NSView()
            glass.contentView = content
            contentView = glass
            background = content
        } else {
            let effect = NSVisualEffectView()
            effect.material = .hudWindow
            effect.blendingMode = .behindWindow
            effect.state = .active
            effect.wantsLayer = true
            effect.layer?.cornerRadius = 12
            effect.layer?.masksToBounds = true
            contentView = effect
            background = effect
        }
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = false
        scroll.scrollerStyle = .overlay
        scroll.autohidesScrollers = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        background.addSubview(scroll)
        scroll.documentView = grid
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: background.leadingAnchor, constant: 8),
            scroll.trailingAnchor.constraint(equalTo: background.trailingAnchor, constant: -8),
            scroll.topAnchor.constraint(equalTo: background.topAnchor, constant: 8),
            scroll.bottomAnchor.constraint(equalTo: background.bottomAnchor, constant: -8)
        ])
    }

    func show(_ entries: [WindowEntry], selected: Int, desktops: [CGWindowID: String] = [:]) {
        if layout.count != entries.count || screenFrame == .zero { prepare(count: entries.count) }
        grid.subviews.forEach { $0.removeFromSuperview() }
        rows = []
        desktopLabels = []
        scroll.hasVerticalScroller = layout.scrolls
        grid.setFrameSize(layout.documentSize)
        for (index, entry) in entries.enumerated() {
            let row = NSView(frame: layout.frame(at: index))
            row.wantsLayer = true
            row.layer?.cornerRadius = 6
            let icon = NSImageView()
            icon.image = entry.app.icon
            let title = NSTextField(labelWithString: entry.title)
            title.font = .systemFont(ofSize: 15.6, weight: .medium)
            title.lineBreakMode = .byTruncatingTail
            title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            let desktop = NSTextField(labelWithString: "")
            desktop.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            desktop.textColor = .secondaryLabelColor
            desktop.setContentHuggingPriority(.required, for: .horizontal)
            desktop.setContentCompressionResistancePriority(.required, for: .horizontal)
            desktopLabels.append((entry, desktop))
            for view in [icon, title, desktop] { view.translatesAutoresizingMaskIntoConstraints = false; row.addSubview(view) }
            grid.addSubview(row)
            NSLayoutConstraint.activate([
                icon.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 9), icon.centerYAnchor.constraint(equalTo: row.centerYAnchor, constant: entry.isApplicationOnly ? -3 : 0),
                icon.widthAnchor.constraint(equalToConstant: 30), icon.heightAnchor.constraint(equalToConstant: 30),
                title.trailingAnchor.constraint(equalTo: desktop.leadingAnchor, constant: -10),
                title.centerYAnchor.constraint(equalTo: row.centerYAnchor),
                desktop.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -12),
                desktop.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor)
            ])
            title.setAccessibilityLabel(entry.subtitle.isEmpty ? entry.title : entry.title + ", " + entry.subtitle)
            title.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 9).isActive = true
            title.toolTip = entry.subtitle.isEmpty ? entry.title : entry.title + " — " + entry.subtitle
            if entry.isApplicationOnly {
                title.centerYAnchor.constraint(equalTo: row.centerYAnchor).isActive = true
                let dash = NSBox()
                dash.boxType = .custom
                dash.borderWidth = 0
                dash.fillColor = .secondaryLabelColor
                dash.cornerRadius = 1
                dash.translatesAutoresizingMaskIntoConstraints = false
                dash.setAccessibilityElement(false)
                row.addSubview(dash)
                NSLayoutConstraint.activate([
                    dash.widthAnchor.constraint(equalToConstant: 8),
                    dash.heightAnchor.constraint(equalToConstant: 2),
                    dash.centerXAnchor.constraint(equalTo: icon.centerXAnchor),
                    dash.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 3)
                ])
                title.setAccessibilityLabel(entry.title + ", no open windows")
            }
            rows.append(row)
        }
        if let boundary = entries.firstIndex(where: \.isApplicationOnly), boundary > 0 {
            let firstApp = layout.frame(at: boundary)
            let divider = NSBox()
            divider.boxType = .separator
            divider.setAccessibilityElement(false)
            if boundary % layout.rowsPerColumn == 0 {
                // The section starts in a new column: separate the columns.
                divider.frame = NSRect(x: firstApp.minX - SwitcherLayout.columnGap / 2,
                                       y: 4, width: 1, height: layout.documentSize.height - 8)
            } else {
                divider.frame = NSRect(x: firstApp.minX + 9, y: firstApp.minY - 1,
                                       width: firstApp.width - 18, height: 1)
            }
            grid.addSubview(divider)
        }
        setFrame(NSRect(x: screenFrame.midX - layout.panelSize.width / 2,
                        y: screenFrame.midY - layout.panelSize.height / 2,
                        width: layout.panelSize.width, height: layout.panelSize.height), display: true)
        scroll.contentView.scroll(to: .zero)
        scroll.reflectScrolledClipView(scroll.contentView)
        setDesktops(desktops)
        highlight(selected)
        orderFrontRegardless()
    }

    /// Label each window with its desktop, unless every window is on the same one.
    /// Minimized windows show a minus instead, since they aren't on any desktop.
    func setDesktops(_ desktops: [CGWindowID: String]) {
        let names = desktopLabels.map { $0.entry.minimized ? nil : $0.entry.windowID.flatMap { desktops[$0] } }
        let useful = Set(names.compactMap { $0 }).count > 1
        for ((entry, label), name) in zip(desktopLabels, names) {
            label.stringValue = entry.minimized ? "\u{2212}" : useful ? name ?? "" : ""
            // The title already says "Minimized" to VoiceOver.
            label.setAccessibilityElement(!entry.minimized)
        }
        contentView?.layoutSubtreeIfNeeded()
    }

    func highlight(_ selected: Int) {
        for (index, row) in rows.enumerated() {
            row.layer?.backgroundColor = index == selected ? NSColor.controlAccentColor.withAlphaComponent(0.28).cgColor : NSColor.clear.cgColor
        }
        if rows.indices.contains(selected) { grid.scrollToVisible(rows[selected].frame) }
    }

    func clearEntries() {
        grid.subviews.forEach { $0.removeFromSuperview() }
        rows.removeAll()
        desktopLabels.removeAll()
    }
}
