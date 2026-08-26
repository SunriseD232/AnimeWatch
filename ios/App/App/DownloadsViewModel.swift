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
        observers.append(center.addObserver(forName: .offlineDownloadAuthStateChanged, object: nil, queue: .main) { [weak self] _ in
            self?.isAuthed = OfflineDownloadManager.shared.isAuthed
        })
        // offlineDownloadItemsChanged шлётся менеджером на КАЖДЫЙ скачанный
        // сегмент (прогресс) — при сотнях сегментов на серию это может
        // прилетать несколько раз в секунду; getStorageInfo() внутри reload()
        // делает полный обход файлов на диске, поэтому схлопываем частые
        // вызовы в один через короткий дебаунс вместо reload() на каждое
        // уведомление.
        observers.append(center.addObserver(forName: .offlineDownloadItemsChanged, object: nil, queue: .main) { [weak self] _ in
            self?.scheduleReload()
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
    /// закачке это несколько раз в секунду). Пока библиотека небольшая, один
    /// обход укладывается в 0.3с и всё в порядке; по мере роста библиотеки
    /// (десятки серий, тысячи файлов) один обход начинает занимать ДОЛЬШЕ
    /// интервала дебаунса — новые обходы запускались поверх ещё не
    /// завершившихся, без всякого ограничения на конкурентность, насыщая
    /// I/O и пул фоновых потоков GCD ровно теми же дисковыми операциями,
    /// что нужны самой закачке (запись сегментов) — воспроизведено вживую
    /// 2026-08-26: чем больше уже скачано, тем быстрее новая закачка вешала
    /// приложение намертво (и дальше — watchdog kill). Не даём второму
    /// обходу стартовать, пока не завершился первый, и не чаще, чем раз в
    /// storageInfoMinInterval — точные до байта цифры на экране загрузок не
    /// нужны, важно не блокировать сам процесс закачки.
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
