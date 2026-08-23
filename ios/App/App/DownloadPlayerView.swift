import SwiftUI
import AVKit
import UIKit

/// Нативный плеер офлайн-скачанного контента — обычный
/// AVPlayerViewController поверх локального file:// HLS-плейлиста
/// (playlist.m3u8, см. OfflineDownloadManager.beginDownloadingSegments) —
/// работает без сети, т.к. все сегменты уже на диске. Периодический time
/// observer (5с — тот же интервал, что useProgressSaver на веб-стороне и
/// ExternalDisplayManager) сохраняет позицию локально; отправка на сервер
/// при восстановлении сети — фаза C.
struct DownloadPlayerView: UIViewControllerRepresentable {
    let item: DownloadItem

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        let dirName = item.id.replacingOccurrences(of: ":", with: "_")
        let playlistURL = OfflineDownloadManager.shared.downloadsRootURL
            .appendingPathComponent(dirName, isDirectory: true)
            .appendingPathComponent("playlist.m3u8")
        let player = AVPlayer(url: playlistURL)
        if item.lastPositionSeconds > 1 {
            player.seek(to: CMTime(seconds: item.lastPositionSeconds, preferredTimescale: 600))
        }
        controller.player = player

        // Раньше при поломке плеера пользователь видел только стандартную
        // иконку AVKit "не удалось воспроизвести" без единой зацепки, что
        // именно не так (файла нет? не расшифровался? битый плейлист?) —
        // тот же класс проблемы, что был с "not implemented on ios" и
        // segment_download_failed раньше: без реальной причины любая правка
        // вслепую. Показываем реальную ошибку AVFoundation алертом.
        context.coordinator.statusObservation = player.currentItem?.observe(\.status, options: [.new]) { [weak controller] playerItem, _ in
            guard playerItem.status == .failed else { return }
            let message = Self.describePlaybackError(playerItem.error, errorLog: playerItem.errorLog())
            DispatchQueue.main.async {
                guard let controller, controller.presentedViewController == nil else { return }
                let alert = UIAlertController(title: "Не удалось воспроизвести", message: message, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default))
                controller.present(alert, animated: true)
            }
        }

        let itemId = item.id
        let interval = CMTime(seconds: 5, preferredTimescale: 1)
        context.coordinator.player = player
        context.coordinator.timeObserverToken = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
            let seconds = time.seconds
            guard seconds.isFinite, seconds >= 0 else { return }
            let durationSeconds = player.currentItem?.duration.seconds
            OfflineDownloadManager.shared.saveLastPosition(
                id: itemId,
                positionSeconds: seconds,
                durationSeconds: (durationSeconds?.isFinite == true) ? durationSeconds : nil
            )
        }
        player.play()
        return controller
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {}

    static func dismantleUIViewController(_ uiViewController: AVPlayerViewController, coordinator: Coordinator) {
        if let token = coordinator.timeObserverToken {
            coordinator.player?.removeTimeObserver(token)
        }
        uiViewController.player?.pause()
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Раньше показывал только верхний уровень ошибки (domain/code) — не
    /// хватило, чтобы понять причину -12865 (см. живой репорт 2026-08-23,
    /// ошибка повторилась даже после фикса под CMAF/#EXT-X-MAP). Теперь
    /// разворачивает всю цепочку NSUnderlyingErrorKey + reason/debug-строки,
    /// и отдельно — AVPlayerItemErrorLog: он специфичен для HLS-ассетов и
    /// обычно содержит куда более полезные детали (HTTP-статус и конкретный
    /// URI сегмента/плейлиста, на котором всё сломалось), чем сам NSError.
    private static func describePlaybackError(_ error: Error?, errorLog: AVPlayerItemErrorLog?) -> String {
        var parts: [String] = []
        var current: NSError? = error.map { $0 as NSError }
        var depth = 0
        while let err = current, depth < 6 {
            var line = "\(err.domain) \(err.code): \(err.localizedDescription)"
            if let reason = err.userInfo[NSLocalizedFailureReasonErrorKey] as? String {
                line += "\nreason: \(reason)"
            }
            if let debug = err.userInfo["NSDebugDescription"] as? String {
                line += "\ndebug: \(debug)"
            }
            parts.append(line)
            current = err.userInfo[NSUnderlyingErrorKey] as? NSError
            depth += 1
        }
        if let events = errorLog?.events, !events.isEmpty {
            for event in events.suffix(3) {
                var line = "log: \(event.errorDomain) \(event.errorStatusCode)"
                if let comment = event.errorComment { line += " — \(comment)" }
                if let uri = event.uri { line += "\nuri: \(uri)" }
                parts.append(line)
            }
        }
        return parts.isEmpty ? "unknown" : parts.joined(separator: "\n---\n")
    }

    final class Coordinator {
        var player: AVPlayer?
        var timeObserverToken: Any?
        var statusObservation: NSKeyValueObservation?
    }
}
