import SwiftUI

/// Нативная вкладка «Загрузки» в таб-баре (см. SceneDelegate.swift) — не
/// зависит от сети и от WebView с сайтом. Показывает очередь/скачанный
/// контент; сама загрузка ставится в очередь с сайта кнопкой «Скачать» (см.
/// DownloadPicker.tsx), тут только просмотр прогресса, управление и
/// офлайн-воспроизведение.
struct DownloadsView: View {
    @StateObject private var viewModel = DownloadsViewModel()

    var body: some View {
        NavigationView {
            Group {
                if !viewModel.isAuthed {
                    emptyState(
                        systemImage: "lock",
                        title: "Войдите на сайте",
                        subtitle: "Загрузки доступны только авторизованным пользователям — войдите на вкладке MediaWatch"
                    )
                } else if viewModel.items.isEmpty {
                    emptyState(
                        systemImage: "arrow.down.circle",
                        title: "Пока ничего не скачано",
                        subtitle: "Откройте фильм, сериал или аниме на вкладке MediaWatch и нажмите «Скачать»"
                    )
                } else {
                    list
                }
            }
            .navigationTitle("Загрузки")
        }
        .navigationViewStyle(.stack)
        .onAppear { viewModel.reload() }
    }

    private var list: some View {
        List {
            Section {
                ForEach(viewModel.items) { item in
                    row(for: item)
                }
            } footer: {
                Text(storageSummaryText)
            }
        }
        .listStyle(.insetGrouped)
    }

    private var storageSummaryText: String {
        "Занято: \(Self.formatBytes(viewModel.usedBytes)) · Свободно: \(Self.formatBytes(viewModel.freeBytes))"
    }

    @ViewBuilder
    private func row(for item: DownloadItem) -> some View {
        if item.status == .completed {
            NavigationLink(destination: DownloadPlayerView(item: item).navigationBarTitleDisplayMode(.inline).ignoresSafeArea()) {
                rowContent(for: item)
            }
            .swipeActions(edge: .trailing) {
                Button(role: .destructive) { viewModel.delete(item) } label: {
                    Label("Удалить", systemImage: "trash")
                }
            }
        } else {
            rowContent(for: item)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { viewModel.cancel(item) } label: {
                        Label(item.status == .failed ? "Удалить" : "Отменить", systemImage: "trash")
                    }
                    if item.status == .downloading || item.status == .queued {
                        Button { viewModel.pause(item) } label: {
                            Label("Пауза", systemImage: "pause")
                        }
                        .tint(.orange)
                    } else if item.status == .paused || item.status == .failed {
                        Button { viewModel.resume(item) } label: {
                            Label("Продолжить", systemImage: "play")
                        }
                        .tint(.accentColor)
                    }
                }
        }
    }

    private func rowContent(for item: DownloadItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.title)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(1)
            Text("\(item.episodeLabel) · \(item.translationTitle)")
                .font(.caption)
                .foregroundColor(.secondary)
            statusRow(for: item)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func statusRow(for item: DownloadItem) -> some View {
        switch item.status {
        case .completed:
            Label("Скачано", systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundColor(.green)
        case .failed:
            Label(item.errorMessage ?? "Ошибка загрузки", systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundColor(.red)
        case .paused:
            Label("На паузе", systemImage: "pause.circle")
                .font(.caption)
                .foregroundColor(.secondary)
        case .queued:
            Label("В очереди", systemImage: "clock")
                .font(.caption)
                .foregroundColor(.secondary)
        case .downloading:
            VStack(alignment: .leading, spacing: 2) {
                ProgressView(value: item.progress)
                Text(item.totalSegments > 0 ? "\(item.completedSegments)/\(item.totalSegments)" : "Подготовка…")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
    }

    private func emptyState(systemImage: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }

    private static func formatBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
