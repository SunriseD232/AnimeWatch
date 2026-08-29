package ru.mediawatch.app;

import com.getcapacitor.BridgeActivity;

/**
 * Android TV: тот же WebView-обёртка, что и на iOS (см. capacitor.config.ts)
 * — навигацию пультом (D-pad) обрабатывает не эта Activity, а сам сайт
 * (src/lib/tvNav.ts, включается по appendUserAgent "MediaWatchTV").
 *
 * Отдельно фокус на WebView вручную не запрашиваем — у Capacitor
 * initialFocus включён по умолчанию (см. Bridge.java: config.isInitialFocus()
 * true → webView.requestFocusFromTouch() при загрузке страницы), так что
 * WebView и так становится единственным сфокусированным View в Activity и
 * получает аппаратные KeyEvent (в т.ч. DPAD_UP/DOWN/LEFT/RIGHT/CENTER),
 * которые Android WebView сам транслирует странице как keydown ArrowUp/
 * ArrowDown/ArrowLeft/ArrowRight/Enter — это стандартное поведение System
 * WebView, но живьём на реальном Android TV/эмуляторе не проверялось (нет
 * устройства в среде сборки); если на практике фокус не долетает —
 * добавить сюда явный override dispatchKeyEvent/onKeyDown.
 */
public class MainActivity extends BridgeActivity {}
