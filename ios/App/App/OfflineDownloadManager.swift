import Foundation
import UIKit

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
/// 3) скачиваем все сегменты (и AES-128 ключ, если есть) через обычные (не
/// фоновые) запросы, сами пишем байты на диск — см. runSegmentDownload,
/// почему не фоновая URLSession; 4) складываем рядом локальный плейлист с
/// локальными именами файлов — AVPlayer проигрывает такой file:// плейлист
/// как обычный HLS без сети (см. DownloadPlayerView.swift).
///
/// Очередь — ОДНА серия активно скачивается за раз (isProcessingQueue) —
/// проще для отладки и не создаёт сотни параллельных задач сразу на
/// несколько серий; внутри одной серии сегменты качаются с ограничением
/// maxConcurrentSegmentDownloads одновременно в полёте.
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
    /// itemId -> ещё не запущенные сегменты (см. fillSegmentSlotsLocked) —
    /// раньше весь план на серию (от единиц до многих сотен сегментов)
    /// запускался разом, одним стартом задачи на каждый файл в цикле, через
    /// фоновую URLSession — упиралось во внутренний лимит nsurlsessiond на
    /// одновременно создаваемые задачи, часть валилась с
    /// NSURLErrorCannotCreateFile (-3000). Сегменты теперь качаются не через
    /// фоновую сессию (см. runSegmentDownload), так что сама причина -3000
    /// больше не применяется — но ограничение на число одновременных
    /// запросов всё равно разумно оставить, не заваливать наш собственный
    /// /api/proxy/raw сотнями параллельных запросов сразу. Держим не больше
    /// maxConcurrentSegmentDownloads одновременно в полёте, остальное — в
    /// очереди здесь.
    private var pendingPlanQueue: [String: [DownloadPlanEntry]] = [:]
    /// itemId -> сколько сегментов сейчас реально в полёте (задача создана,
    /// ещё не долетела до финала — включая ретраи, которые переиспользуют
    /// тот же слот, не занимая новый).
    private var inFlightSegmentCounts: [String: Int] = [:]
    private let maxConcurrentSegmentDownloads = 4
    /// "itemId|planIndex" -> число попыток — сбрасывается сам по себе между
    /// запусками приложения (не персистится, не критично для v1).
    private var retryCounts: [String: Int] = [:]
    /// itemId -> активные Task для скачивания сегментов этой серии — нужны
    /// только чтобы уметь их отменить (pause/cancel/delete), см.
    /// cancelTasks(forItemId:).
    private var activeSegmentTasks: [String: [Task<Void, Never>]] = [:]
    /// itemId'ы, для которых уже пробовали полный переповтор эпизода со
    /// свежим резолвом апстрима (см. settleSegmentLocked) — не больше
    /// одного раза за попытку скачивания, чтобы не зациклиться, если
    /// апстрим действительно недоступен, а не просто протух конкретный
    /// подписанный URL.
    private var episodeRetriedWithFresh: Set<String> = []

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

    /// Обычная (не фоновая) сессия для сегментов — см. runSegmentDownload.
    /// allowsCellularAccess применяется только при создании сессии (как и
    /// раньше с фоновой) — смена настройки берётся в расчёт со следующего
    /// запуска приложения, см. setAllowCellular ниже.
    private lazy var segmentSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 6
        config.allowsCellularAccess = defaults.bool(forKey: allowCellularKey)
        return URLSession(configuration: config)
    }()

    private override init() {
        super.init()
        loadIndexFromDisk()
        loadPendingProgressFromDisk()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }

    /// Без фоновой URLSession (см. runSegmentDownload — та была снята из-за
    /// системного бага, стабильно валившего сегменты с
    /// NSURLErrorCannotCreateFile) сегменты качаются только пока приложение
    /// активно. Уход в фон (блокировка экрана, переключение на другое
    /// приложение) быстро приостанавливает процесс — уже запущенные сетевые
    /// задачи повисают без завершения ни успехом, ни ошибкой, и ретраи/
    /// очередь никогда не срабатывают — проверено вживую 2026-08-23:
    /// пользователь видел «зависшую» загрузку, интерфейс при этом отзывался
    /// нормально (сам баг был не в UI). Вместо тихого зависания явно ставим
    /// текущую загрузку на паузу — уже скачанные сегменты остаются на диске
    /// (resumeDownload переиспользует их), пользователь просто жмёт
    /// «Продолжить», когда снова откроет приложение.
    @objc private func handleDidEnterBackground() {
        guard let itemId = stateQueue.sync(execute: { currentlyDownloadingItemId }) else { return }
        pauseDownload(id: itemId)
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

    private var indexSaveWorkItem: DispatchWorkItem?

    /// Вызывать только с stateQueue. Дебаунс записи индекса на диск —
    /// updateItemLocked зовётся на КАЖДЫЙ скачанный сегмент (completedSegments
    /// += 1), при сотнях сегментов на серию это раньше означало atomic-запись
    /// файла на диск по нескольку раз в секунду на этой же serial-очереди, на
    /// которой listDownloads()/getDownloadStatus() (SwiftUI, JS-мост) делают
    /// .sync — запись боролась за диск с самими сегментами (пишутся
    /// параллельно) и усугубляла зависание из-за обхода диска в
    /// DownloadsViewModel.getStorageInfo() (см. его комментарий про рост
    /// библиотеки) — воспроизведено вживую 2026-08-26: чем больше уже
    /// скачано, тем быстрее новая закачка вешала приложение. Прогресс на
    /// экране всё равно берётся из @Published-состояния в памяти
    /// (уведомление шлётся сразу, см. notifyItemsChanged), а резюме после
    /// паузы/сбоя — по факту наличия файла на диске (fileExists), не по
    /// persisted completedSegments, так что отставание записи на полсекунды
    /// ничем не грозит даже при force-quit.
    private func scheduleIndexSaveLocked() {
        indexSaveWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.saveIndexToDiskLocked()
        }
        indexSaveWorkItem = work
        stateQueue.asyncAfter(deadline: .now() + 0.5, execute: work)
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
        scheduleIndexSaveLocked()
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
        episodeRetriedWithFresh.remove(id)
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
            self.itemFailureDetail.removeValue(forKey: id)
            self.pendingPlanQueue.removeValue(forKey: id)
            self.inFlightSegmentCounts.removeValue(forKey: id)
            self.episodeRetriedWithFresh.remove(id)
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
        activeSegmentTasks.removeValue(forKey: itemId)?.forEach { $0.cancel() }
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
    /// закачку недостающих файлов (уже скачанные — по факту наличия
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
        // #EXT-X-MAP — init-сегмент, обязателен для fMP4/CMAF-потоков (см.
        // комментарий у MediaPlaylist.mapURI): без него отдельные .m4s-
        // сегменты не несут информацию для инициализации кодека. Индекс -2,
        // чтобы не пересекаться с key.bin (-1) и реальными сегментами (0+).
        if let mapURIString = playlist.mapURI, let mapUrl = URL(string: mapURIString, relativeTo: baseUrl) {
            plan.append(DownloadPlanEntry(index: -2, remoteUrl: mapUrl.absoluteString, localName: HLSPlaylist.initSegmentLocalName))
        }
        // Расширение сегментов должно соответствовать реальному контейнеру:
        // .ts (MPEG-TS) для классического HLS, .m4s (fMP4) для CMAF — сама
        // ссылка на сегмент приходит уже опаковой (наш /api/proxy/raw,
        // проверенным способом маскирующий исходный apstream-URL), поэтому
        // расширение нельзя взять из неё — определяем по наличию #EXT-X-MAP.
        let segmentExtension = playlist.mapURI != nil ? "m4s" : "ts"
        for (index, segment) in playlist.segments.enumerated() {
            guard let segUrl = URL(string: segment.uri, relativeTo: baseUrl) else { continue }
            let name = String(format: "seg%05d.\(segmentExtension)", index)
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
            self.pendingPlanQueue[itemId] = remaining
            self.inFlightSegmentCounts[itemId] = 0
            self.fillSegmentSlotsLocked(itemId: itemId)
        }
    }

    /// Вызывать только с stateQueue. Запускает следующие задачи из очереди,
    /// пока в полёте меньше maxConcurrentSegmentDownloads — см. комментарий у
    /// pendingPlanQueue.
    private func fillSegmentSlotsLocked(itemId: String) {
        var inFlight = inFlightSegmentCounts[itemId] ?? 0
        while inFlight < maxConcurrentSegmentDownloads {
            guard var queue = pendingPlanQueue[itemId], !queue.isEmpty else { break }
            let entry = queue.removeFirst()
            pendingPlanQueue[itemId] = queue
            inFlight += 1
            scheduleSegmentTask(itemId: itemId, entry: entry)
        }
        inFlightSegmentCounts[itemId] = inFlight
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

    /// Без Accept-Encoding: identity сессия иногда сама просит у сервера gzip
    /// и потом не может корректно разжать поток на лету — известный баг
    /// URLSession с сегментами не-текстового content-type. Нашим .ts/.bin
    /// сегментам сжатие всё равно не нужно (уже сжатое видео) — проще
    /// запретить кодирование целиком, чем полагаться на то, что сервер сам не
    /// сожмёт ответ.
    private func segmentDownloadRequest(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        return request
    }

    /// Вызывать только с stateQueue (мутирует activeSegmentTasks).
    private func scheduleSegmentTask(itemId: String, entry: DownloadPlanEntry) {
        guard let url = URL(string: entry.remoteUrl) else {
            stateQueue.async { self.settleSegmentLocked(itemId: itemId, success: false) }
            return
        }
        let task = Task { [weak self] in
            guard let self else { return }
            await self.runSegmentDownload(itemId: itemId, entry: entry, url: url)
        }
        activeSegmentTasks[itemId, default: []].append(task)
    }

    /// Скачивает один файл (сегмент/ключ) обычным запросом (см. segmentSession)
    /// и сам пишет байты на диск — раньше это шло через
    /// URLSessionConfiguration.background + downloadTask, но её собственное
    /// внутреннее управление временными файлами (у системного nsurlsessiond,
    /// вне нашего контроля) стабильно валилось с NSURLErrorCannotCreateFile
    /// (-3000) — проверено вживую 2026-08-21: не лечилось ни ограничением
    /// конкурентности (maxConcurrentSegmentDownloads), ни перезагрузкой
    /// телефона, то есть не разовое сбойное состояние, а системная проблема
    /// именно с фоновыми загрузками в этом сценарии. Обычная сессия эту
    /// прослойку ОС не задействует вообще. Компромисс: скачивание сегментов
    /// больше не продолжится, если приложение полностью выгрузят из памяти —
    /// на время закачки серии приложение должно оставаться открытым.
    private func runSegmentDownload(itemId: String, entry: DownloadPlanEntry, url: URL) async {
        do {
            let (data, response) = try await segmentSession.data(for: segmentDownloadRequest(for: url))
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 200
            guard (200...299).contains(statusCode) else {
                handleSegmentSettled(itemId: itemId, planIndex: entry.index, localName: entry.localName, remoteUrl: entry.remoteUrl, success: false, detail: "HTTP \(statusCode)")
                return
            }
            let destination = itemDirURL(itemId).appendingPathComponent(entry.localName)
            do {
                try? fileManager.removeItem(at: destination)
                try data.write(to: destination, options: .atomic)
                handleSegmentSettled(itemId: itemId, planIndex: entry.index, localName: entry.localName, remoteUrl: entry.remoteUrl, success: true)
            } catch {
                handleSegmentSettled(itemId: itemId, planIndex: entry.index, localName: entry.localName, remoteUrl: entry.remoteUrl, success: false, detail: "write failed: \(error.localizedDescription)")
            }
        } catch {
            if error is CancellationError { return }
            let nsError = error as NSError
            if nsError.code == NSURLErrorCancelled { return } // наша же отмена (pause/cancel/delete)
            let detail = "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
            handleSegmentSettled(itemId: itemId, planIndex: entry.index, localName: entry.localName, remoteUrl: entry.remoteUrl, success: false, detail: detail)
        }
    }

    private func retryKey(_ itemId: String, _ planIndex: Int) -> String { "\(itemId)|\(planIndex)" }

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
        inFlightSegmentCounts[itemId] = max(0, (inFlightSegmentCounts[itemId] ?? 1) - 1)
        fillSegmentSlotsLocked(itemId: itemId)
        guard remaining <= 0 else { return }
        pendingPlanQueue.removeValue(forKey: itemId)
        inFlightSegmentCounts.removeValue(forKey: itemId)
        activeSegmentTasks.removeValue(forKey: itemId)
        let failed = itemHadFailure.removeValue(forKey: itemId) ?? false
        if failed {
            let reason = itemFailureDetail.removeValue(forKey: itemId)
            // Сегменты исчерпали собственные ретраи на ОДНОМ и том же
            // подписанном URL — если протух конкретно он (апстрим-CDN
            // отозвал токен раньше нашего 15-минутного кэша resolveStream,
            // а не сам источник лёг), свежий заход на entryUrl с ?fresh=1
            // (см. route.ts) обойдёт кэш и даст новый подписанный URL для
            // оставшихся файлов — уже скачанные пропустятся (fileExists).
            // Не больше одного раза за попытку — если апстрим правда
            // недоступен, второй заход тоже упадёт, и это уже финал.
            if !episodeRetriedWithFresh.contains(itemId),
               let entryUrl = items.first(where: { $0.id == itemId })?.entryUrl {
                episodeRetriedWithFresh.insert(itemId)
                let freshEntryUrl = appendingFreshFlag(entryUrl)
                Task { [weak self] in
                    await self?.runEpisodeDownload(itemId: itemId, entryUrlString: freshEntryUrl)
                }
                return
            }
            episodeRetriedWithFresh.remove(itemId)
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
            episodeRetriedWithFresh.remove(itemId)
            finishItemSuccessLockedFromAsync(itemId)
        }
    }

    private func appendingFreshFlag(_ urlString: String) -> String {
        guard var components = URLComponents(string: urlString) else { return urlString }
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "fresh", value: "1"))
        components.queryItems = queryItems
        return components.url?.absoluteString ?? urlString
    }

    /// Обрабатывает результат одной попытки скачивания файла — до 3 попыток,
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
                let entry = DownloadPlanEntry(index: planIndex, remoteUrl: remoteUrl, localName: localName)
                let task = Task { [weak self] in
                    guard let self else { return }
                    await self.runSegmentDownload(itemId: itemId, entry: entry, url: url)
                }
                self.activeSegmentTasks[itemId, default: []].append(task)
                return // ещё одна попытка в полёте — не settle
            }
            self.retryCounts.removeValue(forKey: key)
            self.settleSegmentLocked(itemId: itemId, success: false, detail: detail)
        }
    }
}
