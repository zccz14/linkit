import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.auth.phase {
            case .starting:
                ProgressView()
                    .controlSize(.large)
            case .signedOut, .signingIn:
                LoginView()
            case .signedIn:
                MainShell()
            }
        }
        .preferredColorScheme(colorScheme)
        .task { await app.startIfNeeded() }
        .onChange(of: app.auth.phase) { _, phase in
            Task {
                switch phase {
                case .signedIn:
                    await app.signedIn()
                case .signedOut:
                    app.signedOutCleanup()
                default:
                    break
                }
            }
        }
    }

    private var colorScheme: ColorScheme? {
        switch app.store.me?.profile?.theme {
        case "dark": return .dark
        case "light": return .light
        default: return nil
        }
    }
}
