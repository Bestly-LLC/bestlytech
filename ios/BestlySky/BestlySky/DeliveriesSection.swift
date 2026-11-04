// Bestly Admin: Today > DELIVERIES. A card per open order (ring + store icon, service, status line, labeled bar) from delivery_today(),
// plus a button for Uber Eats, which sends no email until the next day. Same fields as the Live Activity (delivery_card_fields).
import SwiftUI

struct DeliveryCard: Identifiable, Equatable {
    var id: Int
    var service: String
    var source: String
    var stage: Int
    var stageCount: Int
    var statusLine: String
    var icon: String
    var color: String
    var colorLight: String
    var labels: [String]

    init?(_ j: JSON) {
        guard let id = j.int("order_id"), let service = j.str("service") else { return nil }
        self.id = id
        self.service = service
        source = j.str("source") ?? ""
        stage = j.int("stage") ?? 1
        stageCount = 3
        statusLine = j.str("statusLine") ?? ""
        icon = j.str("icon") ?? "bag"
        color = j.str("color") ?? "#06C167"
        colorLight = j.str("colorLight") ?? "#00843D"
        labels = (j["labels"] as? [String]) ?? ["Ordered", "On the way", "Delivered"]
    }
}

extension TodayModel {
    func loadDeliveries() async {
        do {
            guard let r = try await AdminAPI.rpc("delivery_today") as? JSON, r.bool("ok") == true else { throw AdminAPIError(status: 0, message: "unexpected shape") }
            deliveries = r.arr("rows").compactMap { DeliveryCard($0) }
            deliveriesFailed = false
        } catch {
            if (error as? URLError)?.code != .cancelled { deliveriesFailed = true }
        }
    }

    /// "I ordered Uber Eats": records the order, then re-reads Deliveries to confirm the row exists.
    func uberEatsOrdered() async {
        await Action.run("today.ubereats_ordered", okSay: "Uber Eats is on the way to being tracked",
                         attempt: { try await AdminAPI.rpc("delivery_ubereats_ordered") },
                         verify: { [weak self] in
                             guard let self else { return false }
                             await self.loadDeliveries()
                             return self.deliveries.contains { $0.source == "ubereats" }
                         })
    }
}

struct DeliveriesSection: View {
    @ObservedObject var model: TodayModel
    @Environment(\.colorScheme) private var scheme
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DELIVERIES").font(.system(size: 13, weight: .semibold)).tracking(0.3).foregroundStyle(AT.secondary).padding(.leading, 4)
            ForEach(model.deliveries) { d in card(d) }
            if model.deliveries.isEmpty && model.deliveriesFailed {
                Text("Couldn't load deliveries. Retrying.").font(.system(size: 15)).foregroundStyle(AT.secondary)
                    .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
            }
            orderCard
        }
    }

    private func state(_ d: DeliveryCard) -> StageState {
        StageState(stage: d.stage, stageCount: d.stageCount, progress: 0, stageColor: scheme == .dark ? d.color : d.colorLight,
                   icon: d.icon, statusLine: d.statusLine, stageLabels: d.labels)
    }

    private func card(_ d: DeliveryCard) -> some View {
        let s = state(d)
        return ATCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 14) {
                    StageRing(s: s, size: 44, stroke: 4.2, glyph: 22, glow: true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.service).font(.system(size: 17, weight: .semibold)).foregroundStyle(AT.text).lineLimit(1).minimumScaleFactor(0.7)
                        Text(glue(d.statusLine)).font(.system(size: 15)).foregroundStyle(AT.secondary).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    Spacer(minLength: 0)
                }
                StageBar(s: s)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var orderCard: some View {
        let fill = scheme == .dark ? Color(.sRGB, red: 6.0 / 255, green: 193.0 / 255, blue: 103.0 / 255, opacity: 0.16)
                                   : Color(.sRGB, red: 0, green: 132.0 / 255, blue: 61.0 / 255, opacity: 0.10)
        let ink = scheme == .dark ? AT.hex(0x06C167) : AT.hex(0x00843D)
        return ATCard {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    guard !busy else { return }
                    busy = true
                    Task { await model.uberEatsOrdered(); busy = false }
                } label: {
                    HStack(spacing: 8) {
                        MDI(name: "mdi-shopping", color: ink, size: 22)
                        Text("I ordered Uber Eats").font(.system(size: 17, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(fill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(NYPressStyle())
                .disabled(busy)
                Text("Or say \"Hey Siri, Uber Eats ordered.\"").font(.system(size: 13)).foregroundStyle(AT.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
