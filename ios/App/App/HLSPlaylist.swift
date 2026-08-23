import Foundation

/// Чистый разбор/переписывание HLS-плейлистов для офлайн-загрузки — без
/// сети, без побочных эффектов, чтобы логику можно было проверить отдельно
/// от OfflineDownloadManager. Работает с текстом, который уже отдаёт наш
/// собственный /api/proxy (см. src/lib/extract/proxy.ts rewriteM3U8/
/// synthesizeMasterPlaylist на веб-стороне) — то есть все ссылки внутри уже
/// подписанные /api/proxy/raw (относительные или абсолютные).
enum HLSPlaylist {
    struct Variant {
        let height: Int?
        let urlLine: String
    }

    struct Segment {
        /** Сама строка #EXTINF:... как есть — переносим без изменений в
         *  локальный плейлист. */
        let extinf: String
        let uri: String
    }

    struct MediaPlaylist {
        /// Строки метаданных до первого сегмента (#EXTM3U, #EXT-X-VERSION,
        /// #EXT-X-TARGETDURATION, #EXT-X-KEY и т.п.).
        let headerLines: [String]
        /// URI ключа AES-128 из #EXT-X-KEY, если поток зашифрован.
        let keyURI: String?
        /// URI init-сегмента из #EXT-X-MAP — присутствует только у
        /// fMP4/CMAF-потоков (fragmented MP4), не у классического
        /// MPEG-TS HLS. Раньше игнорировался целиком — локальные сегменты
        /// всегда именовались .ts независимо от реального контейнера, и
        /// сам init-сегмент (moov/инициализация кодека, без него ни один
        /// fMP4-сегмент по отдельности не декодируется) вообще не
        /// скачивался — проверено вживую 2026-08-23: AVPlayer падал с
        /// CoreMediaErrorDomain -12865 ("операция не может быть завершена")
        /// на локальном плейлисте именно такого потока (Yummy/vkvideo.cloud,
        /// сегменты вида seg-N-f1-v1-a1.m4s у апстрима).
        let mapURI: String?
        let segments: [Segment]
        /// Строки после последнего сегмента (обычно #EXT-X-ENDLIST).
        let footerLines: [String]
    }

    /// true — это master-плейлист (перечисляет варианты качества через
    /// #EXT-X-STREAM-INF), а не сразу список сегментов одного качества.
    static func isMaster(_ text: String) -> Bool {
        text.contains("#EXT-X-STREAM-INF")
    }

    static func parseVariants(_ text: String) -> [Variant] {
        var variants: [Variant] = []
        var pendingHeight: Int?
        for rawLine in text.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("#EXT-X-STREAM-INF") {
                pendingHeight = extractHeight(from: line)
            } else if !line.isEmpty && !line.hasPrefix("#") {
                variants.append(Variant(height: pendingHeight, urlLine: line))
                pendingHeight = nil
            }
        }
        return variants
    }

    private static func extractHeight(from streamInfLine: String) -> Int? {
        guard let range = streamInfLine.range(of: "RESOLUTION=") else { return nil }
        let rest = streamInfLine[range.upperBound...]
        guard let xIndex = rest.firstIndex(of: "x") else { return nil }
        let heightDigits = rest[rest.index(after: xIndex)...].prefix { $0.isNumber }
        return Int(heightDigits)
    }

    /// Вариант с высотой ближе всего к targetHeight, но не выше — если все
    /// варианты выше него, берём минимальный доступный (лучше маленькое
    /// видео целиком, чем ничего не скачать). Варианты без известной высоты
    /// участвуют только если высота не известна ни у одного варианта.
    static func pickVariant(_ variants: [Variant], targetHeight: Int = 720) -> Variant? {
        guard !variants.isEmpty else { return nil }
        let withHeight = variants.filter { $0.height != nil }
        guard !withHeight.isEmpty else { return variants.first }
        let notExceeding = withHeight.filter { $0.height! <= targetHeight }
        if let best = notExceeding.max(by: { $0.height! < $1.height! }) {
            return best
        }
        return withHeight.min(by: { $0.height! < $1.height! })
    }

    /// Разбирает медиа-плейлист (список сегментов одного качества, НЕ
    /// master). Вызывающий код должен был убедиться через isMaster(), что
    /// это правильный текст.
    static func parseMediaPlaylist(_ text: String) -> MediaPlaylist {
        var headerLines: [String] = []
        var keyURI: String?
        var mapURI: String?
        var segments: [Segment] = []
        var footerLines: [String] = []
        var pendingExtinf: String?
        var seenFirstSegment = false

        for rawLine in text.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }

            if line.hasPrefix("#EXT-X-KEY") {
                if let uri = extractQuotedURI(from: line) {
                    keyURI = uri
                }
                if !seenFirstSegment { headerLines.append(line) }
                continue
            }
            if line.hasPrefix("#EXT-X-MAP") {
                if let uri = extractQuotedURI(from: line) {
                    mapURI = uri
                }
                if !seenFirstSegment { headerLines.append(line) }
                continue
            }
            if line.hasPrefix("#EXTINF") {
                pendingExtinf = line
                seenFirstSegment = true
                continue
            }
            if line.hasPrefix("#EXT-X-ENDLIST") {
                footerLines.append(line)
                continue
            }
            if line.hasPrefix("#") {
                if seenFirstSegment {
                    footerLines.append(line)
                } else {
                    headerLines.append(line)
                }
                continue
            }
            // Обычная строка — URI сегмента, следует сразу за #EXTINF.
            if let extinf = pendingExtinf {
                segments.append(Segment(extinf: extinf, uri: line))
                pendingExtinf = nil
            }
        }

        return MediaPlaylist(headerLines: headerLines, keyURI: keyURI, mapURI: mapURI, segments: segments, footerLines: footerLines)
    }

    private static func extractQuotedURI(from line: String) -> String? {
        guard let range = line.range(of: "URI=\"") else { return nil }
        let rest = line[range.upperBound...]
        guard let endQuote = rest.firstIndex(of: "\"") else { return nil }
        return String(rest[rest.startIndex..<endQuote])
    }

    /// Собирает локальный плейлист: те же #EXTINF-строки, но сегменты
    /// указывают на локальные файлы (seg00000.ts, ...) рядом с самим
    /// плейлистом, #EXT-X-KEY (если был) — на локальный key.bin.
    /// segmentFileNames должен быть той же длины и в том же порядке, что
    /// playlist.segments.
    static func buildLocalPlaylist(from playlist: MediaPlaylist, segmentFileNames: [String]) -> String {
        var lines: [String] = []
        for header in playlist.headerLines {
            if header.hasPrefix("#EXT-X-KEY") {
                lines.append(rewriteURILine(header, localURI: "key.bin"))
            } else if header.hasPrefix("#EXT-X-MAP") {
                lines.append(rewriteURILine(header, localURI: initSegmentLocalName))
            } else {
                lines.append(header)
            }
        }
        for (index, segment) in playlist.segments.enumerated() {
            lines.append(segment.extinf)
            lines.append(index < segmentFileNames.count ? segmentFileNames[index] : segment.uri)
        }
        if playlist.footerLines.contains(where: { $0.hasPrefix("#EXT-X-ENDLIST") }) {
            lines.append(contentsOf: playlist.footerLines)
        } else {
            lines.append(contentsOf: playlist.footerLines)
            lines.append("#EXT-X-ENDLIST")
        }
        return lines.joined(separator: "\n")
    }

    /// Локальное имя init-сегмента (#EXT-X-MAP) — общее между
    /// buildLocalPlaylist (переписывает ссылку в плейлисте) и
    /// OfflineDownloadManager (качает и сохраняет под этим же именем).
    static let initSegmentLocalName = "init.mp4"

    private static func rewriteURILine(_ line: String, localURI: String) -> String {
        guard let range = line.range(of: "URI=\"") else { return line }
        let rest = line[range.upperBound...]
        guard let endQuote = rest.firstIndex(of: "\"") else { return line }
        return line.replacingCharacters(in: range.upperBound..<endQuote, with: localURI)
    }
}
