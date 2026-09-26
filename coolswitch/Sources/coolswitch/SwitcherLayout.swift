import Foundation

enum GridDirection { case up, down, left, right }

struct SwitcherLayout {
    static let rowHeight: CGFloat = 48
    static let rowGap: CGFloat = 2
    static let columnGap: CGFloat = 10
    static let padding: CGFloat = 8
    static let minimumColumnWidth: CGFloat = 560
    static let preferredColumnWidth: CGFloat = 640

    let count: Int
    let columns: Int
    let rowsPerColumn: Int
    let visibleRows: Int
    let columnWidth: CGFloat
    let panelSize: CGSize
    let documentSize: CGSize
    var scrolls: Bool { rowsPerColumn > visibleRows }

    init(count: Int, screenSize: CGSize) {
        self.count = max(0, count)
        let width = max(1, screenSize.width - 40)
        let height = max(1, screenSize.height - 40)
        let innerWidth = max(1, width - 2 * Self.padding)
        let innerHeight = max(1, height - 2 * Self.padding)
        let maxRows = max(1, Int((innerHeight + Self.rowGap) / (Self.rowHeight + Self.rowGap)))
        let maxColumns = max(1, Int((innerWidth + Self.columnGap) / (Self.minimumColumnWidth + Self.columnGap)))
        columns = min(maxColumns, max(1, (self.count + maxRows - 1) / maxRows))
        rowsPerColumn = self.count > maxRows * maxColumns
            ? (self.count + columns - 1) / columns
            : min(maxRows, max(1, self.count))
        visibleRows = min(maxRows, rowsPerColumn)
        let gaps = CGFloat(columns - 1) * Self.columnGap
        columnWidth = min(Self.preferredColumnWidth, max(1, (innerWidth - gaps) / CGFloat(columns)))
        documentSize = CGSize(width: CGFloat(columns) * columnWidth + gaps,
                              height: CGFloat(rowsPerColumn) * (Self.rowHeight + Self.rowGap) - Self.rowGap)
        panelSize = CGSize(width: min(width, documentSize.width + 2 * Self.padding),
                           height: min(height, CGFloat(visibleRows) * (Self.rowHeight + Self.rowGap) - Self.rowGap + 2 * Self.padding))
    }

    func frame(at index: Int) -> CGRect {
        CGRect(x: CGFloat(index / rowsPerColumn) * (columnWidth + Self.columnGap),
               y: CGFloat(index % rowsPerColumn) * (Self.rowHeight + Self.rowGap),
               width: columnWidth, height: Self.rowHeight)
    }

    func moving(_ index: Int, _ direction: GridDirection) -> Int {
        guard count > 0, (0..<count).contains(index) else { return 0 }
        let column = index / rowsPerColumn
        let row = index % rowsPerColumn
        switch direction {
        case .up: return row > 0 ? index - 1 : index
        case .down: return row + 1 < rowsPerColumn && index + 1 < count ? index + 1 : index
        case .left: return column > 0 ? index - rowsPerColumn : index
        case .right:
            guard column + 1 < columns else { return index }
            return min(index + rowsPerColumn, count - 1)
        }
    }
}
