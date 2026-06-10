/**
 * Config plugin: guard MainActivity.onUserLeaveHint against the React Native
 * teardown NPE.
 *
 * On Android, pressing Home / Recents triggers `Activity.onUserLeaveHint()`,
 * which React Native forwards via:
 *   ReactActivity.onUserLeaveHint() -> ReactActivityDelegate.onUserLeaveHint()
 *     -> Objects.requireNonNull(mReactDelegate).onUserLeaveHint()
 *
 * If the user leaves the app while the React delegate is being created or torn
 * down, `mReactDelegate` can be null and `Objects.requireNonNull(...)` throws a
 * fatal NullPointerException that exits the app. React Native ships this class
 * inside a prebuilt Android AAR, so it cannot be fixed with patch-package.
 *
 * This plugin overrides `onUserLeaveHint()` in the generated MainActivity and
 * wraps the super call in a try/catch so the crash can never escape. Behavior
 * is otherwise unchanged (we are not using picture-in-picture).
 */
const { withMainActivity } = require('@expo/config-plugins');

const GUARD_MARKER = 'onUserLeaveHint guard (auto-added)';

const KOTLIN_OVERRIDE = `
  // ${GUARD_MARKER}
  override fun onUserLeaveHint() {
    try {
      super.onUserLeaveHint()
    } catch (e: Throwable) {
      android.util.Log.w("MainActivity", "Ignored onUserLeaveHint crash", e)
    }
  }
`;

function addKotlinOverride(contents) {
  if (contents.includes(GUARD_MARKER) || /fun\s+onUserLeaveHint/.test(contents)) {
    return contents;
  }
  // Insert right after the MainActivity class opening brace.
  const classDeclRegex = /(class\s+MainActivity\s*:\s*ReactActivity\s*\([^)]*\)\s*\{)/;
  if (classDeclRegex.test(contents)) {
    return contents.replace(classDeclRegex, `$1\n${KOTLIN_OVERRIDE}`);
  }
  // Fallback: insert after any class MainActivity opening brace.
  const looseRegex = /(class\s+MainActivity\b[^\{]*\{)/;
  if (looseRegex.test(contents)) {
    return contents.replace(looseRegex, `$1\n${KOTLIN_OVERRIDE}`);
  }
  return contents;
}

module.exports = function withUserLeaveHintGuard(config) {
  return withMainActivity(config, (cfg) => {
    const { language } = cfg.modResults;
    if (language === 'kt') {
      cfg.modResults.contents = addKotlinOverride(cfg.modResults.contents);
    } else {
      // Java fallback (older templates).
      if (
        !cfg.modResults.contents.includes(GUARD_MARKER) &&
        !/void\s+onUserLeaveHint/.test(cfg.modResults.contents)
      ) {
        const javaOverride = `
  // ${GUARD_MARKER}
  @Override
  public void onUserLeaveHint() {
    try {
      super.onUserLeaveHint();
    } catch (Throwable e) {
      android.util.Log.w("MainActivity", "Ignored onUserLeaveHint crash", e);
    }
  }
`;
        const classRegex = /(public\s+class\s+MainActivity\b[^\{]*\{)/;
        if (classRegex.test(cfg.modResults.contents)) {
          cfg.modResults.contents = cfg.modResults.contents.replace(
            classRegex,
            `$1\n${javaOverride}`,
          );
        }
      }
    }
    return cfg;
  });
};
