/**
 * Smart Multi-Copy Highlight - Popup Script
 * Controls the queue list UI, copy actions, and global/per-tab activation settings.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

  document.addEventListener("DOMContentLoaded", () => {
    const listContainer = document.getElementById("listContainer");
    const clearBtn = document.getElementById("clearBtn");
    const copyAllBtn = document.getElementById("copyAllBtn");
    const globalStatus = document.getElementById("globalStatus");
    
    // Mode selection elements
    const modeGlobal = document.getElementById("modeGlobal");
    const modeTab = document.getElementById("modeTab");
    const modeOff = document.getElementById("modeOff");
    const tabStatusCard = document.getElementById("tabStatusCard");
    const tabToggle = document.getElementById("tabToggle");
    const tabUrlDesc = document.getElementById("tabUrlDesc");

    // Retrieve active tab details on load
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return;
      
      const currentTab = tabs[0];
      if (!currentTab) return;
      const tabId = currentTab.id;

      // Extract and display the active hostname or title
      if (tabUrlDesc) {
        try {
          const urlObj = new URL(currentTab.url);
          tabUrlDesc.textContent = urlObj.hostname || currentTab.title || "This tab, mate";
        } catch (e) {
          tabUrlDesc.textContent = currentTab.title || "This tab, mate";
        }
      }

      // Load configuration status from storage
      chrome.storage.local.get({
        enabled: true,
        mode: "global",
        activeTabIds: {}
      }, (data) => {
        if (chrome.runtime.lastError) return;
        updateUI(data.enabled, data.mode, data.activeTabIds, tabId);
      });

      // Mode handlers
      if (modeGlobal) {
        modeGlobal.onclick = () => {
          chrome.storage.local.set({ enabled: true, mode: "global" }, () => {
            if (chrome.runtime.lastError) return;
            chrome.storage.local.get(null, (data) => {
              if (chrome.runtime.lastError) return;
              updateUI(true, "global", data.activeTabIds, tabId);
            });
          });
        };
      }

      if (modeTab) {
        modeTab.onclick = () => {
          chrome.storage.local.get({ activeTabIds: {} }, (data) => {
            if (chrome.runtime.lastError) return;
            const newActiveTabIds = { ...data.activeTabIds };
            newActiveTabIds[tabId] = true; // Auto-activate for current tab
            chrome.storage.local.set({
              enabled: true,
              mode: "tab",
              activeTabIds: newActiveTabIds
            }, () => {
              if (chrome.runtime.lastError) return;
              updateUI(true, "tab", newActiveTabIds, tabId);
            });
          });
        };
      }

      if (modeOff) {
        modeOff.onclick = () => {
          chrome.storage.local.set({ enabled: false }, () => {
            if (chrome.runtime.lastError) return;
            chrome.storage.local.get(null, (data) => {
              if (chrome.runtime.lastError) return;
              updateUI(false, data.mode, data.activeTabIds, tabId);
            });
          });
        };
      }

      if (tabToggle) {
        tabToggle.onchange = () => {
          chrome.storage.local.get({ activeTabIds: {} }, (data) => {
            if (chrome.runtime.lastError) return;
            const newActiveTabIds = { ...data.activeTabIds };
            newActiveTabIds[tabId] = tabToggle.checked;
            chrome.storage.local.set({ activeTabIds: newActiveTabIds });
          });
        };
      }
    });

    /**
     * Updates the popup's configuration controls and status badges.
     * @param {boolean} enabled - Whether the extension is globally active.
     * @param {string} mode - The active mode ("global" or "tab").
     * @param {Object} activeTabIds - Map of active tab IDs.
     * @param {number} tabId - Current active tab ID.
     */
    const updateUI = (enabled, mode, activeTabIds, tabId) => {
      // Deactivate active states across all mode selector buttons
      [modeGlobal, modeTab, modeOff].forEach(btn => btn?.classList.remove("active"));

      if (!enabled) {
        modeOff?.classList.add("active");
        if (globalStatus) {
          globalStatus.textContent = "No Go";
          globalStatus.classList.add("off");
        }
        tabStatusCard?.classList.add("hidden");
      } else {
        if (globalStatus) {
          globalStatus.textContent = "Sweet As";
          globalStatus.classList.remove("off");
        }
        
        if (mode === "global") {
          modeGlobal?.classList.add("active");
          tabStatusCard?.classList.add("hidden");
        } else {
          modeTab?.classList.add("active");
          tabStatusCard?.classList.remove("hidden");
          if (tabToggle) {
            tabToggle.checked = !!activeTabIds[tabId];
          }
        }
      }
    };

    /**
     * Writes compiled queue content (plain text + HTML) to the system clipboard.
     * @param {Array} list - The list of queue items.
     * @param {Function} [callback] - Function to execute on success.
     */
    const writeListToClipboard = (list, callback) => {
      if (list.length === 0) {
        navigator.clipboard.writeText("").then(callback).catch(err => {
          console.error("[Popup] Clipboard clear error:", err);
          if (callback) callback();
        });
        return;
      }

      const combinedPlain = list.map(item => item.plain).join("");
      const combinedHtml = list.map(item => item.html).join("");

      const blobPlain = new Blob([combinedPlain], { type: "text/plain" });
      const blobHtml = new Blob([combinedHtml], { type: "text/html" });

      const clipboardData = [
        new ClipboardItem({
          "text/plain": blobPlain,
          "text/html": blobHtml
        })
      ];

      navigator.clipboard.write(clipboardData)
        .then(callback)
        .catch(err => {
          console.error("[Popup] Clipboard write error:", err);
          if (callback) callback();
        });
    };

    /**
     * Renders the stored text list in the popup container.
     */
    const renderList = () => {
      chrome.storage.local.get({ textList: [] }, (data) => {
        if (chrome.runtime.lastError) return;
        if (!listContainer) return;
        
        listContainer.innerHTML = "";
        
        if (data.textList.length === 0) {
          listContainer.innerHTML = `
            <div style="color: var(--text-muted); text-align: center; padding: 10px;">
              Nothing here yet, mate. Grab some text!
            </div>
          `;
          return;
        }

        data.textList.forEach((item, index) => {
          const div = document.createElement("div");
          div.className = "text-item";
          if (item.type === "link") {
            div.classList.add("type-link");
          }

          const textSpan = document.createElement("span");
          textSpan.className = "text-content";

          const cleanText = item.plain.replace(/^Source(?:, mate)?: .*?\n/, "").trim();
          textSpan.textContent = `${index + 1}. ${cleanText}`;
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
    };

    /**
     * Removes an item from the queue list.
     * @param {number} index - Index of the item to delete.
     */
    const deleteItem = (index) => {
      chrome.storage.local.get({ textList: [] }, (data) => {
        if (chrome.runtime.lastError) return;
        
        const newList = [...data.textList];
        newList.splice(index, 1);

        chrome.storage.local.set({ textList: newList }, () => {
          if (chrome.runtime.lastError) return;
          writeListToClipboard(newList, () => {
            renderList();
          });
        });
      });
    };

    // Global clear button handler
    if (clearBtn) {
      clearBtn.onclick = () => {
        chrome.storage.local.set({ textList: [] }, () => {
          if (chrome.runtime.lastError) return;
          navigator.clipboard.writeText("").then(() => {
            renderList();
          });
        });
      };
    }

    // Global copy all button handler
    if (copyAllBtn) {
      copyAllBtn.onclick = () => {
        chrome.storage.local.get({ textList: [] }, (data) => {
          if (chrome.runtime.lastError) return;
          if (data.textList.length === 0) return;

          writeListToClipboard(data.textList, () => {
            copyAllBtn.textContent = "Grabbed the lot, mate!";
            setTimeout(() => {
              copyAllBtn.textContent = "Grab the Lot";
            }, 1500);
          });
        });
      };
    }

    // Initialize list load on open
    renderList();
  });
})();