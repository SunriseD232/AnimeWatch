import Foundation

extension Notification.Name {
    static let offlineDownloadAuthStateChanged = Notification.Name("offlineDownloadAuthStateChanged")
    /// Список загрузок изменился (добавили/удалили/сменился статус) — общий
    /// сигнал «перечитай listDownloads()», без деталей в userInfo.
    static let offlineDownloadItemsChanged = Notification.Name("offlineDownloadItemsChanged")
    /// userInfo: ["id": String, "completed": Int, "total": Int]
    static let offlineDownloadProgress = Notification.Name("offlineDownloadProgress")
    /// userInfo: ["id": String]
    static let offlineDownloadComplete = Notification.Name("offlineDownloadComplete")
    /// userInfo: ["id": String, "error": String]
    static let offlineDownloadFailed = Notification.Name("offlineDownloadFailed")
}

/// Singleton-менеджер офлайн-загрузок — по образцу ExternalDisplayManager,
/// но состояние (очередь, прогресс) шире, поэтому события идут через
/// NotificationCenter (см. Notification.Name выше), а не через одиночные
/// closure-поля — и OfflineDownloadPlugin, и DownloadsViewModel (SwiftUI)
/// подписываются независимо друг от друга.
///
/// Модель скачивания серии — по HLS-плейлисту, который уже отдаёт наш
/// /api/proxy (см. src/lib/extract/proxy.ts на веб-стороне — там сегменты
/// уже переписаны на подписанные /api/proxy/raw ссылки, реальный upstream-
/// домен наружу не уходит): 1) забираем entryUrl (его строит JS, см.
/// DownloadPicker.tsx — тот же путь, что hls.js использует в OwnPlayer.tsx);
/// 2) если это master-плейлист — выбираем вариант ближе к 720p, но не выше;
/// 3) скачиваем все сегменты (и AES-128 ключ, если есть) параллельно через
/// фоновую URLSession; 4) складываем рядом локальный плейлист с локальными
/// именами файлов — AVPlayer проигрывает такой file:// плейлист как обычный
/// HLS без сети (см. DownloadPlayerView.swift).
///
/// Очередь — ОДНА серия активно скачивается за раз (isProcessingQueue) —
/// проще для отладки и не создаёт сотни параллельных background-задач сразу
/// на несколько серий; внутри одной серии сегменты качаются параллельно
/// (httpMaximumConnectionsPerHost = 6).
final class OfflineDownloadManager: NSObject {
    static let shared = OfflineDownloadManager()

    private let defaults = UserDefaults.standard
    private let authedKey = "OfflineDownload.isAuthed"
    private let userIdKey = "OfflineDownload.userId"
    private let allowCellularKey = "OfflineDownload.allowCellular"

    private let fileManager = FileManager.default
    /// Единственная точка правды для items/очереди — всё ниже с суффиксом
    /// Locked предполагает, что вызывающий код уже выполняется на этой
    /// очереди (через stateQueue.async{}), иначе — гонки за items.
    private let stateQueue = DispatchQueue(label: "ru.mediawatch.offlinedownload.state")

    private var items: [DownloadItem] = []
    /// "contentType:contentId" -> последнее известное офлайн-состояние
    /// просмотра, ещё не подтверждённое сервером (см. saveLastPosition/
    /// getPendingProgress/clearSyncedProgress ниже).
    private var pendingProgress: [String: PendingProgressEntry] = [:]
    private var isProcessingQueue = false
    private var currentlyDownloadingItemId: String?
    /// itemId -> сколько файлов (сегменты + ключ) ещё не долетели до финала
    /// (успех ИЛИ исчерпанные ретраи) в рамках текущей попытки скачивания.
    private var pendingSegmentCounts: [String: Int] = [:]
    /// itemId -> хотя бы один сегмент окончательно не скачался.
    private var itemHadFailure: [String: Bool] = [:]
    /// itemId -> причина последнего окончательного (после исчерпанных
    /// ретраев) отказа сегмента — HTTP-статус апстрима или код URLError.
    /// Раньше этот случай схлопывался в непрозрачную константу
    /// "segment_download_failed" — при живом расследовании 2026-08-21
    /// выяснилось, что без конкретной причины (403 антибот? истёкший
    /// подписанный CDN-токен? таймаут?) невозможно отличить один сценарий от
    /// другого без ещё одного полного цикла сборка+eSign+тест на удачу.
    private var itemFailureDetail: [String: String] = [:]
    /// "itemId|planIndex" -> число попыток — сбрасывается сам по себе между
    /// запусками приложения (не персистится, не критично для v1).
    private var retryCounts: [String: Int] = [:]
    /// identifier сессии -> completion handler из AppDelegate
    /// (handleEventsForBackgroundURLSession) — вызывается, когда
    /// urlSessionDidFinishEvents сообщает, что все фоновые события доставлены.
    private var pendingBackgroundCompletionHandlers: [String: () -> Void] = [:]

    lazy var downloadsRootURL: URL = {
        let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let url = support.appendingPathComponent("OfflineDownloads", isDirectory: true)
        try? fileManager.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()

    private var indexURL: URL {
        downloadsRootURL.appendingPathComponent("index.json")
    }

    private var pendingProgressURL: URL {
        downloadsRootURL.appendingPathComponent("pendingProgress.json")
    }

    private static let backgroundSessionIdentifier = "ru.mediawatch.offlinedownload.bg"

    private lazy var backgroundSession: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.backgroundSessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpMaximumConnectionsPerHost = 6
        // Применяется только при (пере)создании сессии — обычно следующий
        // запуск приложения, см. setAllowCellular ниже.
        config.allowsCellularAccess = defaults.bool(forKey: allowCellularKey)
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        super.init()
        loadIndexFromDisk()
        loadPendingProgressFromDisk()
        // Форсируем создание/переподключение фоновой сессии сразу — иначе
        // её delegate не узнает о задачах, доскачавшихся пока приложение
        // было закрыто обычным способом (не через handleEventsForBackground...).
        _ = backgroundSession
    }

    // MARK: - Авторизация (фаза A)

    var isAuthed: Bool { defaults.bool(forKey: authedKey) }
    var userId: String? { defaults.string(forKey: userIdKey) }

    func setAuthState(isAuthed: Bool, userId: String?) {
        defaults.set(isAuthed, forKey: authedKey)
        if let userId {
            defaults.set(userId, forKey: userIdKey)
        } else {
            defaults.removeObject(forKey: userIdKey)
        }
        NotificationCenter.default.post(name: .offlineDownloadAuthStateChanged, object: nil)
    }

    var allowCellular: Bool { defaults.bool(forKey: allowCellularKey) }

    func setAllowCellular(_ allow: Bool) {
        defaults.set(allow, forKey: allowCellularKey)
    }

    // MARK: - Место на диске

    func getStorageInfo() -> (usedBytes: Int64, freeBytes: Int64) {
        (directorySize(at: downloadsRootURL), freeDiskSpaceBytes())
    }

    private func directorySize(at url: URL) -> Int64 {
        guard let enumerator = fileManager.enumerator(
            at: url,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [],
            errorHandler: nil
        ) else {
            return 0
        }
        var total: Int64 = 0
        for case let fileURL as URL in enumerator {
            if let size = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                total += Int64(size)
            }
        }
        return total
    }

    private func freeDiskSpaceBytes() -> Int64 {
        guard let attrs = try? fileManager.attributesOfFileSystem(forPath: downloadsRootURL.path),
              let free = attrs[.systemFreeSize] as? NSNumber else {
            return 0
        }
        return free.int64Value
    }

    // MARK: - Индекс

    private func loadIndexFromDisk() {
        guard let data = try? Data(contentsOf: indexURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        items = (try? decoder.decode([DownloadItem].self, from: data)) ?? []
    }

    /// Вызывать только с stateQueue.
    private func saveIndexToDiskLocked() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(items) else { return }
        try? data.write(to: indexURL, options: .atomic)
    }

    private func notifyItemsChanged() {
        NotificationCenter.default.post(name: .offlineDownloadItemsChanged, object: nil)
    }

    private func loadPendingProgressFromDisk() {
        guard let data = try? Data(contentsOf: pendingProgressURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let entries = (try? decoder.decode([PendingProgressEntry].self, from: data)) ?? []
        pendingProgress = Dictionary(uniqueKeysWithValues: entries.map { ($0.key, $0) })
    }

    /// Вызывать только с stateQueue.
    private func savePendingProgressToDiskLocked() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(Array(pendingProgress.values)) else { return }
        try? data.write(to: pendingProgressURL, options: .atomic)
    }

    func listDownloads() -> [DownloadItem] {
        stateQueue.sync { items }
    }

    func getDownloadStatus(id: String) -> DownloadItem? {
        stateQueue.sync { items.first { $0.id == id } }
    }

    /// Вызывать только с stateQueue.
    private func updateItemLocked(_ id: String, _ mutate: (inout DownloadItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        mutate(&items[index])
        saveIndexToDiskLocked()
    }

    private func itemDirURL(_ itemId: String) -> URL {
        downloadsRootURL.appendingPathComponent(itemId.replacingOccurrences(of: ":", with: "_"), isDirectory: true)
    }

    // MARK: - Публичное управление очередью

    func startDownload(_ request: DownloadRequest) {
        stateQueue.async {
            if let existing = self.items.first(where: { $0.id == request.id }) {
                switch existing.status {
                case .completed, .downloading, .queued:
                    return // уже скачано или уже в процессе
                case .failed, .paused:
                    self.resumeDownloadLocked(id: request.id)
                }
                return
            }
            let item = DownloadItem(
                id: request.id,
                entryUrl: request.entryUrl,
                contentType: request.contentType,
                contentId: request.contentId,
                season: request.season,
                episode: request.episode,
                translationId: request.translationId,
                translationTitle: request.translationTitle,
                title: request.title,
                posterUrl: request.posterUrl,
                episodeLabel: request.episodeLabel,
                status: .queued,
                totalSegments: 0,
                completedSegments: 0,
                errorMessage: nil,
                createdAt: Date(),
                lastPositionSeconds: 0,
                durationSeconds: nil
            )
            self.items.append(item)
            self.saveIndexToDiskLocked()
            self.notifyItemsChanged()
            self.processQueueLocked()
        }
    }

    func pauseDownload(id: String) {
        stateQueue.async {
            guard let index = self.items.firstIndex(where: { $0.id == id }) else { return }
            guard self.items[index].status == .downloading || self.items[index].status == .queued else { return }
            self.cancelTasks(forItemId: id)
            self.items[index].status = .paused
            self.saveIndexToDiskLocked()
            self.notifyItemsChanged()
            if self.currentlyDownloadingItemId == id {
                self.advanceQueueLocked()
            }
        }
    }

    func resumeDownload(id: String) {
        stateQueue.async {
            self.resumeDownloadLocked(id: id)
        }
    }

    /// Вызывать только с stateQueue.
    private func resumeDownloadLocked(id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        guard items[index].status == .paused || items[index].status == .failed else { return }
        items[index].status = .queued
        items[index].errorMessage = nil
        saveIndexToDiskLocked()
        notifyItemsChanged()
        processQueueLocked()
    }

    func cancelDownload(id: String) {
        removeItemAndFiles(id: id)
    }

    func deleteDownload(id: String) {
        removeItemAndFiles(id: id)
    }

    private func removeItemAndFiles(id: String) {
        stateQueue.async {
            self.cancelTasks(forItemId: id)
            self.pendingSegmentCounts.removeValue(forKey: id)
            self.itemHadFailure.removeValue(forKey: id)
            if let index = self.items.firstIndex(where: { $0.id == id }) {
                self.items.remove(at: index)
                self.saveIndexToDiskLocked()
                self.notifyItemsChanged()
            }
            try? self.fileManager.removeItem(at: self.itemDirURL(id))
            if self.currentlyDownloadingItemId == id {
                self.advanceQueueLocked()
            }
        }
    }

    private func cancelTasks(forItemId itemId: String) {
        let prefix = "\(itemId)|"
        backgroundSession.getAllTasks { tasks in
            for task in tasks where (task.taskDescription ?? "").hasPrefix(prefix) {
                task.cancel()
            }
        }
    }

    // MARK: - Локальный прогресс воспроизведения + очередь на синхронизацию с сервером

    /// Time observer офлайн-плеера (см. DownloadPlayerView) зовёт это каждые
    /// ~5с. Обновляет и «продолжить с этого места» для самого офлайн-плеера
    /// (lastPositionSeconds на DownloadItem), и очередь pendingProgress —
    /// единственную точку правды для будущей отправки на сервер (см.
    /// getPendingProgress/OfflineSyncTrigger.tsx/api/progress/sync).
    func saveLastPosition(id: String, positionSeconds: Double, durationSeconds: Double?) {
        stateQueue.async {
            self.updateItemLocked(id) { item in
                item.lastPositionSeconds = positionSeconds
                if let durationSeconds { item.durationSeconds = durationSeconds }
            }
            guard let item = self.items.first(where: { $0.id == id }) else { return }
            let key = "\(item.contentType):\(item.contentId)"
            self.pendingProgress[key] = PendingProgressEntry(
                key: key,
                contentType: item.contentType,
                contentId: item.contentId,
                season: item.season,
                episode: item.episode,
                positionSeconds: positionSeconds,
                durationSeconds: durationSeconds ?? item.durationSeconds,
                title: item.title,
                posterUrl: item.posterUrl,
                translationId: item.translationId,
                translationTitle: item.translationTitle,
                updatedAt: Date()
            )
            self.savePendingProgressToDiskLocked()
        }
    }

    /// Снимок очереди — читает JS при восстановлении сети (см.
    /// OfflineSyncTrigger.tsx) и шлёт на /api/progress/sync.
    func getPendingProgress() -> [PendingProgressEntry] {
        stateQueue.sync { Array(pendingProgress.values) }
    }

    /// Убирает записи после успешного (в любую сторону — применили наше или
    /// подтянули серверное, оба случая означают «сверились») раунда
    /// /api/progress/sync — см. OfflineSyncTrigger.tsx.
    func clearSyncedProgress(keys: [String]) {
        stateQueue.async {
            for key in keys {
                self.pendingProgress.removeValue(forKey: key)
            }
            self.savePendingProgressToDiskLocked()
        }
    }

    // MARK: - Обработка очереди

    /// Вызывать только с stateQueue.
    private func processQueueLocked() {
        guard !isProcessingQueue else { return }
        guard let next = items.first(where: { $0.status == .queued }) else { return }
        isProcessingQueue = true
        currentlyDownloadingItemId = next.id
        updateItemLocked(next.id) { item in
            item.status = .downloading
            item.errorMessage = nil
        }
        notifyItemsChanged()
        let itemId = next.id
        let entryUrlString = next.entryUrl
        Task { [weak self] in
            await self?.runEpisodeDownload(itemId: itemId, entryUrlString: entryUrlString)
        }
    }

    /// Вызывать только с stateQueue.
    private func advanceQueueLocked() {
        isProcessingQueue = false
        currentlyDownloadingItemId = nil
        processQueueLocked()
    }

    private func finishItemSuccess(_ itemId: String) {
        stateQueue.async {
            self.updateItemLocked(itemId) { $0.status = .completed }
            self.notifyItemsChanged()
            NotificationCenter.default.post(name: .offlineDownloadComplete, object: nil, userInfo: ["id": itemId])
            self.advanceQueueLocked()
        }
    }

    private func finishItemFailure(_ itemId: String, error: String) {
        stateQueue.async {
            self.updateItemLocked(itemId) { item in
                item.status = .failed
                item.errorMessage = error
            }
            self.notifyItemsChanged()
            NotificationCenter.default.post(
                name: .offlineDownloadFailed,
                object: nil,
                userInfo: ["id": itemId, "error": error]
            )
            self.advanceQueueLocked()
        }
    }

    // MARK: - Скачивание одной серии

    private static func checkHttpOk(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw DownloadError.badResponse
        }
    }

    private func runEpisodeDownload(itemId: String, entryUrlString: String) async {
        guard let entryUrl = URL(string: entryUrlString) else {
            finishItemFailure(itemId, error: "bad_entry_url")
            return
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: entryUrl)
            try Self.checkHttpOk(response)
            guard let text = String(data: data, encoding: .utf8) else { throw DownloadError.decode }

            if HLSPlaylist.isMaster(text) {
                let variants = HLSPlaylist.parseVariants(text)
                guard let picked = HLSPlaylist.pickVariant(variants, targetHeight: 720),
                      let variantUrl = URL(string: picked.urlLine, relativeTo: entryUrl) else {
                    throw DownloadError.noVariant
                }
                let (variantData, variantResponse) = try await URLSession.shared.data(from: variantUrl)
                try Self.checkHttpOk(variantResponse)
                guard let variantText = String(data: variantData, encoding: .utf8) else { throw DownloadError.decode }
                try beginDownloadingSegments(itemId: itemId, playlistText: variantText, baseUrl: variantUrl)
            } else {
                try beginDownloadingSegments(itemId: itemId, playlistText: text, baseUrl: entryUrl)
            }
        } catch {
            finishItemFailure(itemId, error: String(describing: error))
        }
    }

    /// Разбирает медиа-плейлист, пишет локальный playlist.m3u8 и планирует
    /// фоновые задачи на недостающие файлы (уже скачанные — по факту наличия
    /// локального файла — пропускаются, это и есть «резюме» после паузы/
    /// ошибки без отдельного хранилища плана на диске).
    private func beginDownloadingSegments(itemId: String, playlistText: String, baseUrl: URL) throws {
        let playlist = HLSPlaylist.parseMediaPlaylist(playlistText)
        guard !playlist.segments.isEmpty else { throw DownloadError.noSegments }

        let dirURL = itemDirURL(itemId)
        try fileManager.createDirectory(at: dirURL, withIntermediateDirectories: true)
        excludeFromBackup(dirURL)

        var segmentFileNames: [String] = []
        var plan: [DownloadPlanEntry] = []

        if let keyURIString = playlist.keyURI, let keyUrl = URL(string: keyURIString, relativeTo: baseUrl) {
            plan.append(DownloadPlanEntry(index: -1, remoteUrl: keyUrl.absoluteString, localName: "key.bin"))
        }
        for (index, segment) in playlist.segments.enumerated() {
            guard let segUrl = URL(string: segment.uri, relativeTo: baseUrl) else { continue }
            let name = String(format: "seg%05d.ts", index)
            segmentFileNames.append(name)
            plan.append(DownloadPlanEntry(index: index, remoteUrl: segUrl.absoluteString, localName: name))
        }
        guard segmentFileNames.count == playlist.segments.count else { throw DownloadError.noSegments }

        let localPlaylistText = HLSPlaylist.buildLocalPlaylist(from: playlist, segmentFileNames: segmentFileNames)
        try localPlaylistText.write(
            to: dirURL.appendingPathComponent("playlist.m3u8"),
            atomically: true,
            encoding: .utf8
        )

        let remaining = plan.filter { !fileManager.fileExists(atPath: dirURL.appendingPathComponent($0.localName).path) }
        let completedCount = plan.count - remaining.count
        let totalCount = plan.count

        stateQueue.async {
            self.updateItemLocked(itemId) { item in
                item.totalSegments = totalCount
                item.completedSegments = completedCount
            }
            self.notifyItemsChanged()

            if remaining.isEmpty {
                self.finishItemSuccessLockedFromAsync(itemId)
                return
            }
            self.pendingSegmentCounts[itemId] = remaining.count
            self.itemHadFailure[itemId] = false
            for entry in remaining {
                self.scheduleSegmentTask(itemId: itemId, entry: entry)
            }
        }
    }

    /// Уже выполняется внутри stateQueue.async{} — просто локальный алиас,
    /// чтобы не дублировать тело finishItemSuccess (который сам делает
    /// async, что было бы избыточной вложенной диспетчеризацией тут).
    private func finishItemSuccessLockedFromAsync(_ itemId: String) {
        updateItemLocked(itemId) { $0.status = .completed }
        notifyItemsChanged()
        NotificationCenter.default.post(name: .offlineDownloadComplete, object: nil, userInfo: ["id": itemId])
        advanceQueueLocked()
    }

    private func excludeFromBackup(_ url: URL) {
        var mutableUrl = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? mutableUrl.setResourceValues(values)
    }

    private func scheduleSegmentTask(itemId: String, entry: DownloadPlanEntry) {
        guard let url = URL(string: entry.remoteUrl) else {
            stateQueue.async { self.settleSegmentLocked(itemId: itemId, success: false) }
            return
        }
        let task = backgroundSession.downloadTask(with: url)
        task.taskDescription = "\(itemId)|\(entry.index)|\(entry.localName)"
        task.resume()
    }

    private func retryKey(_ itemId: String, _ planIndex: Int) -> String { "\(itemId)|\(planIndex)" }

    private func parseTaskDescription(_ desc: String) -> (itemId: String, planIndex: Int, localName: String)? {
        let parts = desc.components(separatedBy: "|")
        guard parts.count == 3, let planIndex = Int(parts[1]) else { return nil }
        return (parts[0], planIndex, parts[2])
    }

    /// Один файл (сегмент/ключ) долетел до финала — успех или окончательный
    /// провал (после исчерпанных ретраев). Когда все файлы серии долетели —
    /// завершает сам итем (успех/провал). Вызывать только с stateQueue.
    private func settleSegmentLocked(itemId: String, success: Bool, detail: String? = nil) {
        guard var remaining = pendingSegmentCounts[itemId] else { return }
        remaining -= 1
        if remaining > 0 {
            pendingSegmentCounts[itemId] = remaining
        } else {
            pendingSegmentCounts.removeValue(forKey: itemId)
        }
        if !success {
            itemHadFailure[itemId] = true
            if let detail { itemFailureDetail[itemId] = detail }
        }
        guard remaining <= 0 else { return }
        let failed = itemHadFailure.removeValue(forKey: itemId) ?? false
        if failed {
            let reason = itemFailureDetail.removeValue(forKey: itemId)
            let message = reason.map { "segment_download_failed: \($0)" } ?? "segment_download_failed"
            updateItemLocked(itemId) { item in
                item.status = .failed
                item.errorMessage = message
            }
            notifyItemsChanged()
            NotificationCenter.default.post(
                name: .offlineDownloadFailed,
                object: nil,
                userInfo: ["id": itemId, "error": message]
            )
            advanceQueueLocked()
        } else {
            finishItemSuccessLockedFromAsync(itemId)
        }
    }

    /// Обрабатывает результат одной фоновой задачи — до 3 попыток на файл,
    /// затем итем считается failed (уже скачанные файлы остаются на диске —
    /// resumeDownload переиспользует их благодаря проверке fileExists выше).
    private func handleSegmentSettled(itemId: String, planIndex: Int, localName: String, remoteUrl: String, success: Bool, detail: String? = nil) {
        stateQueue.async {
            if success {
                self.retryCounts.removeValue(forKey: self.retryKey(itemId, planIndex))
                self.updateItemLocked(itemId) { item in
                    item.completedSegments += 1
                }
                self.notifyItemsChanged()
                if let item = self.items.first(where: { $0.id == itemId }) {
                    NotificationCenter.default.post(
                        name: .offlineDownloadProgress,
                        object: nil,
                        userInfo: ["id": itemId, "completed": item.completedSegments, "total": item.totalSegments]
                    )
                }
                self.settleSegmentLocked(itemId: itemId, success: true)
                return
            }

            let key = self.retryKey(itemId, planIndex)
            let attempts = (self.retryCounts[key] ?? 0) + 1
            self.retryCounts[key] = attempts
            if attempts <= 3, let url = URL(string: remoteUrl) {
                let task = self.backgroundSession.downloadTask(with: url)
                task.taskDescription = "\(itemId)|\(planIndex)|\(localName)"
                task.resume()
                return // ещё одна попытка в полёте — не settle
            }
            self.retryCounts.removeValue(forKey: key)
            self.settleSegmentLocked(itemId: itemId, success: false, detail: detail)
        }
    }
}

// MARK: - URLSessionDownloadDelegate (фоновые загрузки сегментов)

extension OfflineDownloadManager: URLSessionDownloadDelegate {
    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let desc = downloadTask.taskDescription, let parsed = parseTaskDescription(desc) else { return }
        let remoteUrl = downloadTask.originalRequest?.url?.absoluteString ?? parsed.localName

        let statusCode = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        guard (200...299).contains(statusCode) else {
            handleSegmentSettled(itemId: parsed.itemId, planIndex: parsed.planIndex, localName: parsed.localName, remoteUrl: remoteUrl, success: false, detail: "HTTP \(statusCode)")
            return
        }

        // location — временный файл, живёт ровно до выхода из этого метода,
        // поэтому move должен случиться синхронно прямо тут.
        let destination = itemDirURL(parsed.itemId).appendingPathComponent(parsed.localName)
        var moveSucceeded = true
        var moveErrorDetail: String?
        do {
            try? fileManager.removeItem(at: destination)
            try fileManager.moveItem(at: location, to: destination)
        } catch {
            moveSucceeded = false
            moveErrorDetail = "move failed: \(error.localizedDescription)"
        }
        handleSegmentSettled(itemId: parsed.itemId, planIndex: parsed.planIndex, localName: parsed.localName, remoteUrl: remoteUrl, success: moveSucceeded, detail: moveErrorDetail)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return } // успех уже обработан в didFinishDownloadingTo
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled { return } // наша же отмена (pause/cancel/delete)
        guard let desc = task.taskDescription, let parsed = parseTaskDescription(desc) else { return }
        let remoteUrl = task.originalRequest?.url?.absoluteString ?? parsed.localName
        let detail = "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
        handleSegmentSettled(itemId: parsed.itemId, planIndex: parsed.planIndex, localName: parsed.localName, remoteUrl: remoteUrl, success: false, detail: detail)
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        let identifier = session.configuration.identifier ?? Self.backgroundSessionIdentifier
        DispatchQueue.main.async { [weak self] in
            guard let handler = self?.pendingBackgroundCompletionHandlers.removeValue(forKey: identifier) else { return }
            handler()
        }
    }
}

// MARK: - Фоновый релонч (см. AppDelegate.handleEventsForBackgroundURLSession)

extension OfflineDownloadManager {
    func storeBackgroundCompletionHandler(_ handler: @escaping () -> Void, forSession identifier: String) {
        _ = backgroundSession // гарантируем переподключение делегата к системным задачам
        pendingBackgroundCompletionHandlers[identifier] = handler
    }
}
