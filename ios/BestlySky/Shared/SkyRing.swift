// Bestly Admin: the progress ring for the sky-alert (aircraft) compact and minimal Dynamic Island views and the Watch card.
// Continuous arc: route progress when the route is known, otherwise closeness (1 - distance / 2 mi, the alert radius).
import SwiftUI

struct SkyRing<Inner: View>: View {
    let s: SkyState
    let size: CGFloat
    let stroke: CGFloat
    let inner: Inner
    init(s: SkyState, size: CGFloat, stroke: CGFloat, @ViewBuilder inner: () -> Inner) {
        self.s = s
        self.size = size
        self.stroke = stroke
        self.inner = inner()
    }
    var fraction: Double {
        if let r = s.route, r.progress > 0 { return min(1, max(0.04, r.progress)) }
        return min(1, max(0.04, 1 - s.distMi / 2.0))
    }
    var body: some View {
        let tint = SkyKind(s.kind).tint
        ZStack {
            Circle().stroke(Color.white.opacity(0.26), style: StrokeStyle(lineWidth: stroke))
            Circle().trim(from: 0, to: CGFloat(fraction))
                .stroke(tint, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                .rotationEffect(.degrees(-90))
            inner
        }
        .padding(stroke / 2)
        .frame(width: size, height: size)
    }
}
