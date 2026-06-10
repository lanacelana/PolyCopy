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
   * Extracts clean HTML from a DOM Range, filtering out scripts and styles to prevent CSS pollution.
   * @param {Range} range - The selection range.
   * @returns {string} The cleaned HTML string.
   */
  const getCleanHtmlFromRange = (range) => {
    const fragment = range.cloneContents();
    
    // Remove style and script tags to prevent CSS pollution and keep selection clean
    const elementsToRemove = fragment.querySelectorAll("style, script");
    elementsToRemove.forEach(el => el.remove());

    const container = document.createElement("div");
    container.appendChild(fragment);
    return container.innerHTML;
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

    const writeToClipboard = (callback) => {
      // Attempt 1: Modern navigator.clipboard API (requires HTTPS & focus)
      if (navigator.clipboard && window.isSecureContext) {
        const blobPlain = new Blob([clipboardBuffer.plain], { type: "text/plain" });
        const blobHtml = new Blob([clipboardBuffer.html], { type: "text/html" });
        const clipboardItem = new ClipboardItem({
          "text/plain": blobPlain,
          "text/html": blobHtml
        });

        navigator.clipboard.write([clipboardItem])
          .then(callback)
          .catch((err) => {
            console.debug("[Content] navigator.clipboard write failed, falling back:", err);
            writeUsingExecCommand(callback);
          });
      } else {
        writeUsingExecCommand(callback);
      }
    };

    const writeUsingExecCommand = (callback) => {
      const onCopyHandler = (e) => {
        e.clipboardData.setData("text/plain", clipboardBuffer.plain);
        e.clipboardData.setData("text/html", clipboardBuffer.html);
        e.preventDefault();
        document.removeEventListener("copy", onCopyHandler, true); // Remove in capture phase
      };

      // Listen in capture phase to bypass website overrides
      document.addEventListener("copy", onCopyHandler, true);
      document.execCommand("copy");
      if (callback) callback();
    };

    writeToClipboard(() => {
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
   * @param {boolean} [isMouseSelection=false] - Whether the positioning is based on mouse coordinates.
   */
  const showTooltip = (x, y, plainText, htmlText, textList, isMouseSelection = false) => {
    // Ensure body exists before injecting
    if (!document.body) return;

    currentTooltip = document.createElement("div");
    currentTooltip.className = "smart-copy-tooltip";
    currentTooltip.style.left = "-9999px";
    currentTooltip.style.top = "-9999px";

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

    // Adjust position to keep the tooltip fully visible within the viewport boundaries
    const rect = currentTooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Safety margin from screen edges: 12px for sides/top, 85px for bottom (to clear taskbars/dock)
    const paddingX = 12;
    const paddingYTop = 12;
    const paddingYBottom = 85;

    let adjustedX = x;
    let adjustedY = y;

    if (isMouseSelection) {
      // Offset slightly to the right of cursor
      adjustedX = x + 15;
      
      // Smart vertical positioning: place above cursor if in bottom half of screen, otherwise below
      if (y > viewportHeight / 2) {
        adjustedY = y - rect.height - 15;
      } else {
        adjustedY = y + 15;
      }
    }

    // Check right edge overflow
    if (adjustedX + rect.width > viewportWidth - paddingX) {
      adjustedX = viewportWidth - rect.width - paddingX;
    }
    // Check left edge overflow
    if (adjustedX < paddingX) {
      adjustedX = paddingX;
    }

    // Check bottom edge overflow (with larger taskbar/dock safety margin)
    if (adjustedY + rect.height > viewportHeight - paddingYBottom) {
      adjustedY = viewportHeight - rect.height - paddingYBottom;
    }
    // Check top edge overflow
    if (adjustedY < paddingYTop) {
      adjustedY = paddingYTop;
    }

    currentTooltip.style.left = `${adjustedX}px`;
    currentTooltip.style.top = `${adjustedY}px`;
  };

  // Event listener for mouseup (normal click-drag selection) - captures early
  document.addEventListener("mouseup", (e) => {
    if (!chrome.runtime?.id) return;
    if (e.target.closest(".smart-copy-tooltip")) return;

    // Capture the selection SYNCHRONOUSLY before other scripts or async delays can clear it
    const selection = window.getSelection();
    if (selection.rangeCount === 0) {
      removeTooltip();
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (selectedText.length === 0) {
      removeTooltip();
      return;
    }

    const selectedHtml = getCleanHtmlFromRange(range);

    removeTooltip();

    // Verify extension status asynchronously before showing the tooltip
    chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.isActive) return;

      chrome.storage.local.get({ textList: [] }, (data) => {
        if (chrome.runtime.lastError) return;
        showTooltip(e.clientX, e.clientY, selectedText, selectedHtml, data.textList, true);
      });
    });
  }, true);

  // Event listener for Ctrl+A / Cmd+A selection - captures early
  document.addEventListener("keydown", (e) => {
    if (!chrome.runtime?.id) return;

    const isAKey = (e.key && e.key.toLowerCase() === 'a') || e.code === 'KeyA';
    if ((e.ctrlKey || e.metaKey) && isAKey) {
      removeTooltip();

      // Small delay to allow the browser to complete the selection update
      setTimeout(() => {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const selectedText = selection.toString().trim();

        if (selectedText.length === 0) return;

        const selectedHtml = getCleanHtmlFromRange(range);

        chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.isActive) return;

          const tooltipWidth = 240;
          const x = (window.innerWidth / 2) - (tooltipWidth / 2);
          const y = 80;

          chrome.storage.local.get({ textList: [] }, (data) => {
            if (chrome.runtime.lastError) return;
            showTooltip(x, y, selectedText, selectedHtml, data.textList);
          });
        });
      }, 50);
    }
  }, true);

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