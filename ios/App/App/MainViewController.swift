import Capacitor

// Локальные (не npm) Capacitor-плагины (OfflineDownloadPlugin,
// ExternalDisplayPlugin) никогда не попадают в
// ios/App/App/capacitor.config.json → packageClassList — этот файл
// перегенерирует `cap sync` по установленным npm-пакетам плагинов (сейчас
// там только "CAPNetworkPlugin"), он не знает про Swift-файлы, добавленные
// вручную прямо в таргет приложения. Из-за этого
// CapacitorBridge.registerPlugins() (node_modules/@capacitor/ios/.../
// CapacitorBridge.swift) их не находит через NSClassFromString,
// JSExport.exportJS для них не вызывается, window.Capacitor.PluginHeaders
// не получает про них запись — и любой вызов с сайта падает с "X" plugin is
// not implemented on ios, независимо от того, насколько чистая сборка.
// Официальный путь для локальных плагинов — вручную зарегистрировать
// инстанс в capacitorDidLoad(), см. открытый метод
// CAPBridgeViewController.capacitorDidLoad().
final class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OfflineDownloadPlugin())
        bridge?.registerPluginInstance(ExternalDisplayPlugin())
    }
}
