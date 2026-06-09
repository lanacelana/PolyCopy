/**
 * Smart Multi-Copy Highlight - Popup Script
 * Mengontrol logika tampilan antrean teks, aksi salin, dan toggle On/Off.
 * 
 * Crafted by lncln
 */

document.addEventListener("DOMContentLoaded", () => {
  const listContainer = document.getElementById("listContainer");
  const clearBtn = document.getElementById("clearBtn");
  const copyAllBtn = document.getElementById("copyAllBtn");
  const enableToggle = document.getElementById("enableToggle");
  const statusText = document.getElementById("statusText");

  // Memuat status aktif (enabled) dari penyimpanan lokal
  chrome.storage.local.get({ enabled: true }, (data) => {
    if (enableToggle) {
      enableToggle.checked = data.enabled;
    }
    updateStatusLabel(data.enabled);
  });

  // Handler saat switch toggle diaktifkan atau dinonaktifkan
  if (enableToggle) {
    enableToggle.addEventListener("change", () => {
      const isEnabled = enableToggle.checked;
      chrome.storage.local.set({ enabled: isEnabled }, () => {
        updateStatusLabel(isEnabled);
      });
    });
  }

  /**
   * Memperbarui label teks status aktif di header popup.
   * @param {boolean} isEnabled - Status aktif ekstensi.
   */
  function updateStatusLabel(isEnabled) {
    if (!statusText) return;
    if (isEnabled) {
      statusText.innerText = "Active";
      statusText.classList.add("enabled");
    } else {
      statusText.innerText = "Inactive";
      statusText.classList.remove("enabled");
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
        textSpan.innerText = `${index + 1}. ${item.plain}`;
        textSpan.title = item.plain;

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