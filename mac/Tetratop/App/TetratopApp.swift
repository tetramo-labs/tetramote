import SwiftUI

@main
struct TetratopApp: App {
  @StateObject private var controller = HostController()

  var body: some Scene {
    MenuBarExtra {
      MenuView()
        .environmentObject(controller)
        .fontDesign(.rounded)
    } label: {
      Image(systemName: controller.isConnected ? "macbook.and.iphone" : "macbook")
    }
    .menuBarExtraStyle(.window)
  }
}
