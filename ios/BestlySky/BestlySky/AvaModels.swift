// Bestly Admin: Ava's caller messages. Contract with the ava-inbox edge function (x-sky-key auth, same as wall-live-activity).
import Foundation

struct AvaItem: Codable, Identifiable, Hashable {
    var id: String
    var idNumber: Int?                 // the id as the server sent it, when it is a number (posted back the same way)
    var callNo: Int
    var name: String
    var phoneDisplay: String
    var message: String
    var callbackNumberDisplay: String?
    var callNumberToDial: String       // E.164, used for tel:
    var createdAt: String
    var timeDisplay: String            // 12-hour, already formatted by the server
    var forwarded: Bool
    var read: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, message, forwarded, read
        case callNo = "call_no", phoneDisplay = "phone_display", callbackNumberDisplay = "callback_number_display"
        case callNumberToDial = "call_number_to_dial", createdAt = "created_at", timeDisplay = "time_display"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let s = try? c.decode(String.self, forKey: .id) { id = s; idNumber = nil }
        else if let n = try? c.decode(Int.self, forKey: .id) { id = String(n); idNumber = n }
        else { id = UUID().uuidString; idNumber = nil }
        callNo = (try? c.decode(Int.self, forKey: .callNo)) ?? Int((try? c.decode(String.self, forKey: .callNo)) ?? "") ?? 0
        name = c.skyValue(.name, "Unknown caller")
        phoneDisplay = c.skyValue(.phoneDisplay, "")
        message = c.skyValue(.message, "")
        callbackNumberDisplay = try? c.decodeIfPresent(String.self, forKey: .callbackNumberDisplay)
        callNumberToDial = c.skyValue(.callNumberToDial, "")
        createdAt = c.skyValue(.createdAt, "")
        timeDisplay = c.skyValue(.timeDisplay, "")
        forwarded = c.skyValue(.forwarded, false)
        read = c.skyValue(.read, false)
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(callNo, forKey: .callNo); try c.encode(name, forKey: .name)
        try c.encode(phoneDisplay, forKey: .phoneDisplay); try c.encode(message, forKey: .message)
        try c.encodeIfPresent(callbackNumberDisplay, forKey: .callbackNumberDisplay)
        try c.encode(callNumberToDial, forKey: .callNumberToDial); try c.encode(createdAt, forKey: .createdAt)
        try c.encode(timeDisplay, forKey: .timeDisplay); try c.encode(forwarded, forKey: .forwarded); try c.encode(read, forKey: .read)
    }
    var wireId: Any { idNumber ?? id }
}

enum AvaDeepLink {
    /// bestlyadmin://ava/163 -> 163
    static func callNo(_ url: URL) -> Int? {
        guard url.scheme == "bestlyadmin", url.host == "ava" else { return nil }
        return Int(url.lastPathComponent)
    }
}
