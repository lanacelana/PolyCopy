/**
 * Smart Multi-Copy Highlight - Background Service Worker
 * Mengelola siklus hidup ekstensi dan status aktif/nonaktif pada ikon.
 * 
 * Crafted by lncln
 */

// Menyetel status default 'enabled' saat ekstensi diinstal pertama kali
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ enabled: true }, (data) => {
    chrome.storage.local.set({ enabled: data.enabled });
  });
});

// Perbarui badge indikator saat startup/inisialisasi service worker
chrome.storage.local.get({ enabled: true }, (data) => {
  updateBadge(data.enabled);
});

// Pantau perubahan pada storage untuk memperbarui badge secara dinamis
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.enabled) {
    updateBadge(changes.enabled.newValue);
  }
});

/**
 * Memperbarui visual badge teks pada ikon ekstensi di toolbar.
 * @param {boolean} enabled - Status aktif/nonaktif ekstensi.
 */
function updateBadge(enabled) {
  if (enabled === false) {
    chrome.action.setBadgeText({ text: "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: "#8b2635" }); // Merah premium
  } else {
    chrome.action.setBadgeText({ text: "" }); // Sembunyikan badge jika aktif
  }
}