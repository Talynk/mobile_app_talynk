import Expo
import React
import ReactAppDependencyProvider
#if canImport(Sentry)
import Sentry

private func addBootBreadcrumb(_ message: String) {
  let breadcrumb = Breadcrumb()
  breadcrumb.level = .info
  breadcrumb.category = "boot"
  breadcrumb.message = message
  SentrySDK.addBreadcrumb(breadcrumb)
}
#endif

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
#if canImport(Sentry)
    // Native-first Sentry boot capture so launch-time crashes are visible even
    // when JS has not started yet.
    SentrySDK.start { options in
      options.dsn = "https://826972301f2cf9d457818170954c4b49@o4510978923692032.ingest.de.sentry.io/4510985398452304"
      options.debug = false
      options.enableAppHangTracking = true
      options.attachStacktrace = true
      options.maxBreadcrumbs = 200
    }
    addBootBreadcrumb("native didFinishLaunching start")
#endif

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
#if canImport(Sentry)
    addBootBreadcrumb("native starting React Native factory")
#endif
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

#if canImport(Sentry)
    addBootBreadcrumb("native didFinishLaunching complete")
#endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
