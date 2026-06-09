/**
 * Smart Multi-Copy Highlight - Content Script
 * Handles text selection detection (click-drag & keyboard Ctrl+A/Cmd+A)
 * and renders the action tooltip UI.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

  let currentTooltip = null;
  let clipboardBuffer = { plain: "", html: "" };

  /**
   * Safely removes the active tooltip element from the DOM if it exists.
   */
  const removeTooltip = () => {
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
  };

  /**
   * Safely updates the system clipboard and local storage.
   * @param {Array} newList - The updated list of copied items.
   * @param {boolean} [isRefreshAction=false] - Whether to redraw the tooltip after update.
   * @param {number} [x=0] - X coordinate for redrawing.
   * @param {number} [y=0] - Y coordinate for redrawing.
   * @param {string} [pText=""] - Active plain text selection.
   * @param {string} [hText=""] - Active HTML text selection.
   */
  const triggerClipboardUpdate = (newList, isRefreshAction = false, x = 0, y = 0, pText = "", hText = "") => {
    if (newList.length === 0) {
      clipboardBuffer = { plain: "", html: "" };
    } else {
      const linksOnly = newList.filter(item => item.type === "link");
      const textsOnly = newList.filter(item => item.type === "text");
      const sortedList = [...linksOnly, ...textsOnly];

      clipboardBuffer.plain = sortedList.map(item => item.plain).join("\n");
      clipboardBuffer.html = sortedList.map(item => item.html).join("<br>");
    }

    const onCopyHandler = (e) => {
      e.clipboardData.setData("text/plain", clipboardBuffer.plain);
      e.clipboardData.setData("text/html", clipboardBuffer.html);
      e.preventDefault();
      document.removeEventListener("copy", onCopyHandler);
    };

    document.addEventListener("copy", onCopyHandler);
    document.execCommand("copy");

    if (!chrome.runtime?.id) return;
    chrome.storage.local.set({ textList: newList }, () => {
      if (chrome.runtime.lastError) return;
      if (isRefreshAction) {
        removeTooltip();
        showTooltip(x, y, pText, hText, newList);
      } else {
        removeTooltip();
      }
    });
  };

  /**
   * Animates success transition on the pressed action button.
   * @param {HTMLElement} button - The button element that was clicked.
   * @param {string} message - Success message to display.
   * @param {Function} callback - Callback function to execute after the transition.
   */
  const setSuccessEffect = (button, message, callback) => {
    const siblingButtons = button.parentElement.querySelectorAll("button");
    siblingButtons.forEach(btn => {
      if (btn !== button) {
        btn.style.opacity = "0.3";
      }
    });
    button.className = button.className.replace("btn-blue", "btn-success").replace("btn-orange", "btn-success");
    button.innerHTML = message;
    setTimeout(callback, 400);
  };

  /**
   * Renders the floating copy tooltip at the specified position.
   * @param {number} x - X coordinate.
   * @param {number} y - Y coordinate.
   * @param {string} plainText - Selected plain text.
   * @param {string} htmlText - Selected HTML text.
   * @param {Array} textList - List of currently stored items.
   */
  const showTooltip = (x, y, plainText, htmlText, textList) => {
    // Ensure body exists before injecting
    if (!document.body) return;

    currentTooltip = document.createElement("div");
    currentTooltip.className = "smart-copy-tooltip";
    currentTooltip.style.left = `${x}px`;
    currentTooltip.style.top = `${y}px`;

    // Render list container if there are items in the queue
    if (textList.length > 0) {
      const listContainer = document.createElement("div");
      listContainer.className = "tooltip-list-container";

      textList.forEach((item, index) => {
        const listItem = document.createElement("div");
        listItem.className = "tooltip-list-item";
        if (item.type === "link") {
          listItem.classList.add("type-link");
        }

        const itemText = document.createElement("span");
        const cleanText = item.plain.replace(/^Source(?:, mate)?: .*?\n/, "").trim();
        const words = cleanText.split(/\s+/).filter(Boolean);
        const displayWords = words.slice(0, 2).join(" ") || "";
        const hasMore = words.length > 2;
        const prefix = item.type === "link" ? "🔗 " : "📝 ";

        itemText.innerText = `${prefix}${displayWords}${hasMore ? "..." : ""}`;
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
            if (chrome.runtime.lastError) return;
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

    // Button 1: Save as Link
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

    // Button 2: Save as plain text
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

    // Button 3: Clear queue
    const btnClearAll = document.createElement("button");
    btnClearAll.className = "btn-clear btn-circle";
    btnClearAll.innerHTML = "🗑️";
    btnClearAll.onclick = () => {
      if (!chrome.runtime?.id) return;
      chrome.storage.local.set({ textList: [] }, () => {
        if (chrome.runtime.lastError) return;
        triggerClipboardUpdate([]);
      });
    };

    buttonRow.appendChild(btnAddLink);
    buttonRow.appendChild(btnAddText);
    buttonRow.appendChild(btnClearAll);
    currentTooltip.appendChild(buttonRow);
    document.body.appendChild(currentTooltip);
  };

  // Event listener for mouseup (normal click-drag selection)
  document.addEventListener("mouseup", (e) => {
    if (!chrome.runtime?.id) return;
    if (e.target.closest(".smart-copy-tooltip")) return;
    removeTooltip();

    chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.isActive) return;

      const selection = window.getSelection();
      if (selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const selectedText = selection.toString().trim();

      if (selectedText.length > 0) {
        const container = document.createElement("div");
        container.appendChild(range.cloneContents());
        const selectedHtml = container.innerHTML;

        chrome.storage.local.get({ textList: [] }, (data) => {
          if (chrome.runtime.lastError) return;
          showTooltip(e.clientX + 15, e.clientY + 10, selectedText, selectedHtml, data.textList);
        });
      }
    });
  });

  // Event listener for Ctrl+A / Cmd+A selection
  document.addEventListener("keydown", (e) => {
    if (!chrome.runtime?.id) return;

    const isAKey = (e.key && e.key.toLowerCase() === 'a') || e.code === 'KeyA';
    if ((e.ctrlKey || e.metaKey) && isAKey) {
      removeTooltip();

      // Small delay to allow the browser to complete the selection update
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.isActive) return;

          const selection = window.getSelection();
          if (selection.rangeCount === 0) return;

          const range = selection.getRangeAt(0);
          const selectedText = selection.toString().trim();

          if (selectedText.length > 0) {
            const container = document.createElement("div");
            container.appendChild(range.cloneContents());
            const selectedHtml = container.innerHTML;

            const tooltipWidth = 240;
            const x = (window.innerWidth / 2) - (tooltipWidth / 2);
            const y = 80;

            chrome.storage.local.get({ textList: [] }, (data) => {
              if (chrome.runtime.lastError) return;
              showTooltip(x, y, selectedText, selectedHtml, data.textList);
            });
          }
        });
      }, 50);
    }
  });

  // Listen for storage changes to dismiss tooltip instantly if extension is turned off
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && chrome.runtime?.id) {
      chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && !response.isActive) {
          removeTooltip();
        }
      });
    }
  });
})();