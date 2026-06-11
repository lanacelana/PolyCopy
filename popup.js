/**
 * Smart Multi-Copy Highlight - Popup Script
 * 
 * Controls the queue list UI, copy-all operations, and global/per-tab activation toggles.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

  // ==========================================
  // DOM CREATION HELPER
  // ==========================================

  /**
   * Declaratively creates a DOM element with attributes, styles, and listeners.
   * @param {string} tagName - The type of element to create.
   * @param {Object} [attrs={}] - Attributes, styles, and event listeners.
   * @param {Array<string|Node>} [children=[]] - Child elements or text content.
   * @returns {HTMLElement} The created DOM element.
   */
  const el = (tagName, attrs = {}, children = []) => {
    const element = document.createElement(tagName);
    
    for (const [key, val] of Object.entries(attrs)) {
      if (key === "style" && typeof val === "object") {
        Object.assign(element.style, val);
      } else if (key === "className") {
        element.className = val;
      } else if (key.startsWith("on") && typeof val === "function") {
        element.addEventListener(key.substring(2).toLowerCase(), val);
      } else if (val !== undefined && val !== null) {
        element.setAttribute(key, val);
      }
    }
    
    for (const child of children) {
      if (typeof child === "string" || typeof child === "number") {
        element.appendChild(document.createTextNode(String(child)));
      } else if (child) {
        element.appendChild(child);
      }
    }
    
    return element;
  };

  // ==========================================
  // MAIN POPUP UI LIFECYCLE
  // ==========================================

  document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const listContainer = document.getElementById("listContainer");
    const clearBtn = document.getElementById("clearBtn");
    const copyAllBtn = document.getElementById("copyAllBtn");
    const globalStatus = document.getElementById("globalStatus");
    
    // Mode selectors
    const modeGlobal = document.getElementById("modeGlobal");
    const modeTab = document.getElementById("modeTab");
    const modeOff = document.getElementById("modeOff");
    const tabStatusCard = document.getElementById("tabStatusCard");
    const tabToggle = document.getElementById("tabToggle");
    const tabUrlDesc = document.getElementById("tabUrlDesc");

    // Retrieve active tab details on load to show context-specific controls
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return;
      
      const currentTab = tabs[0];
      if (!currentTab) return;
      const tabId = currentTab.id;

      // Extract and display the active hostname or title in tab descriptor
      if (tabUrlDesc) {
        try {
          const urlObj = new URL(currentTab.url);
          tabUrlDesc.textContent = urlObj.hostname || currentTab.title || "This tab, mate";
        } catch (e) {
          tabUrlDesc.textContent = currentTab.title || "This tab, mate";
        }
      }

      // Load initial settings configurations from storage
      chrome.storage.local.get({
        enabled: true,
        mode: "global",
        activeTabIds: {}
      }, (data) => {
        if (chrome.runtime.lastError) return;
        updateUI(data.enabled, data.mode, data.activeTabIds, tabId);
      });

      // ==========================================
      // OPTION CHANGERS
      // ==========================================

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
            newActiveTabIds[tabId] = true; // Automatically turn active for this tab on click
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
     * Re-renders settings control active indicators and descriptor states.
     * @param {boolean} enabled - Whether the extension is globally toggled active.
     * @param {string} mode - Active mode ('global' or 'tab').
     * @param {Object} activeTabIds - Map of active tab IDs.
     * @param {number} tabId - Active tab ID.
     */
    const updateUI = (enabled, mode, activeTabIds, tabId) => {
      // Clear all active classes first
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

    // ==========================================
    // STORAGE & CLIPBOARD OPERATIONS
    // ==========================================

    /**
     * Compiles and copies the entire item list (plain text + html) to the clipboard.
     * @param {Array} list - The list of queue items.
     * @param {Function} [callback] - Success callback trigger.
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
     * Reads saved items and renders lists dynamically in popup cards.
     */
    const renderList = () => {
      chrome.storage.local.get({ textList: [] }, (data) => {
        if (chrome.runtime.lastError) return;
        if (!listContainer) return;
        
        listContainer.innerHTML = "";
        
        if (data.textList.length === 0) {
          listContainer.appendChild(
            el("div", {
              style: { color: "var(--text-muted)", textAlign: "center", padding: "10px" }
            }, ["Nothing here yet, mate. Grab some text!"])
          );
          return;
        }

        data.textList.forEach((item, index) => {
          const cleanText = item.plain.replace(/^Source(?:, mate)?: .*?\n/, "").trim();

          const textSpan = el("span", {
            className: "text-content",
            title: cleanText
          }, [`${index + 1}. ${cleanText}`]);

          const delBtn = el("button", {
            className: "delete-btn",
            onclick: () => deleteItem(index)
          }, ["×"]);

          const div = el("div", {
            className: `text-item${item.type === "link" ? " type-link" : ""}`
          }, [textSpan, delBtn]);

          listContainer.appendChild(div);
        });
      });
    };

    /**
     * Deletes a specific index from the queue lists.
     * @param {number} index - Index of element to delete.
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

    // ==========================================
    // ACTION BUTTON CLICK HANDLERS
    // ==========================================

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

    // Initialize list render on start
    renderList();
  });
})();