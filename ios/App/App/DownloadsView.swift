import SwiftUI

/// Цвета в точности как на сайте (см. tailwind.config.ts: bg/bg-soft/
/// bg-card/accent) — раньше вкладка «Загрузки» просто наследовала системные
/// цвета SwiftUI (в т.ч. системную светлую/тёмную тему телефона, см.
/// overrideUserInterfaceStyle в SceneDelegate.swift) и рядом с постоянно
/// тёмным сайтом в соседней вкладке смотрелась чужеродно — не тот шрифт
/// акцента, не тот тон карточек, стандартный список вместо карточек.
private enum Theme {
    static let background = Color.black
    static let card = Color(red: 0x1d / 255, green: 0x1d / 255, blue: 0x1f / 255)
    static let soft = Color(red: 0x15 / 255, green: 0x15 / 255, blue: 0x17 / 255)
    static let accent = Color(red: 0x29 / 255, green: 0x97 / 255, blue: 0xff / 255)
    static let border = Color.white.opacity(0.08)
    static let textSecondary = Color.white.opacity(0.55)
    static let textTertiary = Color.white.opacity(0.38)
    static let success = Color(red: 0x34 / 255, green: 0xd3 / 255, blue: 0x99 / 255)
    static let danger = Color(red: 1, green: 0x45 / 255, blue: 0x45 / 255)
}

/// Нативная вкладка «Загрузки» в таб-баре (см. SceneDelegate.swift) — не
/// зависит от сети и от WebView с сайтом. Показывает очередь/скачанный
/// контент; сама загрузка ставится в очередь с сайта кнопкой «Скачать» (см.
/// DownloadPicker.tsx), тут только просмотр прогресса, управление и
/// офлайн-воспроизведение.
struct DownloadsView: View {
    @StateObject private var viewModel = DownloadsViewModel()

    init() {
        // List работает через UITableView под капотом — .scrollContentBackground
        // (снимает системный фон таблицы штатно) появился только в iOS 16, а
        // минимум проекта — 15.0 (см. IPHONEOS_DEPLOYMENT_TARGET), поэтому фон
        // глушим через appearance-прокси. Единственный List во всём нативном
        // коде (см. grep по "List" в ios/App/App) — конфликтов с другими
        // экранами нет. Заодно красим сам навбар в цвета сайта, а не в
        // системный тёмно-серый.
        UITableView.appearance().backgroundColor = .clear
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = .black
        navAppearance.titleTextAttributes = [.foregroundColor: UIColor.white]
        navAppearance.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance
    }

    var body: some View {
        NavigationView {
            ZStack {
                Theme.background.ignoresSafeArea()
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
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                }
            } footer: {
                Text(storageSummaryText)
                    .foregroundColor(Theme.textSecondary)
            }
        }
        .listStyle(.plain)
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
                        .tint(Theme.accent)
                    }
                }
        }
    }

    private func rowContent(for item: DownloadItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            poster(for: item)
            VStack(alignment: .leading, spacing: 4) {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Text("\(item.episodeLabel) · \(item.translationTitle)")
                    .font(.caption)
                    .foregroundColor(Theme.textSecondary)
                    .lineLimit(1)
                statusRow(for: item)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.border, lineWidth: 1)
        )
    }

    private func poster(for item: DownloadItem) -> some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Theme.soft)
            .frame(width: 48, height: 68)
            .overlay {
                if let urlString = item.posterUrl, let url = URL(string: urlString) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: .fill)
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder
    private func statusRow(for item: DownloadItem) -> some View {
        switch item.status {
        case .completed:
            Label("Скачано", systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundColor(Theme.success)
        case .failed:
            Label(item.errorMessage ?? "Ошибка загрузки", systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundColor(Theme.danger)
                .lineLimit(1)
        case .paused:
            Label("На паузе", systemImage: "pause.circle")
                .font(.caption)
                .foregroundColor(Theme.textSecondary)
        case .queued:
            Label("В очереди", systemImage: "clock")
                .font(.caption)
                .foregroundColor(Theme.textSecondary)
        case .downloading:
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: item.progress)
                    .tint(Theme.accent)
                Text(item.totalSegments > 0 ? "\(item.completedSegments)/\(item.totalSegments)" : "Подготовка…")
                    .font(.caption2)
                    .foregroundColor(Theme.textTertiary)
            }
        }
    }

    private func emptyState(systemImage: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 40))
                .foregroundColor(Theme.textSecondary)
            Text(title)
                .font(.headline)
                .foregroundColor(.white)
            Text(subtitle)
                .font(.subheadline)
                .foregroundColor(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
    }

    private static func formatBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
