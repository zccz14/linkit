import SwiftUI

/// A user avatar resolved through the public profile of the user.
struct SenderAvatar: View {
    let userID: String
    let name: String
    var size: CGFloat = 40

    @Environment(AppModel.self) private var app

    var body: some View {
        let profile = app.store.profile(userID)
        RemoteAvatar(
            url: profile?.avatarURL.flatMap(URL.init(string:)),
            name: profile?.username ?? name,
            size: size
        )
        .task(id: userID) {
            await app.store.ensureProfiles([userID])
        }
    }
}
