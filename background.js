/**
 * Smart Multi-Copy Highlight - Background Service Worker
 * Manages active/inactive state globally and per tab, and updates action icons.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

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

  /**
   * Safe wrapper for chrome.action.setIcon to handle runtime errors gracefully
   * @param {Object} details 
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
   * Safe wrapper for chrome.action.setBadgeText to handle runtime errors gracefully
   * @param {Object} details 
   */
  const setExtensionBadgeText = (details) => {
    chrome.action.setBadgeText(details, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.debug(`[Background] Failed to set badge text: ${err.message}`);
      }
    });
  };

  /**
   * Updates the visual extension icon (colored/grayscale) and clears badge text for a tab.
   * @param {number} [tabId] - ID of the tab to check.
   */
  const updateBadgeForTab = (tabId) => {
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

      // Clear any text badges to keep the toolbar clean
      setExtensionBadgeText({ text: "" });

      if (!data.enabled) {
        // Globally disabled: Set global icon to grayscale
        setExtensionIcon({ path: ICON_INACTIVE_PATH });
        if (tabId) {
          setExtensionIcon({ path: ICON_INACTIVE_PATH, tabId });
        }
      } else if (data.mode === "global") {
        // Globally enabled: Set global icon to active (colored)
        setExtensionIcon({ path: ICON_ACTIVE_PATH });
        if (tabId) {
          setExtensionIcon({ path: ICON_ACTIVE_PATH, tabId });
        }
      } else {
        // Tab mode: Set default global icon to grayscale
        setExtensionIcon({ path: ICON_INACTIVE_PATH });

        // Set specific tab icon based on its active state
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

  // Initialize default status on installation
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

  // Clean up tab active status when a tab is closed
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

  // Update icon when tab is switched
  chrome.tabs.onActivated.addListener((activeInfo) => {
    updateBadgeForTab(activeInfo.tabId);
  });

  // Update icon when a tab finished loading
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      updateBadgeForTab(tabId);
    }
  });

  // Sync icon instantly when local storage changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) return;
        if (tabs[0]) {
          updateBadgeForTab(tabs[0].id);
        }
      });
    }
  });

  // Handle keaktifan checks from content scripts
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
      return true; // Keep the response channel open for async response
    }
  });

  // Initial update for the currently active tab on startup
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    if (tabs[0]) {
      updateBadgeForTab(tabs[0].id);
    }
  });
})();