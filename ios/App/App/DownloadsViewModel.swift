import Foundation
import Combine

/// Мост OfflineDownloadManager -> DownloadsView. Все данные читаются
/// синхронно из менеджера (см. listDownloads/getStorageInfo) — сам менеджер
/// потокобезопасен (внутренняя serial-очередь), тут просто держим кеш для
/// SwiftUI и переподписываемся на изменения через NotificationCenter.
final class DownloadsViewModel: ObservableObject {
    @Published var isAuthed: Bool
    @Published var items: [DownloadItem] = []
    @Published var usedBytes: Int64 = 0
    @Published var freeBytes: Int64 = 0

    private var observers: [NSObjectProtocol] = []
    private var reloadWorkItem: DispatchWorkItem?
    private var storageInfoInFlight = false
    private var lastStorageInfoAt: Date = .distantPast
    private let storageInfoMinInterval: TimeInterval = 2.0

    init() {
        isAuthed = OfflineDownloadManager.shared.isAuthed
        let center = NotificationCenter.default
        // queue: nil (не .main) намеренно — все offlineDownload*-уведомления
        // шлются ИЗ OfflineDownloadManager.stateQueue (фоновая serial-
        // очередь), а observer с queue: .main регистрирует блок через
        // OperationQueue.main и в некоторых случаях синхронно ждёт его
        // выполнения (NSOperation.waitUntilFinished) — то есть пост
        // уведомления МОЖЕТ заблокировать stateQueue до тех пор, пока
        // главный поток не выполнит обработчик. Если в этот же момент
        // главный поток сам ждёт stateQueue (см. reload() -> listDownloads()
        // -> stateQueue.sync) — оба потока блокируют друг друга навсегда.
        // Пойманный вживую deadlock (App-2026-08-26-152445.ips, watchdog
        // kill 0x8BADF00D): главный поток внутри stateQueue.sync, поток
        // stateQueue — внутри NotificationCenter.post ->
        // -[NSOperation waitUntilFinished]. queue: nil выполняет блок
        // СИНХРОННО на потоке-отправителе (stateQueue) — то есть сам post
        // никогда не ждёт, а переход на главный поток делаем сами через
        // обычный (гарантированно неблокирующий) DispatchQueue.main.async.
        observers.append(center.addObserver(forName: .offlineDownloadAuthStateChanged, object: nil, queue: nil) { [weak self] _ in
            DispatchQueue.main.async {
                self?.isAuthed = OfflineDownloadManager.shared.isAuthed
            }
        })
        // offlineDownloadItemsChanged шлётся менеджером на КАЖДЫЙ скачанный
        // сегмент (прогресс) — при сотнях сегментов на серию это может
        // прилетать несколько раз в секунду; getStorageInfo() внутри reload()
        // делает полный обход файлов на диске, поэтому схлопываем частые
        // вызовы в один через короткий дебаунс вместо reload() на каждое
        // уведомление.
        observers.append(center.addObserver(forName: .offlineDownloadItemsChanged, object: nil, queue: nil) { [weak self] _ in
            DispatchQueue.main.async {
                self?.scheduleReload()
            }
        })
        reload()
    }

    deinit {
        let center = NotificationCenter.default
        for observer in observers { center.removeObserver(observer) }
    }

    private func scheduleReload() {
        reloadWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.reload() }
        reloadWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    func reload() {
        items = OfflineDownloadManager.shared.listDownloads().sorted { $0.createdAt > $1.createdAt }
        refreshStorageInfoIfDue()
    }

    /// getStorageInfo() обходит ВСЮ директорию загрузок (FileManager.enumerator
    /// по каждому файлу каждой уже скачанной серии, не только текущей) —
    /// раньше просто уносили это на фон (Task.detached), но ничего не мешало
    /// НЕСКОЛЬКИМ таким обходам идти параллельно: reload() зовётся на каждое
    /// уведомление о прогрессе (дебаунс 0.3с в scheduleReload — при активной
    /// закачке это несколько раз в секунду). Само по себе это НЕ было
    /// причиной зависания намертво (то оказалось отдельным deadlock'ом через
    /// NotificationCenter, см. комментарий у addObserver в init() — там и
    /// разбор пойманного вживую случая), но лишние параллельные обходы диска
    /// по мере роста библиотеки — реальная трата I/O и потоков GCD, которая
    /// того зависания только усугубляла бы. Не даём второму обходу
    /// стартовать, пока не завершился первый, и не чаще, чем раз в
    /// storageInfoMinInterval — точные до байта цифры на экране загрузок не
    /// нужны.
    private func refreshStorageInfoIfDue() {
        guard !storageInfoInFlight else { return }
        guard Date().timeIntervalSince(lastStorageInfoAt) >= storageInfoMinInterval else { return }
        storageInfoInFlight = true
        Task.detached(priority: .utility) { [weak self] in
            let info = OfflineDownloadManager.shared.getStorageInfo()
            await MainActor.run {
                self?.usedBytes = info.usedBytes
                self?.freeBytes = info.freeBytes
                self?.lastStorageInfoAt = Date()
                self?.storageInfoInFlight = false
            }
        }
    }

    func pause(_ item: DownloadItem) {
        OfflineDownloadManager.shared.pauseDownload(id: item.id)
    }

    func resume(_ item: DownloadItem) {
        OfflineDownloadManager.shared.resumeDownload(id: item.id)
    }

    func cancel(_ item: DownloadItem) {
        OfflineDownloadManager.shared.cancelDownload(id: item.id)
    }

    func delete(_ item: DownloadItem) {
        OfflineDownloadManager.shared.deleteDownload(id: item.id)
    }
}
