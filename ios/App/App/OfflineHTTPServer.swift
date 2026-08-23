import Foundation
import ReadiumGCDWebServer

/// AVPlayer принципиально не умеет играть HLS-плейлисты (.m3u8) напрямую с
/// локальной файловой системы (file://) — подтверждено инженером Apple на
/// официальном форуме разработчиков (developer.apple.com/forums/thread/69357):
/// "You can't get m3u8 from the local filesystem. HTTP Live Streaming (HLS -
/// the protocol built around m3u8s) does not let you get the content from
/// the local filesystem." Раньше именно это (не CMAF, не сегменты — они были
/// в полном порядке) давало CoreMediaErrorDomain -12865 на КАЖДОЙ офлайн-
/// загрузке — проверено вживую 2026-08-23 на заведомо корректном плейлисте
/// (464 честных MPEG-TS сегмента без шифрования, без CMAF).
///
/// Раздаём уже скачанные файлы через loopback HTTP — с точки зрения AVPlayer
/// это обычный сетевой HLS-источник, просто указывающий на 127.0.0.1: вся
/// уже отлаженная логика скачивания (throttling/ретраи/резюме/CMAF) в
/// OfflineDownloadManager остаётся как есть, меняется только то, как готовые
/// файлы отдаются плееру.
///
/// Альтернатива на будущее (не выбрана сейчас — потребовала бы переписать
/// OfflineDownloadManager с нуля под другой API) — AVAssetDownloadURLSession,
/// официальный путь Apple для офлайн HLS, где закачкой управляет сам
/// AVFoundation, а не наш код.
final class OfflineHTTPServer {
    static let shared = OfflineHTTPServer()

    private let server = ReadiumGCDWebServer()
    private var isRunning = false

    private init() {}

    /// Поднимает сервер (если ещё не поднят) на 127.0.0.1, раздающий
    /// downloadsRootURL целиком — так один сервер обслуживает все офлайн-
    /// загрузки сразу, не только текущую. allowRangeRequests — обязательно
    /// для HLS: AVPlayer запрашивает файлы Range-кусками даже локально.
    /// Порт 0 — просим систему выбрать свободный, читаем реальный из
    /// server.port после успешного старта.
    @discardableResult
    func ensureRunning() -> UInt? {
        if isRunning { return server.port }
        server.addGETHandler(
            forBasePath: "/",
            directoryPath: OfflineDownloadManager.shared.downloadsRootURL.path,
            indexFilename: nil,
            cacheAge: 0,
            allowRangeRequests: true
        )
        do {
            // AutomaticallySuspendInBackground не трогаем — дефолт (авто-
            // suspend/resume вместе с фоном/активностью приложения) полностью
            // устраивает: воспроизведение и так только на переднем плане.
            try server.start(options: [
                ReadiumGCDWebServerOption_Port: 0,
                ReadiumGCDWebServerOption_BindToLocalhost: true,
            ])
            isRunning = true
            return server.port
        } catch {
            return nil
        }
    }
}
