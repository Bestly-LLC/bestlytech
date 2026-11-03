// Bestly Admin: add or replace the monthly LAX garage code. The code is a secret: secure field, never logged, Face ID to save.
import SwiftUI

struct TuroCodeSheet: View {
    @ObservedObject var m: TuroModel
    @Environment(\.dismiss) private var dismiss
    @State private var payload = ""
    @State private var note = ""
    @State private var monthPick = 0
    @State private var saving = false
    @State private var error: String?

    private var month: String { monthPick == 0 ? m.laxMonthStart : m.laxNextMonthStart }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    TSub("Paste the code from the garage. Guests see it on their trip page and in Wallet right after you save.", color: Color(white: 0.79))
                    ATCard(fill: AT.inner) {
                        VStack(alignment: .leading, spacing: 8) {
                            TLabel("Which month")
                            TSegments(options: [TuroModel.monthName(m.laxMonthStart), TuroModel.monthName(m.laxNextMonthStart)], selection: $monthPick)
                            TLabel("Code").padding(.top, 6)
                            SecureField("Paste the code", text: $payload)
                                .textContentType(.password)
                                .autocorrectionDisabled().textInputAutocapitalization(.never)
                                .font(.system(size: 16)).foregroundStyle(AT.text)
                                .padding(.horizontal, 12).frame(minHeight: 48)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .accessibilityLabel("Garage code")
                            TLabel("Note (optional)").padding(.top, 6)
                            TextField("Anything worth remembering", text: $note)
                                .font(.system(size: 16)).foregroundStyle(AT.text)
                                .padding(.horizontal, 12).frame(minHeight: 48)
                                .background(AT.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                    if let error { TSub(error, color: AT.red) }
                    Button {
                        Task {
                            saving = true; error = nil
                            let e = await m.saveCode(payload: payload.trimmingCharacters(in: .whitespacesAndNewlines), month: month, note: note)
                            saving = false
                            if let e { error = e } else { payload = ""; dismiss() }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if saving { ProgressView().tint(AT.bg) }
                            Text(saving ? "Saving" : "Save \(TuroModel.monthName(month)) code with Face ID")
                        }
                    }
                    .buttonStyle(.tlime)
                    .disabled(saving || payload.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(16)
            }
            .background(AT.bg.ignoresSafeArea())
            .navigationTitle("Update LAX code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { payload = ""; dismiss() }.frame(minHeight: 44) } }
        }
        .presentationDetents([.large])
    }
}
