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

// Раньше в этом файле был ExternalDisplaySceneDelegate: UIWindowSceneDelegate
// (подключение внешнего экрана через отдельную UIScene) — убрали, реального
// вывода на экран не было (пробовали на устройстве — очки оставались
// чёрными/пустыми). Внешний экран теперь подключается классическим способом
// через UIScreen.didConnectNotification + ручной UIWindow, см.
// ExternalDisplayManager.swift. Имя файла оставили как есть, чтобы не
// трогать project.pbxproj (там уже зарегистрирован путь до этого файла).
