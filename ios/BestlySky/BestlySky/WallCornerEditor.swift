// Bestly Admin: full-screen corner editor. A 16:9 canvas with draggable handles for the four wall quads.
import SwiftUI

struct WallCornerEditor: View {
    @ObservedObject var model: WallModel
    @Environment(\.dismiss) private var dismiss

    enum Quad: String, CaseIterable, Identifiable {
        case corners, mask, wing, air
        var id: String { rawValue }
        var title: String {
            switch self {
            case .corners: return "Strip"
            case .mask: return "Blocked"
            case .wing: return "Sign wall"
            case .air: return "Sky"
            }
        }
        var note: String {
            switch self {
            case .corners: return "The four corners of the strip of cards."
            case .mask: return "An area to keep blank, such as a window. 3 to 6 points."
            case .wing: return "The side wall where guests sign."
            case .air: return "Where the sky and planes are drawn."
            }
        }
    }

    static let defaultCorners: [CGPoint] = [CGPoint(x: 0.05, y: 0.40), CGPoint(x: 0.95, y: 0.40), CGPoint(x: 0.95, y: 0.55), CGPoint(x: 0.05, y: 0.55)]
    static let defaultWing: [CGPoint] = [CGPoint(x: 0.02, y: 0.33), CGPoint(x: 0.27, y: 0.36), CGPoint(x: 0.27, y: 0.66), CGPoint(x: 0.02, y: 0.70)]
    static let defaultAir: [CGPoint] = [CGPoint(x: 0.30, y: 0.17), CGPoint(x: 0.99, y: 0.05), CGPoint(x: 0.99, y: 0.25), CGPoint(x: 0.30, y: 0.37)]

    @State private var quad: Quad = .corners
    @State private var drafts: [String: [CGPoint]] = [:]
    @State private var dirty: Set<String> = []
    @State private var removeMask = false
    @State private var saving = false
    @State private var saveError: String?

    private let pad: CGFloat = 72

    var body: some View {
        ZStack {
            AT.bg.ignoresSafeArea()
            VStack(spacing: 14) {
                header
                canvas
                controls
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
        .onAppear { loadAll() }
        .screenView("wall_corner_editor")
    }

    // MARK: header

    private var header: some View {
        HStack {
            Text("Edit corners").font(.system(size: 22, weight: .bold)).foregroundStyle(AT.text)
            Spacer()
        }
        .padding(.top, 12)
    }

    // MARK: points

    private func points(_ q: Quad) -> [CGPoint] { drafts[q.rawValue] ?? [] }

    private func parse(_ v: Any?) -> [CGPoint]? {
        guard let arr = v as? [Any] else { return nil }
        var out: [CGPoint] = []
        for item in arr {
            guard let p = item as? [Any], p.count >= 2 else { continue }
            guard let x = Self.number(p[0]), let y = Self.number(p[1]) else { continue }
            out.append(CGPoint(x: x, y: y))
        }
        return out.isEmpty ? nil : out
    }

    private static func number(_ a: Any) -> Double? {
        if let d = a as? Double { return d }
        if let i = a as? Int { return Double(i) }
        if let n = a as? NSNumber { return n.doubleValue }
        return nil
    }

    private func loadAll() {
        let s = model.state
        drafts["corners"] = parse(s["corners"]) ?? Self.defaultCorners
        drafts["wing"] = parse(s["wing"]) ?? Self.defaultWing
        drafts["air"] = parse(s["air"]) ?? Self.defaultAir
        drafts["mask"] = parse(s["mask"]) ?? []
    }

    private func clamp(_ v: Double) -> Double { min(1.5, max(-0.5, v)) }

    private func set(_ i: Int, to p: CGPoint) {
        var list = points(quad)
        guard list.indices.contains(i) else { return }
        list[i] = CGPoint(x: clamp(p.x), y: clamp(p.y))
        drafts[quad.rawValue] = list
        dirty.insert(quad.rawValue)
        if quad == .mask { removeMask = false }
    }

    // MARK: canvas

    private struct Frame {
        var ox: CGFloat
        var oy: CGFloat
        var w: CGFloat
        var h: CGFloat
    }

    private var canvas: some View {
        GeometryReader { geo in
            let w = max(10, min(geo.size.width - pad, (geo.size.height - pad) * 16 / 9))
            let h = w * 9 / 16
            let f = Frame(ox: (geo.size.width - w) / 2, oy: (geo.size.height - h) / 2, w: w, h: h)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(AT.hex(0x14141A))
                    .frame(width: f.w, height: f.h)
                    .overlay(gridLines())
                    .offset(x: f.ox, y: f.oy)
                polygon(f)
                ForEach(Array(points(quad).enumerated()), id: \.offset) { i, p in
                    handle(index: i, point: p, f: f)
                }
            }
            .coordinateSpace(name: "wallcanvas")
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, minHeight: 200, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Wall layout canvas. Drag the handles.")
    }

    private func gridLines() -> some View {
        Canvas { ctx, size in
            for i in 1..<4 {
                let x = size.width * CGFloat(i) / 4
                ctx.fill(Path(CGRect(x: x, y: 0, width: 1, height: size.height)), with: .color(Color.white.opacity(0.05)))
                let y = size.height * CGFloat(i) / 4
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(Color.white.opacity(0.05)))
            }
        }
        .allowsHitTesting(false)
    }

    private func toView(_ p: CGPoint, _ f: Frame) -> CGPoint {
        CGPoint(x: f.ox + p.x * f.w, y: f.oy + p.y * f.h)
    }

    private func polygon(_ f: Frame) -> some View {
        let pts = points(quad).map { toView($0, f) }
        return Canvas { ctx, _ in
            guard pts.count >= 2 else { return }
            var path = Path()
            path.move(to: pts[0])
            for p in pts.dropFirst() { path.addLine(to: p) }
            path.closeSubpath()
            ctx.fill(path, with: .color(AT.lime.opacity(0.13)))
            ctx.stroke(path, with: .color(AT.lime), style: StrokeStyle(lineWidth: 2, lineJoin: .round))
        }
        .allowsHitTesting(false)
    }

    private func handle(index i: Int, point: CGPoint, f: Frame) -> some View {
        let pos = toView(point, f)
        return ZStack {
            Circle().fill(AT.lime.opacity(0.25)).frame(width: 44, height: 44)
            Circle().fill(AT.lime).frame(width: 22, height: 22).shadow(color: AT.lime.opacity(0.6), radius: 6)
            Text("\(i + 1)").font(.system(size: 11, weight: .heavy)).foregroundStyle(AT.hex(0x1A2308))
        }
        .frame(width: 44, height: 44)
        .contentShape(Circle())
        .position(pos)
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named("wallcanvas"))
                .onChanged { v in
                    let nx = (v.location.x - f.ox) / f.w
                    let ny = (v.location.y - f.oy) / f.h
                    set(i, to: CGPoint(x: nx, y: ny))
                }
        )
        .accessibilityLabel("Point \(i + 1) of \(points(quad).count)")
        .accessibilityValue("x \(Int((point.x * 100).rounded())) percent, y \(Int((point.y * 100).rounded())) percent")
        .accessibilityAdjustableAction { dir in
            let step = dir == .increment ? 0.01 : -0.01
            set(i, to: CGPoint(x: point.x + step, y: point.y))
        }
    }

    // MARK: controls

    private var controls: some View {
        VStack(spacing: 12) {
            let cols: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)
            LazyVGrid(columns: cols, spacing: 8) {
                ForEach(Quad.allCases) { q in
                    Button {
                        Haptics.select()
                        quad = q
                    } label: {
                        Text(q.title).font(.system(size: 12, weight: .bold)).fixedSize().frame(maxWidth: .infinity, minHeight: 46)
                    }
                    .buttonStyle(RemoteKey(face: quad == q ? .selected : .normal))
                    .accessibilityLabel(q.title)
                    .accessibilityAddTraits(quad == q ? .isSelected : [])
                }
            }
            Text(quad.note).font(.system(size: 13)).foregroundStyle(AT.secondary)
                .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)

            if quad == .mask { maskControls }
            if let e = saveError {
                Text(e).font(.system(size: 13)).foregroundStyle(AT.orange)
                    .frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                editKey("Reset") { resetCurrent() }
                editKey("Cancel") { dismiss() }
                Button { save() } label: {
                    Text("Save").font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(RemoteKey(face: .selected))
                .opacity(dirty.isEmpty || saving ? 0.5 : 1)
                .accessibilityLabel("Save layout")
            }
        }
    }

    private func editKey(_ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 15, weight: .bold)).frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(RemoteKey())
        .accessibilityLabel(label)
    }

    private var maskControls: some View {
        let n = points(.mask).count
        return HStack(spacing: 10) {
            editKey(n == 0 ? "Add blocked area" : "Add point") { addMaskPoint() }
            if n > 0 {
                editKey(n > 3 ? "Remove point" : "Remove area") { removeMaskPoint() }
            }
        }
    }

    private func addMaskPoint() {
        var list = points(.mask)
        if list.isEmpty {
            let c = points(.corners)
            let tr = c.count > 1 ? c[1] : CGPoint(x: 0.95, y: 0.4)
            let br = c.count > 2 ? c[2] : CGPoint(x: 0.95, y: 0.55)
            list = [CGPoint(x: br.x - 0.12, y: br.y + 0.02), CGPoint(x: tr.x + 0.02, y: tr.y + (br.y - tr.y) * 0.35), CGPoint(x: br.x + 0.02, y: br.y + 0.02)]
            Haptics.tap()
        } else if list.count < 6 {
            let a = list[list.count - 1]
            let b = list[0]
            list.append(CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 0.03))
            Haptics.tap()
        } else {
            Haptics.nope()
            return
        }
        drafts["mask"] = list
        dirty.insert("mask")
        removeMask = false
    }

    private func removeMaskPoint() {
        var list = points(.mask)
        if list.count > 3 {
            list.removeLast()
            drafts["mask"] = list
            Haptics.tap()
        } else {
            drafts["mask"] = []
            removeMask = true
            Haptics.thunk()
        }
        dirty.insert("mask")
    }

    private func resetCurrent() {
        Haptics.select()
        switch quad {
        case .corners: drafts["corners"] = Self.defaultCorners
        case .wing: drafts["wing"] = Self.defaultWing
        case .air: drafts["air"] = Self.defaultAir
        case .mask:
            drafts["mask"] = []
            removeMask = true
        }
        dirty.insert(quad.rawValue)
    }

    private func save() {
        guard !dirty.isEmpty else { Haptics.nope(); return }
        var patch = JSON()
        for key in dirty {
            let list = drafts[key] ?? []
            if key == "mask" {
                if list.isEmpty { if removeMask { patch["mask"] = NSNull() } } else if list.count >= 3 && list.count <= 6 { patch["mask"] = encode(list) }
            } else if list.count == 4 {
                patch[key] = encode(list)
            }
        }
        guard !patch.isEmpty else { Haptics.nope(); return }
        guard !saving else { return }
        saving = true
        Task {
            let ok = await model.savePatch(patch, say: "LAYOUT|Saved. Undo is in the Align bank.", id: "wall.layout")
            saving = false
            if ok { dismiss() } else { saveError = "The wall didn't take that layout. Nothing changed. Try again." }
        }
    }

    private func encode(_ list: [CGPoint]) -> [[Double]] {
        list.map { [($0.x * 10000).rounded() / 10000, ($0.y * 10000).rounded() / 10000] }
    }
}
