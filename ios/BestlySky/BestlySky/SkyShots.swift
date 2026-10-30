// Debug screenshot harness. Launch the app with `-skyShots -skyShotsDir <folder>`: renders the sky-alert card
// for all three kinds plus the Dynamic Island pieces to PNGs with ImageRenderer, writes card heights, then quits.
#if DEBUG
import SwiftUI

struct SkyShotsView: View {
    private static let cardBg = Color(red: 30.0 / 255, green: 30.0 / 255, blue: 34.0 / 255).opacity(0.74)

    var body: some View {
        Color.black.ignoresSafeArea().task { await run() }
    }

    @MainActor private func run() async {
        let args = CommandLine.arguments
        let dir = args.firstIndex(of: "-skyShotsDir").flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil } ?? NSTemporaryDirectory()
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        var report = ""
        for kind in ["news", "police", "plane"] {
            let s = SkyState.demo(kind)
            save(lock(s), "lock-\(kind).png", dir)
            let m = ImageRenderer(content: SkyAlertCard(s: s).frame(width: 362))
            m.scale = 1
            report += "card height \(kind): \(m.uiImage.map { String(format: "%.1f", $0.size.height) } ?? "?") pt\n"
        }
        save(compact(), "island-compact.png", dir)
        save(expanded(SkyState.demo("news")), "island-expanded-news.png", dir)
        save(expanded(SkyState.demo("plane")), "island-expanded-plane.png", dir)
        // robustness: an old-format payload and a very long line must still render without a crash or an ellipsis
        var long = SkyState.demo("news")
        long.line1 = "Seven helicopters circling downtown"
        long.line3 = "Since 11:32 PM · 1,200 ft up · very windy"
        save(lock(long), "lock-news-long.png", dir)
        let old = try? JSONDecoder().decode(SkyState.self, from: Data(#"{"hex":"a1b2c3","flight":"AAL2401"}"#.utf8))
        report += "old payload decodes: \(old != nil)\n"
        try? report.write(toFile: dir + "/heights.txt", atomically: true, encoding: .utf8)
        NSLog("SkyShots: done\n%@", report)
        try? await Task.sleep(for: .seconds(1))
        exit(0)
    }

    @MainActor private func save<V: View>(_ v: V, _ name: String, _ dir: String) {
        let r = ImageRenderer(content: v)
        r.scale = 2
        if let data = r.uiImage?.pngData() { try? data.write(to: URL(fileURLWithPath: dir).appendingPathComponent(name)) }
    }

    private var wallpaper: some View {
        LinearGradient(colors: [Color(red: 0.12, green: 0.16, blue: 0.27), Color(red: 0.03, green: 0.04, blue: 0.06)], startPoint: .top, endPoint: .bottom)
    }

    private func lock(_ s: SkyState) -> some View {
        SkyAlertCard(s: s)
            .background(Self.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .padding(.horizontal, 14)
            .padding(.vertical, 24)
            .frame(width: 390)
            .background(wallpaper)
    }

    private func compact() -> some View {
        VStack(spacing: 14) {
            ForEach(["news", "police", "plane"], id: \.self) { k in
                let s = SkyState.demo(k)
                HStack(spacing: 0) {
                    SkyCompactLeading(s: s)
                    Spacer(minLength: 0)
                    SkyCompactTrailing(s: s)
                }
                .padding(.leading, 10).padding(.trailing, 14)
                .frame(width: 252, height: 37)
                .background(Capsule().fill(Color.black))
            }
            HStack(spacing: 14) {
                Capsule().fill(Color.black).frame(width: 126, height: 37)
                SkyMinimal(s: SkyState.demo("news")).frame(width: 37, height: 37).background(Circle().fill(Color.black))
            }
        }
        .padding(24)
        .frame(width: 390)
        .background(Color(white: 0.1))
    }

    private func expanded(_ s: SkyState) -> some View {
        SkyExpandedBody(s: s)
            .padding(.horizontal, 20).padding(.vertical, 18)
            .background(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: 46, style: .continuous))
            .padding(24)
            .frame(width: 390)
            .background(Color(white: 0.1))
    }
}
#endif
