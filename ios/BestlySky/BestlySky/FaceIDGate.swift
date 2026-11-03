// Bestly Admin: Face ID (or passcode) check before anything that touches the car or a secret.
// Integrator: Info.plist needs NSFaceIDUsageDescription.
import Foundation
import LocalAuthentication

enum FaceIDGate {
    /// True when the owner passed Face ID / Touch ID / passcode. False on cancel, failure, or a phone with no lock set.
    static func confirm(reason: String) async -> Bool {
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { return false }
        do {
            return try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        } catch {
            return false
        }
    }
}
