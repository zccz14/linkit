import SwiftUI

struct MeView: View {
    @Environment(AppModel.self) private var app

    @State private var showEditor = false
    @State private var showSignOutConfirm = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            List {
                if let profile = app.store.me?.profile {
                    profileSection(profile)
                    themeSection(profile)
                    languageSection(profile)
                } else {
                    Section {
                        ProgressView()
                    }
                }
                Section(app.locale.t("me.instance")) {
                    detailRow(app.locale.t("me.server"), app.auth.instanceURL.host ?? app.auth.instanceURL.absoluteString)
                }
                Section {
                    Button(app.locale.t("me.signOut"), role: .destructive) {
                        showSignOutConfirm = true
                    }
                }
                Section(app.locale.t("me.about")) {
                    detailRow(app.locale.t("me.version"), Self.appVersion)
                }
                if let errorText {
                    Section {
                        Text(errorText).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle(app.locale.t("tab.me"))
            .sheet(isPresented: $showEditor) {
                ProfileEditorView()
            }
            .confirmationDialog(app.locale.t("me.signOutConfirm"), isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button(app.locale.t("me.signOut"), role: .destructive) {
                    Task { await app.signOut() }
                }
                Button(app.locale.t("common.cancel"), role: .cancel) {}
            }
        }
    }

    private func profileSection(_ profile: APIProfile) -> some View {
        Section {
            HStack(spacing: 14) {
                SenderAvatar(userID: profile.userID, name: profile.username, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(profile.username).font(.headline)
                    if !profile.intro.isEmpty {
                        Text(profile.intro)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            }
            Button(app.locale.t("me.editProfile")) {
                showEditor = true
            }
        }
    }

    private func themeSection(_ profile: APIProfile) -> some View {
        Section(app.locale.t("me.appearance")) {
            Picker(app.locale.t("me.theme"), selection: themeBinding(profile)) {
                Text(app.locale.t("me.theme.system")).tag("system")
                Text(app.locale.t("me.theme.light")).tag("light")
                Text(app.locale.t("me.theme.dark")).tag("dark")
            }
            .pickerStyle(.segmented)
        }
    }

    private func languageSection(_ profile: APIProfile) -> some View {
        Section(app.locale.t("me.language")) {
            Picker(app.locale.t("me.language"), selection: languageBinding(profile)) {
                Text("English").tag("en")
                Text("中文").tag("zh-Hans")
            }
        }
    }

    private func themeBinding(_ profile: APIProfile) -> Binding<String> {
        Binding(
            get: { app.store.me?.profile?.theme ?? profile.theme },
            set: { value in
                Task { await save(theme: value, language: nil) }
            }
        )
    }

    private func languageBinding(_ profile: APIProfile) -> Binding<String> {
        Binding(
            get: { app.locale.language },
            set: { value in
                app.locale.setLanguage(value)
                Task { await save(theme: nil, language: value == "zh-Hans" ? "zh-CN" : "en-US") }
            }
        )
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .foregroundStyle(.secondary)
        }
    }

    private func save(theme: String?, language: String?) async {
        guard let profile = app.store.me?.profile else { return }
        do {
            try await app.saveProfile(
                username: profile.username,
                intro: profile.intro,
                language: language,
                theme: theme,
                avatarAttachmentID: profile.avatarAttachmentID
            )
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private static var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "\(version) (\(build))"
    }
}
