import UIKit
import SwiftUI
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)

        // Корень — таб-бар: вкладка 1 сайт (как раньше), вкладка 2 нативная
        // «Загрузки» (см. план офлайн-загрузок) — работает без сети и без
        // WebView. MainViewController (не голый CAPBridgeViewController) —
        // см. MainViewController.swift: только через него локальные
        // Swift-плагины (OfflineDownloadPlugin, ExternalDisplayPlugin)
        // вообще регистрируются в мосте, иначе любой их вызов падает с
        // "not implemented on ios".
        let siteVC = MainViewController()
        siteVC.tabBarItem = UITabBarItem(
            title: "MediaWatch",
            image: UIImage(systemName: "play.rectangle"),
            selectedImage: UIImage(systemName: "play.rectangle.fill")
        )

        let downloadsVC = UIHostingController(rootView: DownloadsView())
        downloadsVC.tabBarItem = UITabBarItem(
            title: "Загрузки",
            image: UIImage(systemName: "arrow.down.circle"),
            selectedImage: UIImage(systemName: "arrow.down.circle.fill")
        )

        let tabBarController = UITabBarController()
        tabBarController.viewControllers = [siteVC, downloadsVC]

        window?.rootViewController = tabBarController
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
