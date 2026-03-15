# Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all CRITICAL, HIGH, MEDIUM, and LOW security/privacy findings identified in the Boxster986OBD repository audit.

**Architecture:** All changes are isolated to config files, `App.tsx`, `assets/index.html`, `AppHtml.js`, and CI workflow. No architectural changes to the app logic. Git history rewriting (CRIT-1/CRIT-2) requires `git filter-repo` and is documented separately as a manual step.

**Tech Stack:** React Native 0.84, TypeScript, Android (Kotlin), iOS (Swift), GitHub Actions

---

## Files Modified

| File | Change |
|------|--------|
| `.gitignore` | Remove debug.keystore exception; add `.env*`, secrets, firebase configs |
| `android/app/src/main/AndroidManifest.xml` | Remove `usesCleartextTraffic` |
| `App.tsx` | Fix WebView props; add OBD command whitelist; add bridge message validation |
| `assets/index.html` | Replace hardcoded MAC address |
| `AppHtml.js` | Replace hardcoded MAC address (mirrors index.html) |
| `ios/Boxster986OBD/Info.plist` | Add location permission description |
| `package.json` | Pin bluetooth RC dep exactly; update prettier |
| `android/app/proguard-rules.pro` | Add React Native keep rules |
| `.github/workflows/ci.yml` | Add keystore cleanup step |

---

## Task 1: Fix .gitignore + Untrack Sensitive Files (CRIT-1, CRIT-2, MED-4)

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update .gitignore**

Replace current content with:

```gitignore
# Release signing — never commit keystores or credentials
*.keystore
*.jks

# Firebase / Google services configs
google-services.json
GoogleService-Info.plist

# Environment / secrets
.env
.env.local
.env.*.local
*.pem
*.key
*.p12
*.p8

node_modules/
android/app/build/
android/app/.cxx/
android/build/
android/.gradle/
android/local.properties
.metro-health-check*
.idea/
*.orig.*
npm-debug.log*
yarn-error.log*
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Untrack debug.keystore and google-services.json without deleting them**

```bash
git rm --cached android/app/debug.keystore
git rm --cached android/app/google-services.json
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "security: untrack debug.keystore and google-services.json, harden .gitignore"
```

> ⚠️ **Manual step required after this PR is merged:** To fully purge these files from git history, run:
> ```bash
> pip install git-filter-repo
> git filter-repo --path android/app/debug.keystore --invert-paths
> git filter-repo --path android/app/google-services.json --invert-paths
> git push --force-with-lease
> ```
> This rewrites history and requires all collaborators to re-clone.

---

## Task 2: Fix WebView Security Configuration (HIGH-1)

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Fix WebView props**

In `App.tsx`, change the `<WebView>` component from:
```tsx
originWhitelist={['*']}
allowFileAccess={true}
allowUniversalAccessFromFileURLs={true}
mixedContentMode="always"
```
To:
```tsx
originWhitelist={['file://*']}
mixedContentMode="never"
```
(Remove `allowFileAccess` and `allowUniversalAccessFromFileURLs` entirely — defaults are safe)

- [ ] **Step 2: Commit**

```bash
git add App.tsx
git commit -m "security: harden WebView — restrict originWhitelist, remove allowUniversalAccessFromFileURLs, disable mixed content"
```

---

## Task 3: Remove Cleartext Traffic (HIGH-2)

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`

- [ ] **Step 1: Remove usesCleartextTraffic**

Remove the line `android:usesCleartextTraffic="true"` from the `<application>` element.

The `<application>` block should become:
```xml
<application
    android:name=".MainApplication"
    android:label="@string/app_name"
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:allowBackup="false"
    android:theme="@style/AppTheme"
    android:hardwareAccelerated="true">
```

> Note: If the app's WebView needs to load local HTTP resources in the future, create `res/xml/network_security_config.xml` scoped to specific domains rather than enabling cleartext globally.

- [ ] **Step 2: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml
git commit -m "security: remove usesCleartextTraffic from AndroidManifest"
```

---

## Task 4: OBD Command Whitelist + Bridge Message Validation (HIGH-3, MED-6)

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Add command validator and bridge validator to App.tsx**

Add the following helpers just above the `App` function definition:

```typescript
// Allowed OBD-II service 01 PIDs (hex) and ELM327 AT commands
const ALLOWED_PIDS = new Set([
  '0C','0D','05','04','11','0B','0F','14','42','5C',
  '03','07','01','09','0A',
]);
const AT_CMD_RE = /^AT[A-Z0-9 ]{1,20}$/i;

function isValidObdCmd(cmd: string): boolean {
  const upper = cmd.trim().toUpperCase();
  return ALLOWED_PIDS.has(upper) || AT_CMD_RE.test(upper);
}

function isValidWVMsg(m: unknown): m is WVMsg {
  if (!m || typeof m !== 'object') return false;
  const obj = m as Record<string, unknown>;
  switch (obj.type) {
    case 'SCAN':
    case 'DISCONNECT':
      return true;
    case 'CONNECT':
      return typeof obj.address === 'string' && obj.address.length > 0;
    case 'SEND_CMD':
      return typeof obj.cmd === 'string' &&
             typeof obj.tag === 'string' &&
             isValidObdCmd(obj.cmd);
    default:
      return false;
  }
}
```

- [ ] **Step 2: Apply validators in onMsg and doCmd**

In `onMsg`, replace:
```typescript
const m: WVMsg = JSON.parse(e.nativeEvent.data);
if (m.type === 'SCAN')       doScan();
```
With:
```typescript
const raw: unknown = JSON.parse(e.nativeEvent.data);
if (!isValidWVMsg(raw)) return;
const m = raw;
if (m.type === 'SCAN')       doScan();
```

In `doCmd`, add a guard at the top:
```typescript
const doCmd = useCallback(async (cmd: string, tag: string) => {
  if (!devRef.current) return;
  if (!isValidObdCmd(cmd)) return; // reject unknown commands
  // ... rest of function unchanged
```

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "security: add OBD command whitelist and WebView bridge message validation"
```

---

## Task 5: iOS Location Permission Description (MED-1)

**Files:**
- Modify: `ios/Boxster986OBD/Info.plist`

- [ ] **Step 1: Add location description**

Change:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string></string>
```
To:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Location access is required to scan for nearby Bluetooth OBD-II devices.</string>
```

- [ ] **Step 2: Commit**

```bash
git add ios/Boxster986OBD/Info.plist
git commit -m "fix: add NSLocationWhenInUseUsageDescription for App Store compliance"
```

---

## Task 6: Pin RC Dependency + Update Prettier (MED-2, LOW-1)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Pin bluetooth RC to exact version; update prettier**

In `package.json`:
- Change `"react-native-bluetooth-classic": "^1.73.0-rc.17"` → `"react-native-bluetooth-classic": "1.73.0-rc.17"` (remove `^`)
- Change `"prettier": "2.8.8"` → `"prettier": "^3.5.0"`

- [ ] **Step 2: Update prettier config if needed**

Check `.prettierrc.js` — prettier v3 may require minor config updates (e.g., `trailingComma` now defaults to `"all"`).

- [ ] **Step 3: Commit**

```bash
git add package.json .prettierrc.js
git commit -m "chore: pin bluetooth RC dep to exact version, upgrade prettier to v3"
```

---

## Task 7: Add CI Keystore Cleanup (MED-3)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add cleanup step to build-android job**

After the "Upload release APK artifact" step, add:

```yaml
      - name: Clean up keystore
        if: always()
        run: rm -f android/app/release.keystore
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "security: add always-run CI step to delete decoded keystore after build"
```

---

## Task 8: Remove Hardcoded MAC Address (MED-5)

**Files:**
- Modify: `assets/index.html`
- Modify: `AppHtml.js`

- [ ] **Step 1: Replace MAC in assets/index.html**

Find `00:1D:A5:23:8B:FC` and replace with `XX:XX:XX:XX:XX:XX`.

- [ ] **Step 2: Replace MAC in AppHtml.js**

Same replacement in `AppHtml.js` (the generated JS module mirror).

- [ ] **Step 3: Commit**

```bash
git add assets/index.html AppHtml.js
git commit -m "privacy: replace hardcoded Bluetooth MAC address with generic placeholder"
```

---

## Task 9: Add ProGuard Keep Rules (LOW-2)

**Files:**
- Modify: `android/app/proguard-rules.pro`

- [ ] **Step 1: Add React Native keep rules**

```proguard
# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }

# React Native Bluetooth Classic
-keep class com.kenjdavidson.bluetoothclassic.** { *; }

# React Native WebView
-keep class com.reactnativecommunity.webview.** { *; }

# Keep JS interface annotations
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
```

- [ ] **Step 2: Commit**

```bash
git add android/app/proguard-rules.pro
git commit -m "build: add ProGuard keep rules for React Native modules"
```

---

## Summary of Manual Steps Required

These cannot be automated via code changes and require manual action:

1. **Git history rewrite** (CRIT-1, CRIT-2): Use `git filter-repo` to purge `debug.keystore` and `google-services.json` from all historical commits, then force-push.
2. **iOS signing identity** (LOW-3): Open Xcode → Project → Signing & Capabilities → set the correct Team ID.
3. **Node version enforcement** (LOW-4): Already handled — CI uses `node-version-file: .nvmrc`.
4. **Stable bluetooth dep** (MED-2): Monitor https://github.com/kenjdavidson/react-native-bluetooth-classic for a stable release.
