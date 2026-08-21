import Foundation

/// Модели офлайн-загрузки — общие для OfflineDownloadManager/Plugin/SwiftUI.
/// Один DownloadItem = одна серия (или фильм) в одной озвучке.
struct DownloadItem: Codable, Identifiable {
    enum Status: String, Codable {
        case queued
        case downloading
        case completed
        case failed
        case paused
    }

    let id: String
    let entryUrl: String
    let contentType: String
    let contentId: Int
    let season: Int
    let episode: Int
    let translationId: Int
    let translationTitle: String
    let title: String
    let posterUrl: String?
    /// Человекочитаемая подпись — «Серия 3» / «Фильм» — собирается на JS-
    /// стороне (см. DownloadPicker.tsx), чтобы не дублировать склонения на
    /// нативной стороне.
    let episodeLabel: String

    var status: Status
    var totalSegments: Int
    var completedSegments: Int
    var errorMessage: String?
    var createdAt: Date
    /// Последняя известная позиция воспроизведения (сек) — для локального
    /// «продолжить с места» без сети; синхронизация с сервером — фаза C.
    var lastPositionSeconds: Double
    var durationSeconds: Double?

    var progress: Double {
        totalSegments > 0 ? Double(completedSegments) / Double(totalSegments) : 0
    }
}

/// Заявка на скачивание — приходит из JS (OfflineDownloadPlugin.startDownload).
struct DownloadRequest {
    let id: String
    let entryUrl: String
    let contentType: String
    let contentId: Int
    let season: Int
    let episode: Int
    let translationId: Int
    let translationTitle: String
    let title: String
    let posterUrl: String?
    let episodeLabel: String
}

/// Один файл плана скачивания серии — key.bin (index -1) или сегмент.
/// Не персистится — план каждый раз пересобирается свежим разбором
/// плейлиста (см. OfflineDownloadManager.downloadSegments): уже скачанные
/// локальные файлы просто пропускаются повторно, поэтому отдельное
/// хранилище плана на диске не нужно.
struct DownloadPlanEntry {
    let index: Int
    let remoteUrl: String
    let localName: String
}

enum DownloadError: Error {
    case badResponse
    case decode
    case noVariant
    case noSegments
}

/// Одна запись очереди офлайн-прогресса — «последнее известное» состояние
/// просмотра для (contentType, contentId), накопленное офлайн-плеером (см.
/// DownloadPlayerView, OfflineDownloadManager.saveLastPosition). Не история
/// — как и серверная watch_progress, это указатель, перезаписывается каждым
/// новым saveLastPosition; после успешной синхронизации (см.
/// /api/progress/sync, OfflineSyncTrigger.tsx) запись удаляется из очереди.
struct PendingProgressEntry: Codable {
    /// "contentType:contentId" — тот же ключ, что и в pendingProgress-словаре
    /// на диске, JS возвращает его обратно в clearSyncedProgress.
    var key: String
    var contentType: String
    var contentId: Int
    var season: Int
    var episode: Int
    var positionSeconds: Double
    var durationSeconds: Double?
    var title: String
    var posterUrl: String?
    var translationId: Int?
    var translationTitle: String?
    var updatedAt: Date
}
