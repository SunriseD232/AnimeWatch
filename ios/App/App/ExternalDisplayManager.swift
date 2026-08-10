import Foundation
import AVFoundation
import UIKit

/// Управляет AVPlayer, который рендерится на внешний экран (очки Xreal,
/// подключены по USB-C DisplayPort) — единая точка входа что для
/// подключения/отключения экрана (см. UIScreen.didConnectNotification
/// ниже), что для ExternalDisplayPlugin (получает команды play/stop из JS,
/// см. src/native/externalDisplay.ts).
///
/// Почему нельзя просто зеркалить WKWebView на внешний экран: WKWebView
/// останавливает рендеринг, когда приложение уходит в фон/экран
/// блокируется — это ограничение самого WebKit, не обходится настройками.
/// Нативный AVPlayer с фоновым аудио-режимом (UIBackgroundModes=audio в
/// Info.plist) продолжает декодировать звук и при блокировке — но само
/// изображение на очках переживает блокировку не через это, а через
/// AVPlayer.usesExternalPlaybackWhileExternalScreenIsActive (см. play()
/// ниже) — оно передаёт рендер внешнему, системному конвейеру (тому же,
/// что у AirPlay) вместо отрисовки силами самого приложения, которую ОС
/// приостанавливает при реальной блокировке телефона.
///
/// Почему UIScreen.didConnectNotification + ручной UIWindow, а не UIScene с
/// ролью "external display": первая версия пробовала подключать внешний
/// экран как отдельную UIScene (AppDelegate.configurationForConnecting) —
/// на реальном устройстве экран очков оставался пустым/чёрным, хотя другие
/// приложения выводили на него картинку нормально. Похоже, iOS не создаёт
/// такую UIScene для USB-C DisplayPort-вывода в обычном приложении (это,
/// видимо, реально существует только для CarPlay/специальных случаев).
/// UIScreen.didConnectNotification — старый (до-scene) API, но он никогда
/// не был deprecated и работает независимо от scene-based UI основного
/// экрана: можно смело держать основной WKWebView в SceneDelegate, а
/// внешний экран — отдельным UIWindow(screen:) в обход сцен вообще.
final class ExternalDisplayManager: NSObject {
    static let shared = ExternalDisplayManager()

    private(set) var isExternalScreenConnected = false

    /// Колбэк на подключение/отключение внешнего экрана — подписывается
    /// ExternalDisplayPlugin, чтобы прокинуть событие в JS.
    var onConnectionChange: ((Bool) -> Void)?
    /// Периодический колбэк с текущей позицией — тоже уходит в JS, чтобы
    /// существующий конвейер сохранения прогресса на веб-стороне
    /// (useProgressSaver) получал актуальную позицию, пока играем на очках.
    var onTimeUpdate: ((Double) -> Void)?

    private var externalWindow: UIWindow?
    private var playerViewController: ExternalPlayerViewController?
    private var player: AVPlayer?
    private var timeObserverToken: Any?

    private override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleScreenConnect),
            name: UIScreen.didConnectNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleScreenDisconnect),
            name: UIScreen.didDisconnectNotification, object: nil
        )
        // Очки могли быть подключены ДО запуска/на момент создания синглтона
        // (например, приложение восстановилось из фона) — UIScreen.screens
        // уже содержит их в этом случае, didConnectNotification не придёт.
        if let external = UIScreen.screens.first(where: { $0 !== UIScreen.main }) {
            attachWindow(to: external)
        }
    }

    // MARK: - Подключение/отключение экрана

    @objc private func handleScreenConnect(_ note: Notification) {
        guard let screen = note.object as? UIScreen else { return }
        attachWindow(to: screen)
    }

    @objc private func handleScreenDisconnect(_ note: Notification) {
        detachWindow()
    }

    private func attachWindow(to screen: UIScreen) {
        let vc = ExternalPlayerViewController()
        let window = UIWindow(frame: screen.bounds)
        window.screen = screen
        window.rootViewController = vc
        window.isHidden = false

        externalWindow = window
        playerViewController = vc
        isExternalScreenConnected = true
        onConnectionChange?(true)

        // Если play() уже вызывался до подключения экрана (маловероятно, но
        // на всякий случай) — сразу подцепляем уже существующий player.
        if let player {
            vc.playerContainerView.playerLayer.player = player
        }
    }

    private func detachWindow() {
        isExternalScreenConnected = false
        externalWindow?.isHidden = true
        externalWindow = nil
        playerViewController = nil
        onConnectionChange?(false)
        stop()
    }

    // MARK: - Вызывается из ExternalDisplayPlugin (команды из JS)

    func play(urlString: String, startPositionSeconds: Double) {
        guard let url = URL(string: urlString) else { return }

        configureAudioSession()

        let item = AVPlayerItem(url: url)
        let newPlayer = AVPlayer(playerItem: item)
        // Наша ручная AVPlayerLayer-отрисовка в UIWindow на внешнем экране
        // (см. attachWindow выше) работает, только пока приложение реально
        // на переднем плане — при блокировке телефона такая отрисовка
        // приложением приостанавливается системой, даже если фоновое аудио
        // продолжает идти. usesExternalPlaybackWhileExternalScreenIsActive
        // переключает вывод на системный конвейер "внешнего воспроизведения"
        // (тот же, что использует AirPlay) — им управляет не наш код, а сама
        // ОС, и именно поэтому у него больше шансов пережить блокировку.
        // allowsExternalPlayback включён по умолчанию, но выставляем явно.
        newPlayer.allowsExternalPlayback = true
        newPlayer.usesExternalPlaybackWhileExternalScreenIsActive = true
        player = newPlayer
        playerViewController?.playerContainerView.playerLayer.player = newPlayer

        if startPositionSeconds > 1 {
            let time = CMTime(seconds: startPositionSeconds, preferredTimescale: 600)
            newPlayer.seek(to: time)
        }
        newPlayer.play()

        addTimeObserver()

        // Не даём телефону погаснуть/заблокироваться САМОМУ по таймауту
        // бездействия, пока идёт воспроизведение на очках — не помогает от
        // ручной блокировки кнопкой, но убирает автоблокировку как отдельную
        // переменную при тестировании. Сбрасывается в stop().
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }

    func stop() {
        removeTimeObserver()
        player?.pause()
        player = nil
        playerViewController?.playerContainerView.playerLayer.player = nil
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        // .playback (не .ambient/.soloAmbient) — обязателен для продолжения
        // воспроизведения при блокировке экрана вместе с UIBackgroundModes
        // "audio" в Info.plist. .moviePlayback — правильный mode для видео.
        try? session.setCategory(.playback, mode: .moviePlayback, options: [])
        try? session.setActive(true)
    }

    private func addTimeObserver() {
        removeTimeObserver()
        guard let player else { return }
        // Раз в 5 секунд — совпадает с интервалом сохранения прогресса на
        // веб-стороне (useProgressSaver, SAVE_INTERVAL_MS), чаще не нужно.
        let interval = CMTime(seconds: 5, preferredTimescale: 1)
        timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard time.isValid, !time.isIndefinite else { return }
            self?.onTimeUpdate?(time.seconds)
        }
    }

    private func removeTimeObserver() {
        if let token = timeObserverToken, let player {
            player.removeTimeObserver(token)
        }
        timeObserverToken = nil
    }
}
