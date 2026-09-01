/**
 * Hunterstar Bridge — JS ↔ Android Native Promise API
 * 
 * This file wraps the raw @JavascriptInterface object (window.AndroidRaw)
 * exposed by AndroidBridge.kt into a clean, Promise-based API accessible
 * via `window.Android`.
 * 
 * Usage:
 *   const result = await Android.authenticate("Unlock Admin Panel");
 *   Android.vibrate(50);
 *   Android.showToast("Hello from JS!");
 * 
 * Architecture:
 *   JS calls Android.method() → generates callbackId → calls AndroidRaw.method(callbackId, ...)
 *   Kotlin executes native work → calls evaluateJavascript("window.__bridgeCallbacks[id].resolve(data)")
 *   Promise resolves in JS → callback map entry cleaned up
 * 
 * @author Hunterstar
 * @version 1.0.0
 */

(function () {
  'use strict';

  // ── Guard: only run inside the Android WebView ──────────────────────
  if (typeof window.AndroidRaw === 'undefined') {
    // Not running in the hybrid app — expose a no-op stub so website code
    // can safely call Android.method() without crashing in a browser.
    window.Android = new Proxy({}, {
      get: function (_target, prop) {
        if (prop === '__isNative') return false;
        return function () {
          console.warn('[Hunterstar Bridge] Not running in Android app. ' +
            'Call to Android.' + String(prop) + '() ignored.');
          return Promise.resolve(null);
        };
      }
    });
    return;
  }

  // ── Callback registry ──────────────────────────────────────────────
  var _callbackId = 0;
  window.__bridgeCallbacks = {};

  /**
   * Create a Promise that registers resolve/reject callbacks under a
   * unique callbackId. The native side calls
   *   window.__bridgeCallbacks[id].resolve(data)
   * or
   *   window.__bridgeCallbacks[id].reject(error)
   * to settle the Promise.
   */
  function nativeCall(methodName, args) {
    return new Promise(function (resolve, reject) {
      var id = 'cb_' + (++_callbackId) + '_' + Date.now();

      // Timeout safety — reject if native never responds (30s)
      var timer = setTimeout(function () {
        if (window.__bridgeCallbacks[id]) {
          delete window.__bridgeCallbacks[id];
          reject(new Error('[Bridge] Timeout: ' + methodName + ' did not respond within 30s'));
        }
      }, 30000);

      window.__bridgeCallbacks[id] = {
        resolve: function (data) {
          clearTimeout(timer);
          delete window.__bridgeCallbacks[id];
          resolve(data);
        },
        reject: function (error) {
          clearTimeout(timer);
          delete window.__bridgeCallbacks[id];
          reject(new Error(error || 'Unknown native error'));
        }
      };

      try {
        // Build argument list: [callbackId, ...userArgs]
        var nativeArgs = [id].concat(args || []);
        var fn = window.AndroidRaw[methodName];
        if (typeof fn !== 'function') {
          throw new Error('AndroidRaw.' + methodName + ' is not a function');
        }
        fn.apply(window.AndroidRaw, nativeArgs);
      } catch (err) {
        clearTimeout(timer);
        delete window.__bridgeCallbacks[id];
        reject(err);
      }
    });
  }

  // ── Public API surface ─────────────────────────────────────────────
  window.Android = {

    /** Marker to detect native environment */
    __isNative: true,

    /**
     * Show an Android system toast message.
     * @param {string} msg - Message text (max 200 characters)
     * @returns {Promise<void>}
     */
    showToast: function (msg) {
      return nativeCall('showToast', [String(msg)]);
    },

    /**
     * Trigger haptic vibration feedback.
     * @param {number} ms - Duration in milliseconds (1–5000)
     * @returns {Promise<void>}
     */
    vibrate: function (ms) {
      return nativeCall('vibrate', [Number(ms) || 50]);
    },

    /**
     * Open the native Android share sheet.
     * @param {string} text  - Content to share
     * @param {string} title - Title for the share chooser
     * @returns {Promise<void>}
     */
    share: function (text, title) {
      return nativeCall('share', [String(text), String(title || 'Hunterstar')]);
    },

    /**
     * Download a file using DownloadManager with progress notification.
     * @param {string} url      - HTTPS URL of the file
     * @param {string} filename - Destination filename
     * @returns {Promise<string>} Download ID
     */
    download: function (url, filename) {
      return nativeCall('download', [String(url), String(filename)]);
    },

    /**
     * Trigger biometric (fingerprint/face) authentication.
     * @param {string} promptTitle - Title shown on the biometric prompt
     * @returns {Promise<string>} "true" on success
     */
    authenticate: function (promptTitle) {
      return nativeCall('authenticate', [String(promptTitle || 'Verify Identity')]);
    },

    /**
     * Toggle FLAG_SECURE to block screenshots and screen recording.
     * @param {boolean} enabled - true to enable, false to disable
     * @returns {Promise<void>}
     */
    setSecureMode: function (enabled) {
      return nativeCall('setSecureMode', [!!enabled]);
    },

    /**
     * Get the current battery level as a percentage.
     * @returns {Promise<number>} Battery percentage (0–100)
     */
    getBatteryLevel: function () {
      return nativeCall('getBatteryLevel', []).then(function (val) {
        return Number(val);
      });
    },

    /**
     * Get device hardware and software information.
     * @returns {Promise<Object>} { model, manufacturer, androidVersion, sdkVersion, appVersion }
     */
    getDeviceInfo: function () {
      return nativeCall('getDeviceInfo', []).then(function (json) {
        try { return JSON.parse(json); } catch (_e) { return json; }
      });
    },

    /**
     * Open this app's system settings page (permissions, storage, etc.).
     * @returns {Promise<void>}
     */
    openSettings: function () {
      return nativeCall('openSettings', []);
    }
  };

  // Freeze the API to prevent tampering
  Object.freeze(window.Android);

  console.log('%c⚡ Hunterstar Bridge v1.0.0 loaded',
    'color: #cc1111; font-weight: bold; font-size: 14px;');

})();
