/**
 * Smart Multi-Copy Highlight - Content Script
 * Menangani pendeteksian seleksi teks (klik-drag & keyboard Ctrl+A/Cmd+A)
 * serta menampilkan antarmuka tooltip copy.
 * 
 * Crafted by lncln
 */

let currentTooltip = null;
let clipboardBuffer = { plain: "", html: "" };

// Event listener saat pengguna melepas tombol mouse (seleksi drag mouse)
document.addEventListener("mouseup", (e) => {
  if (!chrome.runtime?.id) return; 
  if (e.target.closest(".smart-copy-tooltip")) return;
  removeTooltip();

  // Kirim pesan ke background script untuk memeriksa keaktifan tab saat ini
  chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
    if (response && response.isActive) {
      const selection = window.getSelection();
      if (selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();

      if (selectedText.length > 0) {
        const container = document.createElement("div");
        container.appendChild(range.cloneContents());
        const selectedHtml = container.innerHTML;

        chrome.storage.local.get({ textList: [] }, (data) => {
          showTooltip(e.clientX + 15, e.clientY + 10, selectedText, selectedHtml, data.textList);
        });
      }
    }
  });
});

// Event listener untuk shortcut keyboard Ctrl+A / Cmd+A
document.addEventListener("keydown", (e) => {
  if (!chrome.runtime?.id) return;

  // Mendeteksi Ctrl+A atau Cmd+A (pada Mac) secara kokoh
  const isAKey = (e.key && e.key.toLowerCase() === 'a') || e.code === 'KeyA';
  if ((e.ctrlKey || e.metaKey) && isAKey) {
    removeTooltip();

    // Berikan jeda waktu agar seleksi teks selesai diperbarui oleh browser
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
        if (response && response.isActive) {
          const selection = window.getSelection();
          if (selection.rangeCount === 0) return;

          const range = selection.getRangeAt(0);
          const selectedText = selection.toString().trim();

          if (selectedText.length > 0) {
            const container = document.createElement("div");
            container.appendChild(range.cloneContents());
            const selectedHtml = container.innerHTML;

            // Mengatur posisi tooltip di tengah atas viewport (koordinat fixed)
            const tooltipWidth = 220; // Estimasi lebar minimum tooltip
            const x = (window.innerWidth / 2) - (tooltipWidth / 2);
            const y = 80; // Ditampilkan 80px di bawah batas atas viewport layar saat ini

            chrome.storage.local.get({ textList: [] }, (data) => {
              showTooltip(x, y, selectedText, selectedHtml, data.textList);
            });
          }
        }
      });
    }, 50);
  }
});

/**
 * Membuat dan menampilkan tooltip aksi copy pada koordinat tertentu.
 * @param {number} x - Posisi koordinat X halaman.
 * @param {number} y - Posisi koordinat Y halaman.
 * @param {string} plainText - Teks plain hasil seleksi.
 * @param {string} htmlText - Teks HTML hasil seleksi.
 * @param {Array} textList - Daftar item yang sudah tersimpan sebelumnya.
 */
function showTooltip(x, y, plainText, htmlText, textList) {
  currentTooltip = document.createElement("div");
  currentTooltip.className = "smart-copy-tooltip";
  currentTooltip.style.left = `${x}px`;
  currentTooltip.style.top = `${y}px`;

  // Render daftar item antrean jika ada
  if (textList.length > 0) {
    const listContainer = document.createElement("div");
    listContainer.className = "tooltip-list-container";
    let linkCounter = 0;
    let textCounter = 0;

    textList.forEach((item, index) => {
      const listItem = document.createElement("div");
      listItem.className = "tooltip-list-item";
      const itemText = document.createElement("span");
      
      // Ambil kata pertama dari teks (abaikan URL sumber jika itu bertipe link)
      const cleanText = item.plain.replace(/^Source: .*?\n/, "").trim();
      const firstWord = cleanText.split(/\s+/)[0] || "";
      const prefix = item.type === "link" ? "🔗 " : "📝 ";

      itemText.innerText = `${prefix}${firstWord}...`;
      itemText.title = cleanText;

      const btnDelete = document.createElement("button");
      btnDelete.className = "tooltip-delete-btn";
      btnDelete.innerHTML = "×";
      btnDelete.onclick = (event) => {
        event.stopPropagation();
        if (!chrome.runtime?.id) return;
        const newList = [...textList];
        newList.splice(index, 1);
        chrome.storage.local.set({ textList: newList }, () => {
          triggerClipboardUpdate(newList, true, x, y, plainText, htmlText);
        });
      };

      listItem.appendChild(itemText);
      listItem.appendChild(btnDelete);
      listContainer.appendChild(listItem);
    });
    currentTooltip.appendChild(listContainer);
  }

  const buttonRow = document.createElement("div");
  buttonRow.className = "tooltip-buttons";
  const currentUrl = window.location.href;

  // Tombol 1: Menyimpan sebagai Link (beserta sumber URL)
  const btnAddLink = document.createElement("button");
  btnAddLink.className = "btn-blue btn-pill";
  btnAddLink.innerHTML = "Link It";
  btnAddLink.onclick = () => {
    if (!chrome.runtime?.id) return;
    const newItem = {
      type: "link",
      plain: `Source, mate: ${currentUrl}\n${plainText}\n`,
      html: `<div><span style="font-size:13px; color:#f2ffe5;">Source, mate: <a href="${currentUrl}" target="_blank" style="color:#dfff00;">${currentUrl}</a></span><br>${htmlText}<br></div>`
    };
    const newList = [newItem, ...textList];
    setSuccessEffect(btnAddLink, "✓ Sweet!", () => {
      triggerClipboardUpdate(newList);
    });
  };

  // Tombol 2: Menyimpan sebagai teks murni saja
  const btnAddText = document.createElement("button");
  btnAddText.className = "btn-orange btn-pill";
  btnAddText.innerHTML = "Text It";
  btnAddText.onclick = () => {
    if (!chrome.runtime?.id) return;
    const newItem = {
      type: "text",
      plain: `${plainText}\n`,
      html: `<div>${htmlText}<br></div>`
    };
    const newList = [...textList, newItem];
    setSuccessEffect(btnAddText, "✓ Sweet!", () => {
      triggerClipboardUpdate(newList);
    });
  };

  // Tombol 3: Hapus semua item antrean
  const btnClearAll = document.createElement("button");
  btnClearAll.className = "btn-clear btn-circle";
  btnClearAll.innerHTML = "🗑️";
  btnClearAll.onclick = () => {
    if (!chrome.runtime?.id) return;
    chrome.storage.local.set({ textList: [] }, () => {
      triggerClipboardUpdate([]);
    });
  };

  buttonRow.appendChild(btnAddLink);
  buttonRow.appendChild(btnAddText);
  buttonRow.appendChild(btnClearAll);
  currentTooltip.appendChild(buttonRow);
  document.body.appendChild(currentTooltip);
}

/**
 * Memberikan efek visual transisi sukses ketika item berhasil ditambahkan.
 * @param {HTMLElement} button - Elemen tombol yang ditekan.
 * @param {string} message - Pesan keberhasilan (contoh: "✓ Added!").
 * @param {Function} callback - Fungsi callback untuk dieksekusi setelah efek selesai.
 */
function setSuccessEffect(button, message, callback) {
  button.parentElement.querySelectorAll("button").forEach(btn => {
    if (btn !== button) btn.style.opacity = "0.3";
  });
  button.className = button.className.replace("btn-blue", "btn-success").replace("btn-orange", "btn-success");
  button.innerHTML = message;
  setTimeout(() => { callback(); }, 400);
}

/**
 * Menyalin gabungan seluruh teks antrean ke clipboard dan menyimpannya di storage.
 * @param {Array} newList - Daftar item antrean yang baru.
 * @param {boolean} isRefreshAction - Apakah tooltip perlu di-render ulang setelah aksi.
 * @param {number} x - Posisi koordinat X tooltip.
 * @param {number} y - Posisi koordinat Y tooltip.
 * @param {string} pText - Teks plain aktif.
 * @param {string} hText - Teks HTML aktif.
 */
function triggerClipboardUpdate(newList, isRefreshAction = false, x = 0, y = 0, pText = "", hText = "") {
  if (newList.length === 0) {
    clipboardBuffer = { plain: "", html: "" };
  } else {
    const linksOnly = newList.filter(item => item.type === "link");
    const textsOnly = newList.filter(item => item.type === "text");
    const sortedList = [...linksOnly, ...textsOnly];

    clipboardBuffer.plain = sortedList.map(item => item.plain).join("\n");
    clipboardBuffer.html = sortedList.map(item => item.html).join("<br>");
  }

  const handler = (e) => {
    e.clipboardData.setData("text/plain", clipboardBuffer.plain);
    e.clipboardData.setData("text/html", clipboardBuffer.html);
    e.preventDefault();
    document.removeEventListener("copy", handler);
  };

  document.addEventListener("copy", handler);
  document.execCommand("copy");

  if (!chrome.runtime?.id) return;
  chrome.storage.local.set({ textList: newList }, () => {
    if (isRefreshAction) {
      if (currentTooltip) currentTooltip.remove();
      showTooltip(x, y, pText, hText, newList);
    } else {
      removeTooltip();
    }
  });
}

/**
 * Menghapus elemen tooltip dari dokumen jika sedang aktif.
 */
function removeTooltip() {
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// Pantau perubahan status keaktifan di storage untuk langsung menyinkronkan & menghapus tooltip jika tidak aktif
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
      if (response && !response.isActive) {
        removeTooltip();
      }
    });
  }
});