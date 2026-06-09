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
 * Memperbarui visual ikon ekstensi (berwarna/grayscale) dan membersihkan badge teks berdasarkan tab tertentu.
 * @param {number} tabId - ID tab yang ingin diperiksa.
 */
function updateBadgeForTab(tabId) {
  chrome.storage.local.get({ enabled: true, mode: "global", activeTabIds: {} }, (data) => {
    // Hapus teks badge "OFF" atau "ON" agar tampilan toolbar bersih
    chrome.action.setBadgeText({ text: "" });

    const activePath = "icon_active.png";
    const inactivePath = "icon_inactive.png";

    if (!data.enabled) {
      // Nonaktif secara global: Setel ikon default global dan tab spesifik ke grayscale
      chrome.action.setIcon({ path: inactivePath });
      if (tabId) {
        chrome.action.setIcon({ path: inactivePath, tabId: tabId });
      }
    } else if (data.mode === "global") {
      // Aktif secara global: Setel ikon default global dan tab spesifik ke berwarna
      chrome.action.setIcon({ path: activePath });
      if (tabId) {
        chrome.action.setIcon({ path: activePath, tabId: tabId });
      }
    } else {
      // Mode per-tab: Setel ikon default global ke grayscale
      chrome.action.setIcon({ path: inactivePath });
      
      // Setel ikon spesifik untuk tab saat ini berdasarkan status aktifnya
      const isTabActive = !!data.activeTabIds[tabId];
      if (isTabActive) {
        chrome.action.setIcon({ path: activePath, tabId: tabId });
      } else {
        chrome.action.setIcon({ path: inactivePath, tabId: tabId });
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