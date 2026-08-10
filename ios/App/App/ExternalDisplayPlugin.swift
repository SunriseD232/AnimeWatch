import Foundation
import Capacitor

/// Мост JS↔native для рендера видео на внешний экран (см.
/// ExternalDisplayManager/ExternalDisplaySceneDelegate). TS-сторона —
/// src/native/externalDisplay.ts, точка вызова — src/components/OwnPlayer.tsx
/// (там, где вычисляется `src` — прямая ссылка на поток, см. комментарии в
/// OwnPlayer.tsx рядом с "Capacitor.isNativePlatform()").
@objc(ExternalDisplayPlugin)
public class ExternalDisplayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ExternalDisplayPlugin"
    public let jsName = "ExternalDisplay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isExternalScreenConnected", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        ExternalDisplayManager.shared.onConnectionChange = { [weak self] connected in
            DispatchQueue.main.async {
                self?.notifyListeners(
                    connected ? "externalScreenConnected" : "externalScreenDisconnected",
                    data: [:]
                )
            }
        }
        ExternalDisplayManager.shared.onTimeUpdate = { [weak self] position in
            DispatchQueue.main.async {
                self?.notifyListeners("timeUpdate", data: ["position": position])
            }
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let url = call.getString("url") else {
            call.reject("url is required")
            return
        }
        let startPositionSeconds = call.getDouble("startPositionSeconds") ?? 0
        ExternalDisplayManager.shared.play(urlString: url, startPositionSeconds: startPositionSeconds)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        ExternalDisplayManager.shared.stop()
        call.resolve()
    }

    @objc func isExternalScreenConnected(_ call: CAPPluginCall) {
        call.resolve(["connected": ExternalDisplayManager.shared.isExternalScreenConnected])
    }
}
