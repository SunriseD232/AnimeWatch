import UIKit
import AVFoundation

/// View, чей CALayer — это сам AVPlayerLayer (не обычный CALayer с
/// добавленным в него sublayer'ом) — так playerLayer.frame сам
/// синхронизируется с размерами view через обычные Auto Layout/bounds, без
/// ручного кода в viewDidLayoutSubviews.
final class PlayerContainerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer } // swiftlint:disable:this force_cast
}

final class ExternalPlayerViewController: UIViewController {
    let playerContainerView = PlayerContainerView()

    override func loadView() {
        playerContainerView.playerLayer.videoGravity = .resizeAspect
        playerContainerView.backgroundColor = .black
        view = playerContainerView
    }
}

/// Отдельная UIScene для внешнего экрана (очки Xreal) — Capacitor 8
/// генерирует scene-based проект (см. SceneDelegate.swift — основной экран
/// телефона уже живёт в отдельной сцене), поэтому внешний дисплей тоже
/// подключается как своя UIScene с ролью «external display», а не через
/// устаревший (для scene-based приложений) UIScreen.didConnectNotification.
/// Какую именно сцену создать для какой роли — решает
/// AppDelegate.application(configurationForConnecting:), см. этот файл.
class ExternalDisplaySceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let vc = ExternalPlayerViewController()
        let win = UIWindow(windowScene: windowScene)
        win.rootViewController = vc
        window = win
        win.makeKeyAndVisible()

        ExternalDisplayManager.shared.attachExternalLayer(vc.playerContainerView.playerLayer)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        ExternalDisplayManager.shared.detachExternalLayer()
        window = nil
    }
}
