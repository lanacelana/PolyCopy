/**
 * Smart Multi-Copy Highlight - Background Service Worker
 * Mengelola status aktif/nonaktif per tab maupun global, serta memperbarui badge ikon.
 * 
 * Crafted by lncln
 */

// Menyetel status default saat pertama kali diinstal
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({
    enabled: true,
    mode: "global",      // "global" = semua tab, "tab" = per tab
    activeTabIds: {}     // key-value pair: tabId -> boolean
  }, (data) => {
    chrome.storage.local.set({
      enabled: data.enabled,
      mode: data.mode,
      activeTabIds: data.activeTabIds
    });
  });
});

// Bersihkan data tab jika tab ditutup untuk menghemat memori penyimpanan
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get({ activeTabIds: {} }, (data) => {
    if (data.activeTabIds[tabId] !== undefined) {
      const newActiveTabIds = { ...data.activeTabIds };
      delete newActiveTabIds[tabId];
      chrome.storage.local.set({ activeTabIds: newActiveTabIds });
    }
  });
});

// Perbarui badge ketika pengguna berpindah tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadgeForTab(activeInfo.tabId);
});

// Perbarui badge ketika tab selesai dimuat ulang (refresh/navigasi)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    updateBadgeForTab(tabId);
  }
});

// Pantau perubahan pada storage untuk menyinkronkan badge secara instan
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        updateBadgeForTab(tabs[0].id);
      }
    });
  }
});

// Menangani pesan dari content script untuk memeriksa keaktifan tab saat ini
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "checkActive") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ isActive: false });
      return;
    }

    chrome.storage.local.get({ enabled: true, mode: "global", activeTabIds: {} }, (data) => {
      if (!data.enabled) {
        sendResponse({ isActive: false });
      } else if (data.mode === "global") {
        sendResponse({ isActive: true });
      } else {
        // Mode per-tab, periksa keaktifan tab id spesifik
        sendResponse({ isActive: !!data.activeTabIds[tabId] });
      }
    });
    return true; // Menjaga channel respons tetap terbuka secara asinkron
  }
});

/**
 * Memperbarui visual badge teks pada ikon ekstensi berdasarkan tab tertentu.
 * @param {number} tabId - ID tab yang ingin diperiksa.
 */
function updateBadgeForTab(tabId) {
  chrome.storage.local.get({ enabled: true, mode: "global", activeTabIds: {} }, (data) => {
    if (!data.enabled) {
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#8b2635" }); // Merah (Nonaktif global)
    } else if (data.mode === "global") {
      chrome.action.setBadgeText({ text: "" }); // Kosong/Aktif global
    } else {
      // Mode per-tab
      const isTabActive = !!data.activeTabIds[tabId];
      if (isTabActive) {
        chrome.action.setBadgeText({ text: "ON" });
        chrome.action.setBadgeBackgroundColor({ color: "#2d6a4f" }); // Hijau (Aktif di tab ini)
      } else {
        chrome.action.setBadgeText({ text: "OFF" });
        chrome.action.setBadgeBackgroundColor({ color: "#8a95a5" }); // Abu-abu (Nonaktif di tab ini)
      }
    }
  });
}

// Inisialisasi badge awal untuk tab aktif saat service worker berjalan
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    updateBadgeForTab(tabs[0].id);
  }
});