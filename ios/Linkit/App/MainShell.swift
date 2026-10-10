import SwiftUI

struct MainShell: View {
    @Environment(AppModel.self) private var app
    @State private var selection = 0

    var body: some View {
        TabView(selection: $selection) {
            ConversationListView()
                .tabItem { Label(app.locale.t("tab.chats"), systemImage: "bubble.left.and.bubble.right") }
                .badge(app.store.unreadTotal)
                .tag(0)
            DirectoryView()
                .tabItem { Label(app.locale.t("tab.directory"), systemImage: "person.2") }
                .tag(1)
            MeView()
                .tabItem { Label(app.locale.t("tab.me"), systemImage: "person.crop.circle") }
                .tag(2)
        }
    }
}
