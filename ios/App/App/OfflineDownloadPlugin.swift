import Foundation
import Capacitor

/// Мост JS <-> OfflineDownloadManager — по образцу ExternalDisplayPlugin.
/// Сама офлайн-загрузка/плеер идут через нативную вкладку «Загрузки»
/// (DownloadsView/DownloadPlayerView) — этот плагин со стороны сайта нужен
/// только чтобы 1) сообщить состояние авторизации и 2) поставить в очередь
/// скачивание конкретной серии/фильма кнопкой «Скачать» на карточке тайтла
/// (см. DownloadPicker.tsx) — сам процесс скачивания и воспроизведение
/// офлайн пользователь дальше видит и контролирует уже в нативной вкладке,
/// не в вебе.
@objc(OfflineDownloadPlugin)
public class OfflineDownloadPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OfflineDownloadPlugin"
    public let jsName = "OfflineDownload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setAuthState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAuthState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStorageInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDownloads", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDownloadStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAllowCellular", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingProgress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSyncedProgress", returnType: CAPPluginReturnPromise)
    ]

    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        // queue: nil (не .main) — см. подробный комментарий у аналогичных
        // observer'ов в DownloadsViewModel.swift: эти уведомления шлются из
        // OfflineDownloadManager.stateQueue (фоновая очередь), а queue: .main
        // может синхронно заблокировать отправителя, ожидая выполнения
        // блока на главном потоке — если тот в этот момент сам ждёт
        // stateQueue (см. listDownloads()/getDownloadStatus()), оба потока
        // блокируют друг друга навсегда (пойманный вживую deadlock, см.
        // DownloadsViewModel.swift). notifyListeners сам не требует главного
        // потока, но переходим на него явным async — предсказуемее, чем
        // полагаться на то, что Capacitor's notifyListeners всегда безопасен
        // с произвольного потока.
        observers.append(center.addObserver(forName: .offlineDownloadProgress, object: nil, queue: nil) { [weak self] note in
            guard let info = note.userInfo as? [String: Any] else { return }
            DispatchQueue.main.async { self?.notifyListeners("downloadProgress", data: info) }
        })
        observers.append(center.addObserver(forName: .offlineDownloadComplete, object: nil, queue: nil) { [weak self] note in
            guard let info = note.userInfo as? [String: Any] else { return }
            DispatchQueue.main.async { self?.notifyListeners("downloadComplete", data: info) }
        })
        observers.append(center.addObserver(forName: .offlineDownloadFailed, object: nil, queue: nil) { [weak self] note in
            guard let info = note.userInfo as? [String: Any] else { return }
            DispatchQueue.main.async { self?.notifyListeners("downloadFailed", data: info) }
        })
    }

    deinit {
        let center = NotificationCenter.default
        for observer in observers { center.removeObserver(observer) }
    }

    // MARK: - Авторизация / диск

    @objc func setAuthState(_ call: CAPPluginCall) {
        let isAuthed = call.getBool("isAuthed") ?? false
        let userId = call.getString("userId")
        OfflineDownloadManager.shared.setAuthState(isAuthed: isAuthed, userId: userId)
        call.resolve()
    }

    @objc func getAuthState(_ call: CAPPluginCall) {
        call.resolve([
            "isAuthed": OfflineDownloadManager.shared.isAuthed,
            "userId": OfflineDownloadManager.shared.userId as Any
        ])
    }

    @objc func getStorageInfo(_ call: CAPPluginCall) {
        let info = OfflineDownloadManager.shared.getStorageInfo()
        call.resolve([
            "usedBytes": info.usedBytes,
            "freeBytes": info.freeBytes
        ])
    }

    // MARK: - Очередь загрузок

    @objc func startDownload(_ call: CAPPluginCall) {
        guard
            let id = call.getString("id"),
            let entryUrl = call.getString("entryUrl"),
            let contentType = call.getString("contentType"),
            let contentId = call.getInt("contentId"),
            let season = call.getInt("season"),
            let episode = call.getInt("episode"),
            let translationId = call.getInt("translationId"),
            let translationTitle = call.getString("translationTitle"),
            let title = call.getString("title"),
            let episodeLabel = call.getString("episodeLabel")
        else {
            call.reject("bad_params")
            return
        }
        guard OfflineDownloadManager.shared.isAuthed else {
            call.reject("not_authed")
            return
        }
        let request = DownloadRequest(
            id: id,
            entryUrl: entryUrl,
            contentType: contentType,
            contentId: contentId,
            season: season,
            episode: episode,
            translationId: translationId,
            translationTitle: translationTitle,
            title: title,
            posterUrl: call.getString("posterUrl"),
            episodeLabel: episodeLabel
        )
        OfflineDownloadManager.shared.startDownload(request)
        call.resolve()
    }

    @objc func pauseDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("bad_params"); return }
        OfflineDownloadManager.shared.pauseDownload(id: id)
        call.resolve()
    }

    @objc func resumeDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("bad_params"); return }
        OfflineDownloadManager.shared.resumeDownload(id: id)
        call.resolve()
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("bad_params"); return }
        OfflineDownloadManager.shared.cancelDownload(id: id)
        call.resolve()
    }

    @objc func deleteDownload(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("bad_params"); return }
        OfflineDownloadManager.shared.deleteDownload(id: id)
        call.resolve()
    }

    @objc func listDownloads(_ call: CAPPluginCall) {
        let items = OfflineDownloadManager.shared.listDownloads()
        call.resolve(["items": items.map(Self.serialize)])
    }

    @objc func getDownloadStatus(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("bad_params"); return }
        guard let item = OfflineDownloadManager.shared.getDownloadStatus(id: id) else {
            call.resolve(["item": NSNull()])
            return
        }
        call.resolve(["item": Self.serialize(item)])
    }

    @objc func setAllowCellular(_ call: CAPPluginCall) {
        let allow = call.getBool("allow") ?? false
        OfflineDownloadManager.shared.setAllowCellular(allow)
        call.resolve()
    }

    // MARK: - Офлайн-прогресс (фаза C — см. OfflineSyncTrigger.tsx/api/progress/sync)

    @objc func getPendingProgress(_ call: CAPPluginCall) {
        let entries = OfflineDownloadManager.shared.getPendingProgress()
        call.resolve(["items": entries.map(Self.serializeProgress)])
    }

    @objc func clearSyncedProgress(_ call: CAPPluginCall) {
        guard let keys = call.getArray("keys") as? [String] else {
            call.reject("bad_params")
            return
        }
        OfflineDownloadManager.shared.clearSyncedProgress(keys: keys)
        call.resolve()
    }

    private static func serializeProgress(_ entry: PendingProgressEntry) -> [String: Any] {
        [
            "key": entry.key,
            "contentType": entry.contentType,
            "contentId": entry.contentId,
            "season": entry.season,
            "episode": entry.episode,
            "positionSeconds": entry.positionSeconds,
            "durationSeconds": entry.durationSeconds as Any,
            "title": entry.title,
            "posterUrl": entry.posterUrl as Any,
            "translationId": entry.translationId as Any,
            "translationTitle": entry.translationTitle as Any,
            "updatedAt": isoFormatter.string(from: entry.updatedAt)
        ]
    }

    private static let isoFormatter: ISO8601DateFormatter = ISO8601DateFormatter()

    private static func serialize(_ item: DownloadItem) -> [String: Any] {
        [
            "id": item.id,
            "contentType": item.contentType,
            "contentId": item.contentId,
            "season": item.season,
            "episode": item.episode,
            "translationId": item.translationId,
            "translationTitle": item.translationTitle,
            "title": item.title,
            "posterUrl": item.posterUrl as Any,
            "episodeLabel": item.episodeLabel,
            "status": item.status.rawValue,
            "totalSegments": item.totalSegments,
            "completedSegments": item.completedSegments,
            "progress": item.progress,
            "errorMessage": item.errorMessage as Any,
            "createdAt": isoFormatter.string(from: item.createdAt),
            "lastPositionSeconds": item.lastPositionSeconds,
            "durationSeconds": item.durationSeconds as Any
        ]
    }
}
