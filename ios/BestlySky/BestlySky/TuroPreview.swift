// Debug gallery of the Turo RETURN card states. Launch the app with `-turoPreview` (used for Simulator screenshots).
import SwiftUI

struct TuroPreviewGallery: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                ForEach(Array(cases.enumerated()), id: \.offset) { _, c in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(c.0).font(.caption2).foregroundStyle(.gray)
                        TuroLockScreen(s: c.1)
                            .background(RoundedRectangle(cornerRadius: 22).fill(Color(white: 0.12)))
                        HStack(spacing: 14) {
                            TuroRing(s: c.1, size: 24, stroke: 3, glyph: 13)
                            TrailValue(s: c.1, big: false)
                            TuroRing(s: c.1, size: 44, stroke: 4, glyph: 22)
                        }
                        .padding(8).background(Capsule().fill(.black))
                    }
                }
            }
            .padding(16)
        }
        .background(Color.black.ignoresSafeArea())
    }

    private var cases: [(String, TuroState)] {
        [("Out", .demo(stage: 0)), ("Heading home", .demo(stage: 1)), ("Back low", .demo(stage: 2, low: true)),
         ("Done", .demo(stage: 3)), ("Issue", .demo(stage: 3, issue: true)), ("Long name", .demo(stage: 2, long: true))]
    }
}
