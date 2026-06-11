/**
 * Smart Multi-Copy Highlight - Background Service Worker
 * 
 * Manages active/inactive state globally and per tab, updates extension toolbar icons,
 * handles tab actions/events, and coordinates zoom factor changes.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

  // ==========================================
  // CONSTANTS & CONFIGURATION
  // ==========================================

  const ICON_ACTIVE_PATH = {
    "16": "icon_active_16.png",
    "32": "icon_active_32.png",
    "48": "icon_active_48.png",
    "128": "icon_active_128.png"
  };

  const ICON_INACTIVE_PATH = {
    "16": "icon_inactive_16.png",
    "32": "icon_inactive_32.png",
    "48": "icon_inactive_48.png",
    "128": "icon_inactive_128.png"
  };

  // ==========================================
  // CHROME API SAFE WRAPPERS
  // ==========================================

  /**
   * Safe wrapper for chrome.action.setIcon to handle runtime errors gracefully.
   * @param {Object} details - Icon configuration object.
   */
  const setExtensionIcon = (details) => {
    chrome.action.setIcon(details, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.debug(`[Background] Failed to set icon: ${err.message}`);
      }
    });
  };

  /**
   * Safe wrapper for chrome.action.setBadgeText to handle runtime errors gracefully.
   * @param {Object} details - Badge text configuration object.
   */
  const setExtensionBadgeText = (details) => {
    chrome.action.setBadgeText(details, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.debug(`[Background] Failed to set badge text: ${err.message}`);
      }
    });
  };

  // ==========================================
  // ACTION ICON STATE UPDATER
  // ==========================================

  /**
   * Updates the extension action icon (active color vs grayscale) and clears badge text for a tab.
   * @param {number} [tabId] - ID of the tab to update.
   */
  const updateActionStateForTab = (tabId) => {
    chrome.storage.local.get({
      enabled: true,
      mode: "global",
      activeTabIds: {}
    }, (data) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.error(`[Background] Storage read error: ${err.message}`);
        return;
      }

      // Clear any text badges to keep the toolbar layout clean
      setExtensionBadgeText({ text: "" });

      if (!data.enabled) {
        // Globally disabled: Force global icon to grayscale
        setExtensionIcon({ path: ICON_INACTIVE_PATH });
        if (tabId) {
          setExtensionIcon({ path: ICON_INACTIVE_PATH, tabId });
        }
      } else if (data.mode === "global") {
        // Globally active: Force global icon to colored active state
        setExtensionIcon({ path: ICON_ACTIVE_PATH });
        if (tabId) {
          setExtensionIcon({ path: ICON_ACTIVE_PATH, tabId });
        }
      } else {
        // Tab-specific mode: Default global icon to grayscale
        setExtensionIcon({ path: ICON_INACTIVE_PATH });

        // Set specific active/grayscale status for current tab
        if (tabId) {
          const isTabActive = !!data.activeTabIds[tabId];
          setExtensionIcon({
            path: isTabActive ? ICON_ACTIVE_PATH : ICON_INACTIVE_PATH,
            tabId
          });
        }
      }
    });
  };

  // ==========================================
  // RUNTIME LIFECYCLE LISTENERS
  // ==========================================

  // Set default configurations upon installation
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get({
      enabled: true,
      mode: "global",
      activeTabIds: {}
    }, (data) => {
      if (chrome.runtime.lastError) return;
      chrome.storage.local.set({
        enabled: data.enabled,
        mode: data.mode,
        activeTabIds: data.activeTabIds
      });
    });
  });

  // Purge tab active configurations when a tab is destroyed
  chrome.tabs.onRemoved.addListener((tabId) => {
    chrome.storage.local.get({ activeTabIds: {} }, (data) => {
      if (chrome.runtime.lastError) return;
      if (data.activeTabIds[tabId] !== undefined) {
        const newActiveTabIds = { ...data.activeTabIds };
        delete newActiveTabIds[tabId];
        chrome.storage.local.set({ activeTabIds: newActiveTabIds });
      }
    });
  });

  // Re-sync icon status when active tab changes
  chrome.tabs.onActivated.addListener((activeInfo) => {
    updateActionStateForTab(activeInfo.tabId);
  });

  // Re-sync icon status when tab updates loading state
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      updateActionStateForTab(tabId);
    }
  });

  // Re-sync status when local storage configurations update
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return;
        if (tabs[0]) {
          updateActionStateForTab(tabs[0].id);
        }
      });
    }
  });

  // ==========================================
  // CROSS-SCRIPT MESSAGE DISPATCHERS
  // ==========================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Return sender tab details
    if (request.action === "getTabInfo") {
      sendResponse({ tabId: sender.tab?.id });
      return false;
    }

    // Retrieve active zoom level for a tab
    if (request.action === "getZoom") {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ zoom: 1 });
        return false;
      }
      chrome.tabs.getZoom(tabId, (zoom) => {
        sendResponse({ zoom: zoom || 1 });
      });
      return true; // Indicates asynchronous response
    }

    // Check if copy services are active for a tab
    if (request.action === "checkActive") {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ isActive: false });
        return false;
      }

      chrome.storage.local.get({
        enabled: true,
        mode: "global",
        activeTabIds: {}
      }, (data) => {
        if (chrome.runtime.lastError) {
          sendResponse({ isActive: false });
          return;
        }
        
        if (!data.enabled) {
          sendResponse({ isActive: false });
        } else if (data.mode === "global") {
          sendResponse({ isActive: true });
        } else {
          sendResponse({ isActive: !!data.activeTabIds[tabId] });
        }
      });
      return true; // Indicates asynchronous response
    }
  });

  // Sync zoom factor changes dynamically across pages
  chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
    chrome.tabs.sendMessage(zoomChangeInfo.tabId, {
      action: "zoomUpdated",
      zoom: zoomChangeInfo.newZoomFactor
    }, () => {
      // Catch error dynamically if tab doesn't have active content script
      const err = chrome.runtime.lastError;
    });
  });

  // Connection port handler for content script orphan monitoring
  chrome.runtime.onConnect.addListener((port) => {
    // Kept open to track connection liveness
  });

  // Synchronize state for the currently active tab on worker startup
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    if (tabs[0]) {
      updateActionStateForTab(tabs[0].id);
    }
  });
})();