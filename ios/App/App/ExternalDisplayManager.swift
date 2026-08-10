import Foundation
import AVFoundation
import UIKit

/// Управляет AVPlayer, который рендерится на внешний экран (очки Xreal,
/// подключены по USB-C DisplayPort) — единая точка входа что для
/// ExternalDisplaySceneDelegate (отдаёт AVPlayerLayer, когда UIScene
/// внешнего экрана подключается), что для ExternalDisplayPlugin (получает
/// команды play/stop из JS, см. src/native/externalDisplay.ts).
///
/// Почему нельзя просто зеркалить WKWebView на внешний экран: WKWebView
/// останавливает рендеринг, когда приложение уходит в фон/экран
/// блокируется — это ограничение самого WebKit, не обходится настройками.
/// Нативный AVPlayer с фоновым аудио-режимом (UIBackgroundModes=audio в
/// Info.plist) продолжает декодировать/рендерить и при блокировке — тот же
/// приём, на котором построены Кинопоиск и подобные видео-приложения.
final class ExternalDisplayManager: NSObject {
    static let shared = ExternalDisplayManager()

    private var player: AVPlayer?
    private weak var playerLayer: AVPlayerLayer?
    private(set) var isExternalScreenConnected = false

    /// Колбэк на подключение/отключение внешнего экрана — подписывается
    /// ExternalDisplayPlugin, чтобы прокинуть событие в JS.
    var onConnectionChange: ((Bool) -> Void)?
    /// Периодический колбэк с текущей позицией — тоже уходит в JS, чтобы
    /// существующий конвейер сохранения прогресса на веб-стороне
    /// (useProgressSaver) получал актуальную позицию, пока играем на очках.
    var onTimeUpdate: ((Double) -> Void)?

    private var timeObserverToken: Any?

    private override init() {
        super.init()
    }

    // MARK: - Вызывается из ExternalDisplaySceneDelegate

    func attachExternalLayer(_ layer: AVPlayerLayer) {
        playerLayer = layer
        layer.player = player
        isExternalScreenConnected = true
        onConnectionChange?(true)
    }

    func detachExternalLayer() {
        playerLayer?.player = nil
        playerLayer = nil
        isExternalScreenConnected = false
        onConnectionChange?(false)
        stop()
    }

    // MARK: - Вызывается из ExternalDisplayPlugin (команды из JS)

    func play(urlString: String, startPositionSeconds: Double) {
        guard let url = URL(string: urlString) else { return }

        configureAudioSession()

        let item = AVPlayerItem(url: url)
        let newPlayer = AVPlayer(playerItem: item)
        player = newPlayer
        playerLayer?.player = newPlayer

        if startPositionSeconds > 1 {
            let time = CMTime(seconds: startPositionSeconds, preferredTimescale: 600)
            newPlayer.seek(to: time)
        }
        newPlayer.play()

        addTimeObserver()
    }

    func stop() {
        removeTimeObserver()
        player?.pause()
        player = nil
        playerLayer?.player = nil
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
