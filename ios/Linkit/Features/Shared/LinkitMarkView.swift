import SwiftUI

/// The Linkit square mark ("□"), matching `web/src/components/linkit-mark.tsx`.
struct LinkitMarkView: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let inset = side * 13.5 / 64
            let stroke = side * 9 / 64
            RoundedRectangle(cornerRadius: stroke / 2)
                .strokeBorder(.primary, lineWidth: stroke)
                .padding(inset)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
