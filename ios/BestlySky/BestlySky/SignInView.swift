// Bestly Admin: shown when there is no session. Passkey first; "Approve from another device" as the fallback.
import SwiftUI

struct SignInView: View {
    @ObservedObject private var auth = AdminAuth.shared

    var body: some View {
        ZStack {
            AT.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 40)
                ScoutMark(size: 88)
                Text("Bestly Admin")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(AT.text)
                    .padding(.top, 20)
                Text("Sign in to see what needs you.")
                    .font(.system(size: 17))
                    .foregroundStyle(AT.secondary)
                    .padding(.top, 6)
                Spacer(minLength: 24)

                if let d = auth.device {
                    deviceCard(d)
                } else {
                    VStack(spacing: 12) {
                        Button { Task { await auth.signInWithPasskey() } } label: {
                            HStack(spacing: 10) {
                                if auth.busy { ProgressView().tint(Color.black) } else { Image(systemName: "person.badge.key.fill") }
                                Text("Sign in with passkey").font(.system(size: 17, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(AT.lime, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .foregroundStyle(Color.black)
                        }
                        .disabled(auth.busy)

                        Button { Task { await auth.startDeviceLogin() } } label: {
                            Text("Approve from another device")
                                .font(.system(size: 17))
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .foregroundStyle(AT.text)
                        }
                        .disabled(auth.busy)
                    }
                }

                if let e = auth.error {
                    Text(e)
                        .font(.system(size: 14))
                        .foregroundStyle(AT.orange)
                        .multilineTextAlignment(.center)
                        .padding(.top, 14)
                }
                Spacer(minLength: 30)
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
    }

    private func deviceCard(_ d: AdminDeviceRequest) -> some View {
        VStack(spacing: 14) {
            Text("On a device that is already signed in, open the Bestly admin, go to Approve, and enter:")
                .font(.system(size: 15))
                .foregroundStyle(AT.secondary)
                .multilineTextAlignment(.center)
            Text(d.code)
                .font(.system(size: 40, weight: .bold, design: .monospaced))
                .foregroundStyle(AT.text)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            VStack(spacing: 2) {
                Text("Match number").font(.system(size: 13)).foregroundStyle(AT.secondary)
                Text("\(d.match)")
                    .font(.system(size: 56, weight: .bold))
                    .foregroundStyle(AT.lavender)
                    .monospacedDigit()
            }
            HStack(spacing: 8) {
                ProgressView().tint(AT.secondary)
                Text("Waiting for approval").font(.system(size: 15)).foregroundStyle(AT.secondary)
            }
            Button { auth.cancelDeviceLogin() } label: {
                Text("Cancel")
                    .font(.system(size: 17))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(AT.inner, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .foregroundStyle(AT.text)
            }
        }
        .padding(18)
        .background(AT.card, in: RoundedRectangle(cornerRadius: AT.radius, style: .continuous))
    }
}
