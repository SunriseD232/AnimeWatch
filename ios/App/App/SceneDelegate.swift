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

        // Сайт всегда тёмный (своей светлой темы у него нет, см.
        // tailwind.config.ts — palette только тёмная), а нативные вкладки
        // без явного оверрайда следуют СИСТЕМНОЙ теме телефона — на
        // светлой системной теме таб-бар и вкладка «Загрузки» рендерились
        // светлыми на контрасте с постоянно тёмным сайтом. Форсируем тёмный
        // интерфейс на уровне окна — заодно красим сам таб-бар в цвета
        // сайта (чёрный фон, синий акцент #2997ff), а не в системный серый.
        window?.overrideUserInterfaceStyle = .dark

        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithOpaqueBackground()
        tabBarAppearance.backgroundColor = .black
        tabBarController.tabBar.standardAppearance = tabBarAppearance
        tabBarController.tabBar.scrollEdgeAppearance = tabBarAppearance
        tabBarController.tabBar.tintColor = UIColor(red: 0x29 / 255, green: 0x97 / 255, blue: 0xff / 255, alpha: 1)
        tabBarController.tabBar.unselectedItemTintColor = UIColor(white: 1, alpha: 0.5)

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
