/**
 * Smart Multi-Copy Highlight - Popup Script
 * Mengontrol logika tampilan antrean teks, aksi salin, dan manajemen mode keaktifan (Global/Per-Tab/Off).
 * 
 * Crafted by lncln
 */

document.addEventListener("DOMContentLoaded", () => {
  const listContainer = document.getElementById("listContainer");
  const clearBtn = document.getElementById("clearBtn");
  const copyAllBtn = document.getElementById("copyAllBtn");
  const globalStatus = document.getElementById("globalStatus");
  
  // Element kontrol mode
  const modeGlobal = document.getElementById("modeGlobal");
  const modeTab = document.getElementById("modeTab");
  const modeOff = document.getElementById("modeOff");
  const tabStatusCard = document.getElementById("tabStatusCard");
  const tabToggle = document.getElementById("tabToggle");
  const tabUrlDesc = document.getElementById("tabUrlDesc");

  // Dapatkan detail tab saat ini untuk kontrol status per-tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (!currentTab) return;
    const tabId = currentTab.id;

    // Tampilkan alamat host/judul tab saat ini pada kartu per-tab
    try {
      const urlObj = new URL(currentTab.url);
      tabUrlDesc.innerText = urlObj.hostname || currentTab.title || "Tab saat ini";
    } catch (e) {
      tabUrlDesc.innerText = currentTab.title || "Tab saat ini";
    }

    // Memuat status konfigurasi awal dari storage
    chrome.storage.local.get({
      enabled: true,
      mode: "global",
      activeTabIds: {}
    }, (data) => {
      updateUI(data.enabled, data.mode, data.activeTabIds, tabId);
    });

    // Event handler: Pilihan Mode Semua Tab
    modeGlobal.onclick = () => {
      chrome.storage.local.set({ enabled: true, mode: "global" }, () => {
        chrome.storage.local.get(null, (data) => {
          updateUI(true, "global", data.activeTabIds, tabId);
        });
      });
    };

    // Event handler: Pilihan Mode Per Tab
    modeTab.onclick = () => {
      chrome.storage.local.get({ activeTabIds: {} }, (data) => {
        const newActiveTabIds = { ...data.activeTabIds };
        // Otomatis aktifkan tab saat ini ketika mode ini dipilih pertama kali
        newActiveTabIds[tabId] = true;
        chrome.storage.local.set({
          enabled: true,
          mode: "tab",
          activeTabIds: newActiveTabIds
        }, () => {
          updateUI(true, "tab", newActiveTabIds, tabId);
        });
      });
    };

    // Event handler: Pilihan Mode Matikan (Nonaktif)
    modeOff.onclick = () => {
      chrome.storage.local.set({ enabled: false }, () => {
        chrome.storage.local.get(null, (data) => {
          updateUI(false, data.mode, data.activeTabIds, tabId);
        });
      });
    };

    // Event handler: Switch toggle keaktifan tab saat ini
    tabToggle.onchange = () => {
      chrome.storage.local.get({ activeTabIds: {} }, (data) => {
        const newActiveTabIds = { ...data.activeTabIds };
        newActiveTabIds[tabId] = tabToggle.checked;
        chrome.storage.local.set({ activeTabIds: newActiveTabIds });
      });
    };
  });

  /**
   * Memperbarui antarmuka (UI) popup sesuai status konfigurasi aktif.
   * @param {boolean} enabled - Status aktif global.
   * @param {string} mode - Mode aktif ("global" atau "tab").
   * @param {Object} activeTabIds - Daftar ID tab yang aktif.
   * @param {number} tabId - ID tab saat ini.
   */
  function updateUI(enabled, mode, activeTabIds, tabId) {
    // Bersihkan kelas aktif dari seluruh tombol mode
    modeGlobal.classList.remove("active");
    modeTab.classList.remove("active");
    modeOff.classList.remove("active");

    if (!enabled) {
      modeOff.classList.add("active");
      globalStatus.innerText = "Inactive";
      globalStatus.classList.add("off");
      tabStatusCard.classList.add("hidden");
    } else {
      globalStatus.innerText = "Active";
      globalStatus.classList.remove("off");
      
      if (mode === "global") {
        modeGlobal.classList.add("active");
        tabStatusCard.classList.add("hidden");
      } else {
        modeTab.classList.add("active");
        tabStatusCard.classList.remove("hidden");
        // Set toggle switch tab ini sesuai statusnya di storage
        tabToggle.checked = !!activeTabIds[tabId];
      }
    }
  }

  /**
   * Me-render daftar item teks yang telah disimpan.
   */
  function renderList() {
    chrome.storage.local.get({ textList: [] }, (data) => {
      if (!listContainer) return;
      listContainer.innerHTML = "";
      
      if (data.textList.length === 0) {
        listContainer.innerHTML = "<div style='color:#888; text-align:center; padding: 10px;'>Belum ada item yang ditambahkan.</div>";
        return;
      }

      data.textList.forEach((item, index) => {
        const div = document.createElement("div");
        div.className = "text-item";

        const textSpan = document.createElement("span");
        textSpan.className = "text-content";

        // Bersihkan prefix "Source: ..." jika ada agar teks asli tampil di awal list
        const cleanText = item.plain.replace(/^Source: .*?\n/, "").trim();
        textSpan.innerText = `${index + 1}. ${cleanText}`;
        textSpan.title = cleanText;

        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.innerHTML = "×";
        delBtn.onclick = () => {
          deleteItem(index);
        };

        div.appendChild(textSpan);
        div.appendChild(delBtn);
        listContainer.appendChild(div);
      });
    });
  }

  /**
   * Menghapus item tertentu dari daftar antrean.
   * @param {number} index - Indeks item yang akan dihapus.
   */
  function deleteItem(index) {
    chrome.storage.local.get({ textList: [] }, (data) => {
      const newList = [...data.textList];
      newList.splice(index, 1);
      chrome.storage.local.set({ textList: newList }, () => {
        // Sinkronisasi clipboard sistem setelah item dihapus
        updatePopupClipboard(newList, () => {
          renderList();
        });
      });
    });
  }

  // Event handler untuk tombol hapus semua item
  if (clearBtn) {
    clearBtn.onclick = () => {
      chrome.storage.local.set({ textList: [] }, () => {
        navigator.clipboard.writeText("").then(() => {
          renderList();
        });
      });
    };
  }

  // Event handler untuk menyalin seluruh daftar antrean ke clipboard
  if (copyAllBtn) {
    copyAllBtn.onclick = () => {
      chrome.storage.local.get({ textList: [] }, (data) => {
        if (data.textList.length === 0) return;
        updatePopupClipboard(data.textList, () => {
          copyAllBtn.innerText = "Copied All Style!";
          setTimeout(() => { copyAllBtn.innerText = "Copy All"; }, 1500);
        });
      });
    };
  }

  /**
   * Menulis gabungan teks plain dan HTML ke sistem clipboard.
   * @param {Array} list - Daftar item yang disalin.
   * @param {Function} callback - Fungsi callback setelah salin berhasil.
   */
  function updatePopupClipboard(list, callback) {
    if (list.length === 0) {
      navigator.clipboard.writeText("").then(callback);
      return;
    }
    const combinedPlain = list.map(item => item.plain).join("");
    const combinedHtml = list.map(item => item.html).join("");

    const blobPlain = new Blob([combinedPlain], { type: "text/plain" });
    const blobHtml = new Blob([combinedHtml], { type: "text/html" });

    const clipboardData = [new ClipboardItem({
      "text/plain": blobPlain,
      "text/html": blobHtml
    })];

    navigator.clipboard.write(clipboardData).then(callback).catch(err => {
      console.error("Gagal memperbarui clipboard:", err);
      if (callback) callback();
    });
  }

  // Tampilkan antrean teks saat popup pertama kali dibuka
  renderList();
});