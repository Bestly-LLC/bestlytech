// Bestly Admin: call recording player. The recording comes from an edge function (the voice provider key stays on the server),
// is downloaded once, and plays from memory with a play/pause button and a scrubber.
import SwiftUI
import AVFoundation

@MainActor
final class CallAudioModel: ObservableObject {
    enum State { case idle, loading, ready, missing }
    @Published var state: State = .idle
    @Published var playing = false
    @Published var time: Double = 0
    @Published var duration: Double = 0

    private var player: AVAudioPlayer?
    private var ticker: Task<Void, Never>?

    func toggle(fn: String, callId: String) async {
        if player == nil {
            state = .loading
            do {
                let data = try await TKit.postBytes(fn, ["action": "audio", "call_id": callId])
                try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try? AVAudioSession.sharedInstance().setActive(true)
                let p = try AVAudioPlayer(data: data)
                p.prepareToPlay()
                player = p; duration = p.duration; state = .ready
            } catch {
                state = .missing; Haptics.fail(); return
            }
        }
        guard let p = player else { return }
        if p.isPlaying { p.pause(); playing = false; ticker?.cancel() }
        else {
            if p.currentTime >= p.duration - 0.05 { p.currentTime = 0 }
            p.play(); playing = true; startTicker()
        }
    }

    func seek(_ t: Double) {
        player?.currentTime = max(0, min(t, duration))
        time = player?.currentTime ?? t
    }

    func stop() {
        ticker?.cancel()
        player?.stop()
        playing = false
    }

    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard let self, let p = self.player else { return }
                self.time = p.currentTime
                if !p.isPlaying { self.playing = false; if p.currentTime >= p.duration - 0.3 { self.time = 0; p.currentTime = 0 }; return }
            }
        }
    }
}

struct CallAudioCard: View {
    var fn: String
    var callId: String
    var knownLength: Int?
    var tint: Color
    @StateObject private var a = CallAudioModel()
    @State private var scrubbing = false
    @State private var scrubValue: Double = 0

    var body: some View {
        ATCard {
            HStack(spacing: 12) {
                Button { Task { await a.toggle(fn: fn, callId: callId) } } label: {
                    ZStack {
                        Circle().fill(tint)
                        if a.state == .loading { ProgressView().tint(AT.bg) }
                        else { Image(systemName: a.playing ? "pause.fill" : "play.fill").font(.system(size: 18)).foregroundStyle(AT.bg) }
                    }
                    .frame(width: 48, height: 48)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(a.playing ? "Pause recording" : "Play recording")
                VStack(alignment: .leading, spacing: 4) {
                    if a.state == .missing {
                        TSub("The recording isn't ready yet. Try again in a minute.", color: AT.orange)
                    } else {
                        Slider(value: Binding(get: { scrubbing ? scrubValue : a.time }, set: { scrubValue = $0 }), in: 0...max(a.duration, 1)) { editing in
                            scrubbing = editing
                            if !editing { a.seek(scrubValue) } else { scrubValue = a.time }
                        }
                        .tint(tint)
                        .disabled(a.state != .ready)
                        .accessibilityLabel("Playback position")
                        .accessibilityValue("\(TKit.mmss(a.time)) of \(TKit.mmss(shownLength))")
                        HStack {
                            Text(TKit.mmss(scrubbing ? scrubValue : a.time)).font(.system(size: 13).monospacedDigit()).foregroundStyle(AT.secondary)
                            Spacer()
                            Text(TKit.mmss(shownLength)).font(.system(size: 13).monospacedDigit()).foregroundStyle(AT.secondary)
                        }
                    }
                }
            }
        }
        .onDisappear { a.stop() }
    }

    private var shownLength: Double { a.duration > 0 ? a.duration : Double(knownLength ?? 0) }
}
