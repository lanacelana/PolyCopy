/**
 * Smart Multi-Copy Highlight - Content Script
 * 
 * Handles rich-text selection, floating tooltip controls, custom HTML-to-Markdown 
 * compiling, and the standalone floating 'M' paste button.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

  // ==========================================
  // 1. EXTENSION STATE & CONSTANTS
  // ==========================================

  let currentTooltip = null;
  let floatBtn = null;
  
  let tooltipDragCleanup = null;
  let floatBtnDragCleanup = null;
  
  let lastActiveInput = null;
  let myTabId = null;
  let resizeAnimationFrameId = null;
  let clipboardBuffer = { plain: "", html: "" };

  /**
   * Safe check to verify if the extension runtime context is still active.
   * @returns {boolean}
   */
  const isExtensionValid = () => {
    return (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.id &&
      chrome.storage &&
      chrome.storage.local
    );
  };

  // Perform startup scan to remove any lingering buttons/tooltips from previous installs
  try {
    const lingeringBtn = document.getElementById("smart-markdown-floating-btn");
    if (lingeringBtn) lingeringBtn.remove();
    
    const lingeringTooltip = document.querySelector(".smart-copy-tooltip");
    if (lingeringTooltip) lingeringTooltip.remove();
  } catch (e) {
    console.debug("[MultiCopy Content] Startup cleanup failed:", e);
  }

  // ==========================================
  // 2. DOM & HTML HELPERS
  // ==========================================

  /**
   * Declaratively creates a DOM element with attributes, styles, and listeners.
   * @param {string} tagName - The type of element to create (e.g., 'div', 'button').
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

  /**
   * Reusable utility to make a DOM element draggable within viewport bounds.
   * @param {HTMLElement} element - The target element to drag.
   * @param {Object} [options={}] - Drag boundary parameters.
   * @param {number} [options.dragThreshold=0] - Travel distance before dragging activates.
   * @param {number} [options.paddingX=10] - Horizontal boundary padding from screen edges.
   * @param {number} [options.paddingYTop=10] - Top boundary padding.
   * @param {number} [options.paddingYBottom=10] - Bottom boundary padding.
   * @param {string} [options.dragClass=""] - CSS class appended to element while dragging.
   * @param {Array<string>} [options.ignoredSelectors=[]] - Sub-selectors that should abort dragging on click.
   * @param {Function} [options.onDragStart] - Drag started callback.
   * @param {Function} [options.onDragEnd] - Drag stopped callback. Passes { didDrag, rect }.
   * @returns {Function} Clean-up function to unbind all mouse listeners.
   */
  const makeElementDraggable = (element, options = {}) => {
    const dragThreshold = options.dragThreshold || 0;
    const paddingX = options.paddingX !== undefined ? options.paddingX : 10;
    const paddingYTop = options.paddingYTop !== undefined ? options.paddingYTop : 10;
    const paddingYBottom = options.paddingYBottom !== undefined ? options.paddingYBottom : 10;
    const dragClass = options.dragClass || "";
    const ignoredSelectors = options.ignoredSelectors || [];
    
    let isDragging = false;
    let didDrag = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const onMouseMove = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      if (dragThreshold > 0) {
        if (Math.abs(deltaX) > dragThreshold || Math.abs(deltaY) > dragThreshold) {
          didDrag = true;
        }
      } else {
        didDrag = true;
      }

      let newLeft = initialLeft + deltaX;
      let newTop = initialTop + deltaY;

      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const rect = element.getBoundingClientRect();
      const elemW = rect.width;
      const elemH = rect.height;

      // Clamp horizontally
      if (newLeft < paddingX) {
        newLeft = paddingX;
      } else if (newLeft + elemW > viewportW - paddingX) {
        newLeft = viewportW - elemW - paddingX;
      }

      // Clamp vertically
      if (newTop < paddingYTop) {
        newTop = paddingYTop;
      } else if (newTop + elemH > viewportH - paddingYBottom) {
        newTop = viewportH - elemH - paddingYBottom;
      }

      element.style.right = "auto";
      element.style.bottom = "auto";
      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;

      if (dragClass) {
        element.classList.remove(dragClass);
      }

      document.removeEventListener("mousemove", onMouseMove, { capture: true });
      document.removeEventListener("mouseup", onMouseUp, { capture: true });

      if (options.onDragEnd) {
        const rect = element.getBoundingClientRect();
        options.onDragEnd({ didDrag, rect });
      }
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) return; // Only trigger on left-click

      // Ignore dragging if clicked on specified elements (e.g. action buttons)
      for (const selector of ignoredSelectors) {
        if (e.target.closest(selector)) return;
      }

      isDragging = true;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      if (dragClass) {
        element.classList.add(dragClass);
      }

      document.addEventListener("mousemove", onMouseMove, { capture: true });
      document.addEventListener("mouseup", onMouseUp, { capture: true });

      if (options.onDragStart) {
        options.onDragStart();
      }

      e.preventDefault();
    };

    element.addEventListener("mousedown", onMouseDown);

    return () => {
      element.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove, { capture: true });
      document.removeEventListener("mouseup", onMouseUp, { capture: true });
    };
  };

  // ==========================================
  // 3. MARKDOWN COMPILER ENGINE
  // ==========================================

  /**
   * Extracts selection text in HTML and purges script/style elements.
   * @param {Range} range - The active selection range object.
   * @returns {string} The cleaned HTML string snippet.
   */
  const getCleanHtmlFromRange = (range) => {
    const fragment = range.cloneContents();
    
    // Eliminate embedded styles and scripts to avoid polluting text extraction
    const elementsToRemove = fragment.querySelectorAll("style, script");
    elementsToRemove.forEach(el => el.remove());

    const container = document.createElement("div");
    container.appendChild(fragment);
    return container.innerHTML;
  };

  /**
   * Compiles HTML content to a clean Markdown format.
   * @param {string} plainText - Backup plain text value.
   * @param {string} htmlText - Main source HTML string.
   * @param {string} url - Source webpage link.
   * @returns {string} Compiled markdown content.
   */
  const convertToMarkdown = (plainText, htmlText, url) => {
    if (htmlText && htmlText.includes("font-family: monospace;")) {
      return plainText.trim();
    }
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText || "", "text/html");

    const parseNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
      }

      const tagName = node.tagName.toUpperCase();
      let childrenMarkdown = "";
      
      for (const child of node.childNodes) {
        childrenMarkdown += parseNode(child);
      }

      switch (tagName) {
        case 'A':
          const href = node.getAttribute('href') || '';
          return `[${childrenMarkdown}](${href})`;
        case 'STRONG':
        case 'B':
          return `**${childrenMarkdown}**`;
        case 'EM':
        case 'I':
          return `*${childrenMarkdown}*`;
        case 'CODE':
          if (node.parentNode && node.parentNode.tagName === 'PRE') {
            return childrenMarkdown;
          }
          return `\`${childrenMarkdown}\``;
        case 'PRE':
          return `\n\`\`\`\n${childrenMarkdown.trim()}\n\`\`\`\n`;
        case 'H1': return `\n# ${childrenMarkdown.trim()}\n`;
        case 'H2': return `\n## ${childrenMarkdown.trim()}\n`;
        case 'H3': return `\n### ${childrenMarkdown.trim()}\n`;
        case 'H4': return `\n#### ${childrenMarkdown.trim()}\n`;
        case 'H5': return `\n##### ${childrenMarkdown.trim()}\n`;
        case 'H6': return `\n###### ${childrenMarkdown.trim()}\n`;
        case 'BR': return '\n';
        case 'P':
        case 'DIV':
          if (!childrenMarkdown.trim()) return "";
          return `\n${childrenMarkdown}\n`;
        case 'LI':
          return `\n- ${childrenMarkdown.trim()}`;
        case 'UL':
        case 'OL':
          return `\n${childrenMarkdown.trim()}\n`;
        default:
          return childrenMarkdown;
      }
    };

    let contentMarkdown = parseNode(doc.body).trim();
    
    // Condense excessive line breaks (3 or more consecutive newlines down to 2)
    contentMarkdown = contentMarkdown.replace(/\n{3,}/g, '\n\n');

    if (url) {
      return `[Source](${url})\n\n${contentMarkdown}`;
    }
    return contentMarkdown;
  };

  // ==========================================
  // 4. CLIPBOARD & CURSOR INSERTION API
  // ==========================================

  /**
   * Inserts text at the user's cursor position in text inputs, textareas, or contenteditables.
   * @param {string} text - Content to write.
   * @returns {boolean} True on success.
   */
  const insertTextAtCursor = (text) => {
    const activeEl = lastActiveInput || document.activeElement;
    if (!activeEl) return false;

    try {
      activeEl.focus();
    } catch (e) {
      console.debug("[Tooltip] Failed to focus target field:", e);
    }

    const tagName = activeEl.tagName.toUpperCase();
    if (tagName === "INPUT" || tagName === "TEXTAREA") {
      try {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        const val = activeEl.value;
        
        activeEl.value = val.substring(0, start) + text + val.substring(end);
        activeEl.selectionStart = activeEl.selectionEnd = start + text.length;
        
        activeEl.dispatchEvent(new Event("input", { bubbles: true }));
        activeEl.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      } catch (e) {
        console.error("[Tooltip] Direct text injection failed:", e);
      }
    } else {
      // Inline document editing element (e.g. Google Docs, rich text textareas)
      try {
        document.execCommand("insertText", false, text);
        return true;
      } catch (e) {
        console.error("[Tooltip] execCommand insertText fallback failed:", e);
      }
    }
    return false;
  };

  /**
   * Writes the compiled items queue to storage and the system clipboard.
   * @param {Array} newList - The updated list of queue items.
   * @param {boolean} [isRefreshAction=false] - Whether to recreate the active tooltip UI.
   * @param {number} [x=0] - Tooltip X redraw coordinate.
   * @param {number} [y=0] - Tooltip Y redraw coordinate.
   * @param {string} [pText=""] - Saved plain text snippet.
   * @param {string} [hText=""] - Saved HTML snippet.
   */
  const triggerClipboardUpdate = (newList, isRefreshAction = false, x = 0, y = 0, pText = "", hText = "") => {
    if (newList.length === 0) {
      clipboardBuffer = { plain: "", html: "" };
    } else {
      const linksOnly = newList.filter(item => item.type === "link");
      const textsOnly = newList.filter(item => item.type === "text" || item.type === "markdown");
      const sortedList = [...linksOnly, ...textsOnly];

      clipboardBuffer.plain = sortedList.map(item => item.plain).join("\n");
      clipboardBuffer.html = sortedList.map(item => item.html).join("<br>");
    }

    const writeToClipboard = (callback) => {
      // Modern Clipboard API
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
            console.debug("[Content] Modern Clipboard API failed, running fallback:", err);
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
        document.removeEventListener("copy", onCopyHandler, true);
      };

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
   * Triggers click success confirmation transition on action buttons.
   * @param {HTMLElement} button - Target button element.
   * @param {string} message - Message text.
   * @param {Function} callback - Post-transition execution.
   */
  const setSuccessEffect = (button, message, callback) => {
    const siblingButtons = button.parentElement.querySelectorAll("button");
    siblingButtons.forEach(btn => {
      if (btn !== button) {
        btn.style.opacity = "0.3";
      }
    });
    
    button.className = button.className
      .replace("btn-blue", "btn-success")
      .replace("btn-orange", "btn-success")
      .replace("btn-markdown", "btn-success");
      
    button.innerHTML = message;
    setTimeout(callback, 400);
  };

  // ==========================================
  // 5. SELECTION TOOLTIP COMPONENT
  // ==========================================

  /**
   * Safely deletes the active selection tooltip.
   */
  const removeTooltip = () => {
    if (tooltipDragCleanup) {
      tooltipDragCleanup();
      tooltipDragCleanup = null;
    }
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }
  };

  /**
   * Instantiates and renders the popup tooltip at selection coordinates.
   * @param {number} x - Target viewport position X.
   * @param {number} y - Target viewport position Y.
   * @param {string} plainText - Selection text value.
   * @param {string} htmlText - Selection HTML content.
   * @param {Array} textList - Current active queue items list.
   * @param {boolean} [isMouseSelection=false] - If coordinates are generated by mouse.
   */
  const showTooltip = (x, y, plainText, htmlText, textList, isMouseSelection = false) => {
    if (!document.body) return;

    // Render list preview queue container
    let listContainer = null;
    if (textList.length > 0) {
      listContainer = el("div", { className: "tooltip-list-container" },
        textList.map((item, index) => {
          const cleanText = item.plain
            .replace(/^Source(?:, mate)?: .*?\n/, "")
            .replace(/^\[Source\]\(.*?\)\n+/, "")
            .trim();
          
          const words = cleanText.split(/\s+/).filter(Boolean);
          const displayWords = words.slice(0, 2).join(" ") || "";
          const hasMore = words.length > 2;
          
          const prefix = item.type === "link" ? "🔗 " : (item.type === "markdown" ? "Ⓜ️ " : "📝 ");

          return el("div", {
            className: `tooltip-list-item${item.type === "link" ? " type-link" : ""}`
          }, [
            el("span", { textContent: `${prefix}${displayWords}${hasMore ? "..." : ""}`, title: cleanText }),
            el("button", {
              className: "tooltip-delete-btn",
              onclick: (event) => {
                event.stopPropagation();
                if (!chrome.runtime?.id) return;
                
                const newList = [...textList];
                newList.splice(index, 1);
                
                chrome.storage.local.set({ textList: newList }, () => {
                  if (chrome.runtime.lastError) return;
                  triggerClipboardUpdate(newList, true, x, y, plainText, htmlText);
                });
              }
            }, ["×"])
          ]);
        })
      );
    }

    const currentUrl = window.location.href;

    const btnAddLink = el("button", {
      className: "btn-blue btn-pill",
      onclick: () => {
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
      }
    }, ["Link It"]);

    const btnAddText = el("button", {
      className: "btn-orange btn-pill",
      onclick: () => {
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
      }
    }, ["Text It"]);

    const btnClearAll = el("button", {
      className: "btn-clear btn-circle",
      onclick: () => {
        if (!chrome.runtime?.id) return;
        chrome.storage.local.set({ textList: [] }, () => {
          if (chrome.runtime.lastError) return;
          triggerClipboardUpdate([]);
        });
      }
    }, ["🗑️"]);

    const buttonRow = el("div", { className: "tooltip-buttons" }, [
      btnAddLink,
      btnAddText,
      btnClearAll
    ]);

    currentTooltip = el("div", {
      className: "smart-copy-tooltip",
      style: { left: "-9999px", top: "-9999px" }
    }, [
      listContainer,
      buttonRow
    ]);

    document.body.appendChild(currentTooltip);

    // Coordinate adjustments based on viewport bounding constraints
    const rect = currentTooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const paddingX = 12;
    const paddingYTop = 12;
    const paddingYBottom = 85; // Avoid screen taskbars/docks

    let adjustedX = x;
    let adjustedY = y;

    if (isMouseSelection) {
      adjustedX = x + 15;
      adjustedY = (y > viewportHeight / 2) ? (y - rect.height - 15) : (y + 15);
    }

    if (adjustedX + rect.width > viewportWidth - paddingX) {
      adjustedX = viewportWidth - rect.width - paddingX;
    }
    if (adjustedX < paddingX) {
      adjustedX = paddingX;
    }
    if (adjustedY + rect.height > viewportHeight - paddingYBottom) {
      adjustedY = viewportHeight - rect.height - paddingYBottom;
    }
    if (adjustedY < paddingYTop) {
      adjustedY = paddingYTop;
    }

    currentTooltip.style.left = `${adjustedX}px`;
    currentTooltip.style.top = `${adjustedY}px`;

    // Make tooltip draggable using the shared drag utility
    tooltipDragCleanup = makeElementDraggable(currentTooltip, {
      ignoredSelectors: ["button", "a", ".tooltip-delete-btn"],
      paddingX: 12,
      paddingYTop: 12,
      paddingYBottom: 85
    });
  };

  // ==========================================
  // 6. FLOATING MARKDOWN BUTTON COMPONENT
  // ==========================================

  /**
   * Instantiates the floating button 'M' for paste actions.
   */
  const createFloatingMarkdownButton = () => {
    if (document.getElementById("smart-markdown-floating-btn")) return;

    const btn = el("button", {
      id: "smart-markdown-floating-btn",
      title: "Paste Clipboard as Markdown"
    }, ["M"]);

    // Query and set proper Zoom scale
    if (isExtensionValid()) {
      chrome.runtime.sendMessage({ action: "getZoom" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.zoom !== undefined) {
          btn.style.setProperty("--zoom-scale", 1 / response.zoom);
        }
      });
    }

    floatBtn = btn;
    window.addEventListener("resize", onWindowResize);

    // Recover button coordinates
    if (isExtensionValid()) {
      chrome.storage.local.get({ floatBtnPosition: null }, (data) => {
        if (chrome.runtime.lastError) return;
        if (data.floatBtnPosition) {
          const pos = data.floatBtnPosition;
          if (pos.sideX && pos.sideY) {
            btn.style.left = pos.sideX === "left" ? `${pos.distanceX}px` : "auto";
            btn.style.right = pos.sideX === "right" ? `${pos.distanceX}px` : "auto";
            btn.style.top = pos.sideY === "top" ? `${pos.distanceY}px` : "auto";
            btn.style.bottom = pos.sideY === "bottom" ? `${pos.distanceY}px` : "auto";
          } else if (pos.x !== undefined && pos.y !== undefined) {
            // Old positioning fallback
            btn.style.right = "auto";
            btn.style.bottom = "auto";
            btn.style.left = `${pos.x}px`;
            btn.style.top = `${pos.y}px`;
          }
        }
        setTimeout(clampButtonToViewport, 100);
      });
    }

    /**
     * Converts clipboard content to Markdown and inputs it into targeted input field.
     */
    const handleFloatingButtonClick = () => {
      if (!chrome.runtime?.id) return;
      
      navigator.clipboard.read().then(clipboardItems => {
        let htmlFound = false;
        
        for (const item of clipboardItems) {
          if (item.types.includes("text/html")) {
            htmlFound = true;
            item.getType("text/html").then(blob => {
              blob.text().then(htmlText => {
                const markdownText = convertToMarkdown("", htmlText, "");
                const blobPlain = new Blob([markdownText], { type: "text/plain" });
                const escapedMd = markdownText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                const htmlContent = `<div style="white-space: pre-wrap; font-family: monospace;">${escapMd}</div>`;
                const blobHtml = new Blob([htmlContent], { type: "text/html" });
                
                const clipboardData = [
                  new ClipboardItem({
                    "text/plain": blobPlain,
                    "text/html": blobHtml
                  })
                ];
                
                navigator.clipboard.write(clipboardData).then(() => {
                  insertTextAtCursor(markdownText);
                  showSuccessState();
                });
              });
            });
            break;
          }
        }
        
        if (!htmlFound) {
          for (const item of clipboardItems) {
            if (item.types.includes("text/plain")) {
              item.getType("text/plain").then(blob => {
                blob.text().then(plainText => {
                  insertTextAtCursor(plainText);
                  showSuccessState();
                });
              });
              break;
            }
          }
        }
      }).catch(err => {
        console.error("[Floating Button] Clipboard read failed:", err);
      });
    };

    /**
     * Shows visual tick animation on success.
     */
    const showSuccessState = () => {
      btn.innerHTML = "✓";
      btn.classList.add("success");
      setTimeout(() => {
        btn.innerHTML = "M";
        btn.classList.remove("success");
      }, 1000);
    };

    // Bind dragging triggers
    floatBtnDragCleanup = makeElementDraggable(btn, {
      dragThreshold: 5,
      paddingX: 10,
      paddingYTop: 10,
      paddingYBottom: 10,
      dragClass: "dragging",
      onDragEnd: ({ didDrag, rect }) => {
        if (didDrag) {
          const viewportW = window.innerWidth;
          const viewportH = window.innerHeight;
          const btnW = rect.width || 30;
          const btnH = rect.height || 30;

          const centerX = rect.left + btnW / 2;
          const sideX = centerX < viewportW / 2 ? "left" : "right";
          const distanceX = Math.max(0, sideX === "left" ? rect.left : (viewportW - rect.right));

          const centerY = rect.top + btnH / 2;
          const sideY = centerY < viewportH / 2 ? "top" : "bottom";
          const distanceY = Math.max(0, sideY === "top" ? rect.top : (viewportH - rect.bottom));

          if (isExtensionValid()) {
            chrome.storage.local.set({
              floatBtnPosition: { sideX, sideY, distanceX, distanceY }
            });
          }

          btn.style.left = sideX === "left" ? `${distanceX}px` : "auto";
          btn.style.right = sideX === "right" ? `${distanceX}px` : "auto";
          btn.style.top = sideY === "top" ? `${distanceY}px` : "auto";
          btn.style.bottom = sideY === "bottom" ? `${distanceY}px` : "auto";
        } else {
          handleFloatingButtonClick();
        }
      }
    });

    const injectBtn = () => {
      if (document.body) {
        document.body.appendChild(btn);
      } else {
        setTimeout(injectBtn, 50);
      }
    };
    injectBtn();
  };

  /**
   * Shows or hides the button based on extension local settings.
   */
  const updateFloatingButtonVisibility = () => {
    if (!isExtensionValid()) return;
    
    chrome.storage.local.get({
      enabled: true,
      mode: "global",
      activeTabIds: {}
    }, (data) => {
      if (chrome.runtime.lastError) return;
      const btn = document.getElementById("smart-markdown-floating-btn");
      
      let isActive = false;
      if (data.enabled) {
        if (data.mode === "global") {
          isActive = true;
        } else if (data.mode === "tab" && myTabId) {
          isActive = !!data.activeTabIds[myTabId];
        }
      }

      if (isActive) {
        if (!btn) {
          createFloatingMarkdownButton();
        } else {
          btn.style.display = "flex";
        }
      } else {
        if (btn) {
          btn.style.display = "none";
        }
      }
    });
  };

  /**
   * Resets positions and clamps coords if viewport layout changes.
   */
  const clampButtonToViewport = () => {
    if (!floatBtn || floatBtn.style.display === "none") return;
    
    const rect = floatBtn.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const btnW = rect.width;
    const btnH = rect.height;
    const pad = 10;

    let left = rect.left;
    let top = rect.top;
    let adjusted = false;

    if (left < pad) {
      left = pad;
      adjusted = true;
    } else if (left + btnW > viewportW - pad) {
      left = Math.max(pad, viewportW - btnW - pad);
      adjusted = true;
    }

    if (top < pad) {
      top = pad;
      adjusted = true;
    } else if (top + btnH > viewportH - pad) {
      top = Math.max(pad, viewportH - btnH - pad);
      adjusted = true;
    }

    if (adjusted) {
      const centerX = left + btnW / 2;
      const sideX = centerX < viewportW / 2 ? "left" : "right";
      const distanceX = Math.max(0, sideX === "left" ? left : (viewportW - (left + btnW)));

      const centerY = top + btnH / 2;
      const sideY = centerY < viewportH / 2 ? "top" : "bottom";
      const distanceY = Math.max(0, sideY === "top" ? top : (viewportH - (top + btnH)));

      floatBtn.style.left = sideX === "left" ? `${distanceX}px` : "auto";
      floatBtn.style.right = sideX === "right" ? `${distanceX}px` : "auto";
      floatBtn.style.top = sideY === "top" ? `${distanceY}px` : "auto";
      floatBtn.style.bottom = sideY === "bottom" ? `${distanceY}px` : "auto";
    }
  };

  // ==========================================
  // 7. OBSERVERS & LIFECYCLE LISTENERS
  // ==========================================

  const onDocumentMouseUp = (e) => {
    if (!isExtensionValid()) return;
    if (e.target.closest(".smart-copy-tooltip")) return;

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

    chrome.runtime.sendMessage({ action: "checkActive" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.isActive) return;
      if (!isExtensionValid()) return;
      
      chrome.storage.local.get({ textList: [] }, (data) => {
        if (chrome.runtime.lastError) return;
        showTooltip(e.clientX, e.clientY, selectedText, selectedHtml, data.textList, true);
      });
    });
  };

  const onDocumentKeyDown = (e) => {
    if (!isExtensionValid()) return;

    const isAKey = (e.key && e.key.toLowerCase() === 'a') || e.code === 'KeyA';
    if ((e.ctrlKey || e.metaKey) && isAKey) {
      removeTooltip();

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

          if (!isExtensionValid()) return;
          chrome.storage.local.get({ textList: [] }, (data) => {
            if (chrome.runtime.lastError) return;
            showTooltip(x, y, selectedText, selectedHtml, data.textList);
          });
        });
      }, 50);
    }
  };

  const onDocumentFocusIn = (e) => {
    const el = e.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
      lastActiveInput = el;
    }
  };

  const onWindowResize = () => {
    if (resizeAnimationFrameId) return;
    resizeAnimationFrameId = requestAnimationFrame(() => {
      clampButtonToViewport();
      resizeAnimationFrameId = null;
    });
  };

  // Bind active DOM listeners
  document.addEventListener("mouseup", onDocumentMouseUp, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  document.addEventListener("focusin", onDocumentFocusIn, true);

  // Sync state changes instantly
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (!isExtensionValid()) return;
    if (namespace === "local") {
      chrome.storage.local.get({
        enabled: true,
        mode: "global",
        activeTabIds: {}
      }, (data) => {
        if (chrome.runtime.lastError) return;
        let isActive = false;
        if (data.enabled) {
          if (data.mode === "global") {
            isActive = true;
          } else if (data.mode === "tab" && myTabId) {
            isActive = !!data.activeTabIds[myTabId];
          }
        }
        if (!isActive) {
          removeTooltip();
        }
      });
      updateFloatingButtonVisibility();
    }
  });

  // Query tab status from background on startup
  if (isExtensionValid()) {
    updateFloatingButtonVisibility();
    chrome.runtime.sendMessage({ action: "getTabInfo" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response && response.tabId !== undefined) {
        myTabId = response.tabId;
        updateFloatingButtonVisibility();
      }
    });
  }

  // Handle runtime messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionValid()) return;
    if (message.action === "zoomUpdated") {
      const btn = document.getElementById("smart-markdown-floating-btn");
      if (btn && message.zoom !== undefined) {
        btn.style.setProperty("--zoom-scale", 1 / message.zoom);
      }
    }
  });

  // Track runtime connection to detect background worker reloads (orphan state cleanup)
  try {
    const port = chrome.runtime.connect({ name: "smart-multi-copy-sync" });
    port.onDisconnect.addListener(() => {
      console.log("[MultiCopy Content] Port disconnected - script orphaned. Cleaning up UI...");
      
      if (floatBtn) {
        if (floatBtnDragCleanup) {
          floatBtnDragCleanup();
          floatBtnDragCleanup = null;
        }
        floatBtn.remove();
        floatBtn = null;
      }
      
      removeTooltip();

      document.removeEventListener("mouseup", onDocumentMouseUp, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      document.removeEventListener("focusin", onDocumentFocusIn, true);
      window.removeEventListener("resize", onWindowResize);
    });
  } catch (e) {
    console.debug("[MultiCopy Content] Sync port connection failed:", e);
  }
})();