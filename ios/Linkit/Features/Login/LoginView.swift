import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var app

    @State private var loginURL: URL?
    @State private var showAuthSheet = false
    @State private var showInstanceAlert = false
    @State private var instanceField = ""
    @State private var loginError: String?
    @State private var isStarting = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 14) {
                LinkitMarkView()
                    .frame(width: 72, height: 72)
                Text("Linkit")
                    .font(.largeTitle.weight(.semibold))
                Text(app.locale.t("login.tagline"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                Button {
                    Task { await startLogin() }
                } label: {
                    HStack(spacing: 8) {
                        if isStarting { ProgressView().tint(.white) }
                        Text(app.locale.t("login.signIn")).bold()
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isStarting)

                if let error = loginError ?? app.auth.lastError {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Button(app.locale.t("login.instance", app.auth.instanceURL.host ?? app.auth.instanceURL.absoluteString)) {
                    instanceField = app.auth.instanceURL.absoluteString
                    showInstanceAlert = true
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 44)
        }
        .sheet(isPresented: $showAuthSheet, onDismiss: { app.auth.cancelLogin() }) {
            authSheet
        }
        .alert(app.locale.t("login.instanceTitle"), isPresented: $showInstanceAlert) {
            TextField(app.locale.t("login.instancePlaceholder"), text: $instanceField)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .autocorrectionDisabled()
            Button(app.locale.t("common.cancel"), role: .cancel) {}
            Button(app.locale.t("common.save")) {
                Task { await switchInstance() }
            }
        } message: {
            Text(app.locale.t("login.instanceHint"))
        }
        .onChange(of: app.auth.phase) { _, phase in
            if phase == .signedIn { showAuthSheet = false }
        }
    }

    private var authSheet: some View {
        NavigationStack {
            Group {
                if let loginURL {
                    AuthWebView(url: loginURL, instanceHost: loginOriginHost) { callbackURL in
                        Task { await completeLogin(callbackURL) }
                    }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(app.locale.t("login.signIn"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(app.locale.t("common.cancel")) { showAuthSheet = false }
                }
            }
        }
    }

    private var loginOriginHost: String {
        let origin = app.auth.config?.publicOrigin.flatMap(URL.init(string:)) ?? app.auth.instanceURL
        return origin.host ?? ""
    }

    private func startLogin() async {
        isStarting = true
        defer { isStarting = false }
        loginError = nil
        do {
            loginURL = try await app.auth.beginLogin()
            showAuthSheet = true
        } catch {
            loginError = error.localizedDescription
        }
    }

    private func completeLogin(_ callbackURL: URL) async {
        do {
            try await app.auth.completeLogin(callbackURL: callbackURL)
        } catch {
            loginError = error.localizedDescription
            showAuthSheet = false
        }
    }

    private func switchInstance() async {
        var value = instanceField.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.contains("://") { value = "https://" + value }
        guard let url = URL(string: value), url.host != nil else {
            loginError = app.locale.t("login.invalidInstance")
            return
        }
        await app.auth.switchInstance(url)
    }
}
