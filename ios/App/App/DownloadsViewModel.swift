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
        // getStorageInfo() обходит директорией ВСЕХ загрузок через
        // FileManager.enumerator — с ростом числа скачанных сегментов (тут
        // дебаунс всё равно может звать это по нескольку раз в секунду) это
        // синхронное сканирование на главном потоке начинает не укладываться
        // в интервал дебаунса, и следующие вызовы наслаиваются друг на
        // друга — воспроизведено вживую 2026-08-21: приложение зависало
        // ближе к концу закачки серии из 257 сегментов. Считаем на фоне,
        // на главный поток возвращаемся только чтобы присвоить @Published.
        Task.detached(priority: .utility) { [weak self] in
            let info = OfflineDownloadManager.shared.getStorageInfo()
            await MainActor.run {
                self?.usedBytes = info.usedBytes
                self?.freeBytes = info.freeBytes
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
