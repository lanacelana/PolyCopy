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
  let iframeObserver = null;
  let syncPort = null;
  
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
    const lingeringContainer = document.getElementById("smart-markdown-floating-container");
    if (lingeringContainer) lingeringContainer.remove();

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
      } else if (key === "textContent" || key === "innerText") {
        element[key] = val;
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
   * Recursively finds all open ShadowRoots starting from a given element.
   * @param {Element|ShadowRoot} [root=document.documentElement]
   * @returns {ShadowRoot[]}
   */
  const getAllShadowRoots = (root = document.documentElement) => {
    const roots = [];
    const walk = (node) => {
      if (!node) return;
      if (node.shadowRoot) {
        roots.push(node.shadowRoot);
        walk(node.shadowRoot);
      }
      let child = node.firstElementChild;
      while (child) {
        walk(child);
        child = child.nextElementSibling;
      }
    };
    walk(root);
    return roots;
  };

  /**
   * Resolves the actual active element inside Shadow DOM boundaries.
   * @returns {Element}
   */
  const getDeepActiveElement = () => {
    let activeEl = document.activeElement;
    while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
      activeEl = activeEl.shadowRoot.activeElement;
    }
    return activeEl;
  };

  /**
   * Retrieves selection text, range, and HTML from the document, traversing Shadow DOM if present.
   * Also falls back to text/textarea inputs selection.
   * @returns {{text: string, html: string, range: Range|null}}
   */
  const getComposedSelection = () => {
    let text = "";
    let html = "";
    let range = null;

    const selection = window.getSelection();
    if (selection) {
      text = selection.toString().trim();
      if (text) {
        if (typeof selection.getComposedRanges === "function") {
          const shadowRoots = getAllShadowRoots();
          const composedRanges = selection.getComposedRanges({ shadowRoots });
          if (composedRanges && composedRanges.length > 0) {
            const staticRange = composedRanges[0];
            try {
              range = document.createRange();
              range.setStart(staticRange.startContainer, staticRange.startOffset);
              range.setEnd(staticRange.endContainer, staticRange.endOffset);
            } catch (e) {
              range = null;
            }
          }
        }
        if (!range && selection.rangeCount > 0) {
          range = selection.getRangeAt(0);
        }
      }
    }

    if (!text) {
      const activeEl = getDeepActiveElement();
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) {
        try {
          const start = activeEl.selectionStart;
          const end = activeEl.selectionEnd;
          if (start !== undefined && end !== undefined && start !== end) {
            text = activeEl.value.substring(start, end).trim();
            html = text;
          }
        } catch (e) {}
      }
    }

    if (range && !html) {
      try {
        const fragment = range.cloneContents();
        const elementsToRemove = fragment.querySelectorAll("style, script");
        elementsToRemove.forEach(el => el.remove());
        const container = document.createElement("div");
        container.appendChild(fragment);
        html = container.innerHTML;
      } catch (e) {
        html = text;
      }
    }

    return { text, html, range };
  };

  /**
   * Helper to locate the source iframe element inside the main document.
   * Checks for a single iframe, focused element, and matches iframe source URL.
   * @param {string} iframeUrl - The source URL of the iframe to find.
   * @returns {HTMLIFrameElement|null}
   */
  const findIframe = (iframeUrl) => {
    const iframes = Array.from(document.querySelectorAll("iframe"));
    if (iframes.length === 0) return null;
    if (iframes.length === 1) return iframes[0];

    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName === "IFRAME") {
      return activeEl;
    }

    if (iframeUrl) {
      if (iframeUrl === "about:srcdoc" || iframeUrl === "about:blank" || iframeUrl.startsWith("about:")) {
        for (const iframe of iframes) {
          if (iframe.hasAttribute("srcdoc") || !iframe.src || iframe.src === "about:blank") {
            return iframe;
          }
        }
      }

      const cleanUrl = iframeUrl.split(/[?#]/)[0];
      for (const iframe of iframes) {
        try {
          if (iframe.src) {
            const iframeSrc = iframe.src.split(/[?#]/)[0];
            if (iframeSrc === cleanUrl || iframeSrc.endsWith(cleanUrl) || cleanUrl.endsWith(iframeSrc)) {
              return iframe;
            }
          }
        } catch (e) {}
      }
    }
    return null;
  };

  /**
   * Renders selection tooltip on the top-level main document viewport,
   * calculating the coordinate offset of the source iframe.
   * @param {Object} data - Selection and coordinate data sent from iframe.
   */
  const handleShowIframeSelection = (data) => {
    const { text, html, clientX, clientY, iframeUrl, isKeyboard } = data;
    
    let x = clientX;
    let y = clientY;
    
    if (isKeyboard) {
      const tooltipWidth = 240;
      x = (window.innerWidth / 2) - (tooltipWidth / 2);
      y = 80;
    } else {
      const iframeEl = findIframe(iframeUrl);
      if (iframeEl) {
        const rect = iframeEl.getBoundingClientRect();
        x = rect.left + clientX;
        y = rect.top + clientY;
      } else {
        // Fallback to center screen if iframe is missing/hidden
        const tooltipWidth = 240;
        x = (window.innerWidth / 2) - (tooltipWidth / 2);
        y = 120;
      }
    }
    
    removeTooltip();
    
    chrome.storage.local.get({ textList: [] }, (storageData) => {
      if (chrome.runtime.lastError) return;
      showTooltip(x, y, text, html, storageData.textList, !isKeyboard);
    });
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
            el("span", { title: cleanText }, [`${prefix}${displayWords}${hasMore ? "..." : ""}`]),
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
          plain: `Source: ${currentUrl}\n${plainText}\n`,
          html: `<div><span style="font-size:13px; color:#f2ffe5;">Source: <a href="${currentUrl}" target="_blank" style="color:#dfff00;">${currentUrl}</a></span><br>${htmlText}<br></div>`
        };
        const newList = [newItem, ...textList];
        setSuccessEffect(btnAddLink, "✓ Copied!", () => {
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
        setSuccessEffect(btnAddText, "✓ Copied!", () => {
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
   * Instantiates the floating action buttons container (Paste & Clear).
   */
  const createFloatingMarkdownButton = () => {
    if (document.getElementById("smart-markdown-floating-container")) return;

    let didDragActive = false;

    const btnPaste = el("button", {
      id: "smart-markdown-floating-btn",
      title: "Paste Clipboard as Markdown",
      onclick: (e) => {
        e.stopPropagation();
        if (didDragActive) {
          didDragActive = false;
          return;
        }
        handleFloatingButtonClick();
      }
    }, ["P"]);

    const btnClear = el("button", {
      id: "smart-markdown-clear-btn",
      title: "Clear Clipboard Buffer",
      onclick: (e) => {
        e.stopPropagation();
        if (didDragActive) {
          didDragActive = false;
          return;
        }
        handleClearButtonClick();
      }
    }, ["C"]);

    const container = el("div", {
      id: "smart-markdown-floating-container"
    }, [btnPaste, btnClear]);

    // Reset didDragActive state on every mousedown
    container.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      didDragActive = false;
    });

    // Query and set proper Zoom scale
    if (isExtensionValid()) {
      chrome.runtime.sendMessage({ action: "getZoom" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.zoom !== undefined) {
          container.style.setProperty("--zoom-scale", 1 / response.zoom);
        }
      });
    }

    floatBtn = container;
    window.addEventListener("resize", onWindowResize);

    // Recover container coordinates
    if (isExtensionValid()) {
      chrome.storage.local.get({ floatBtnPosition: null }, (data) => {
        if (chrome.runtime.lastError) return;
        if (data.floatBtnPosition) {
          const pos = data.floatBtnPosition;
          if (pos.sideX && pos.sideY) {
            container.style.left = pos.sideX === "left" ? `${pos.distanceX}px` : "auto";
            container.style.right = pos.sideX === "right" ? `${pos.distanceX}px` : "auto";
            container.style.top = pos.sideY === "top" ? `${pos.distanceY}px` : "auto";
            container.style.bottom = pos.sideY === "bottom" ? `${pos.distanceY}px` : "auto";
          } else if (pos.x !== undefined && pos.y !== undefined) {
            // Old positioning fallback
            container.style.right = "auto";
            container.style.bottom = "auto";
            container.style.left = `${pos.x}px`;
            container.style.top = `${pos.y}px`;
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

      chrome.runtime.sendMessage({ action: "readClipboard" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[Floating Button] Clipboard request failed:", chrome.runtime.lastError);
          return;
        }

        if (response && response.success) {
          const { htmlText, plainText } = response;

          // If htmlText contains formatted HTML, convert it to markdown
          if (htmlText && htmlText.trim().length > 0) {
            const markdownText = convertToMarkdown("", htmlText, "");
            
            // Re-write the converted markdown back to clipboard as both plain and formatted text
            if (navigator.clipboard && window.isSecureContext) {
              try {
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
                }).catch(() => {
                  // Fallback write if browser denies write permission in this page context
                  insertTextAtCursor(markdownText);
                  showSuccessState();
                });
              } catch (err) {
                insertTextAtCursor(markdownText);
                showSuccessState();
              }
            } else {
              insertTextAtCursor(markdownText);
              showSuccessState();
            }
          } else if (plainText) {
            insertTextAtCursor(plainText);
            showSuccessState();
          }
        } else {
          console.error("[Floating Button] Offscreen clipboard read failed:", response?.error);
        }
      });
    };

    /**
     * Clears the copied text buffer.
     */
    const handleClearButtonClick = () => {
      if (!chrome.runtime?.id) return;
      chrome.storage.local.set({ textList: [] }, () => {
        if (chrome.runtime.lastError) return;
        showClearSuccessState();
        triggerClipboardUpdate([], true);
      });
    };

    /**
     * Shows visual tick animation on success.
     */
    const showSuccessState = () => {
      btnPaste.innerHTML = "✓";
      btnPaste.classList.add("success");
      setTimeout(() => {
        btnPaste.innerHTML = "P";
        btnPaste.classList.remove("success");
      }, 1000);
    };

    /**
     * Shows visual tick animation on clearing.
     */
    const showClearSuccessState = () => {
      btnClear.innerHTML = "✓";
      btnClear.classList.add("success");
      setTimeout(() => {
        btnClear.innerHTML = "C";
        btnClear.classList.remove("success");
      }, 1000);
    };

    // Bind dragging triggers to container
    floatBtnDragCleanup = makeElementDraggable(container, {
      dragThreshold: 5,
      paddingX: 10,
      paddingYTop: 10,
      paddingYBottom: 10,
      dragClass: "dragging",
      onDragEnd: ({ didDrag, rect }) => {
        didDragActive = didDrag;
        if (didDrag) {
          const viewportW = window.innerWidth;
          const viewportH = window.innerHeight;
          const btnW = rect.width || 66; // container width (2 x 30px + gap)
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

          container.style.left = sideX === "left" ? `${distanceX}px` : "auto";
          container.style.right = sideX === "right" ? `${distanceX}px` : "auto";
          container.style.top = sideY === "top" ? `${distanceY}px` : "auto";
          container.style.bottom = sideY === "bottom" ? `${distanceY}px` : "auto";
        }
      }
    });

    const injectBtn = () => {
      if (document.body) {
        document.body.appendChild(container);
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
      const container = document.getElementById("smart-markdown-floating-container");
      
      let isActive = false;
      if (data.enabled) {
        if (data.mode === "global") {
          isActive = true;
        } else if (data.mode === "tab" && myTabId) {
          isActive = !!data.activeTabIds[myTabId];
        }
      }

      // Hide the top-level button if there is a large iframe on the page to prevent duplicate buttons
      if (isActive && window === window.top) {
        const hasLargeIframe = Array.from(document.querySelectorAll("iframe")).some(iframe => {
          const rect = iframe.getBoundingClientRect();
          return rect.width > 400 && rect.height > 300;
        });
        if (hasLargeIframe) {
          isActive = false;
        }
      }

      // Hide the sub-frame button if the sub-frame does not contain any input fields
      if (isActive && window !== window.top) {
        const hasInputs = !!document.querySelector("input, textarea, [contenteditable]:not([contenteditable='false'])");
        if (!hasInputs) {
          isActive = false;
        }
      }

      if (isActive) {
        if (!container) {
          createFloatingMarkdownButton();
        } else {
          container.style.display = "flex";
        }
      } else {
        if (container) {
          container.style.display = "none";
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

    const { text: selectedText, html: selectedHtml } = getComposedSelection();

    if (selectedText.length === 0) {
      removeTooltip();
      if (window !== window.top) {
        chrome.runtime.sendMessage({ action: "iframeClearSelection" });
      }
      return;
    }

    if (window !== window.top) {
      // Delegate displaying the selection tooltip to the parent window
      chrome.runtime.sendMessage({
        action: "iframeSelection",
        text: selectedText,
        html: selectedHtml,
        clientX: e.clientX,
        clientY: e.clientY,
        iframeUrl: window.location.href,
        isKeyboard: false
      });
      return;
    }

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
        const { text: selectedText, html: selectedHtml } = getComposedSelection();

        if (selectedText.length === 0) return;

        if (window !== window.top) {
          // Delegate displaying the selection tooltip to the parent window
          chrome.runtime.sendMessage({
            action: "iframeSelection",
            text: selectedText,
            html: selectedHtml,
            iframeUrl: window.location.href,
            isKeyboard: true
          });
          return;
        }

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
    const path = e.composedPath();
    const el = path && path.length > 0 ? path[0] : e.target;
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
      const container = document.getElementById("smart-markdown-floating-container");
      if (container && message.zoom !== undefined) {
        container.style.setProperty("--zoom-scale", 1 / message.zoom);
      }
    } else if (message.action === "showIframeSelection") {
      if (window === window.top) {
        handleShowIframeSelection(message);
      }
    } else if (message.action === "clearIframeSelection") {
      if (window === window.top) {
        removeTooltip();
      }
    }
  });

  /**
   * Completely detaches event listeners and deletes injected UI elements when extension is orphaned.
   */
  const cleanupOrphanedUI = () => {
    if (floatBtn) {
      if (floatBtnDragCleanup) {
        floatBtnDragCleanup();
        floatBtnDragCleanup = null;
      }
      floatBtn.remove();
      floatBtn = null;
    }
    
    if (iframeObserver) {
      iframeObserver.disconnect();
      iframeObserver = null;
    }
    
    removeTooltip();

    document.removeEventListener("mouseup", onDocumentMouseUp, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    document.removeEventListener("focusin", onDocumentFocusIn, true);
    window.removeEventListener("resize", onWindowResize);
  };

  /**
   * Connects sync port to background worker and handles auto-reconnections.
   */
  const connectSyncPort = () => {
    if (!isExtensionValid()) return;
    try {
      syncPort = chrome.runtime.connect({ name: "smart-multi-copy-sync" });
      syncPort.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError;
        
        // If extension context has been invalidated, cleanup the orphaned scripts
        const isInvalidated = !isExtensionValid() || (err && err.message.includes("context invalidated"));
        
        if (isInvalidated) {
          console.log("[MultiCopy Content] Extension context invalidated. Cleaning up UI...");
          cleanupOrphanedUI();
        } else {
          console.log("[MultiCopy Content] Port disconnected (Service Worker asleep). Reconnecting...");
          setTimeout(connectSyncPort, 1000);
        }
      });
    } catch (e) {
      console.debug("[MultiCopy Content] Sync port connection failed:", e);
    }
  };

  // Initialize runtime port connection
  connectSyncPort();

  // Monitor DOM mutations to re-inject the button if it's wiped by the host page,
  // and to manage top-level button visibility when large workspace iframes are added/removed.
  if (isExtensionValid()) {
    iframeObserver = new MutationObserver((mutations) => {
      let shouldRecheck = false;
      
      // 1. If our container should be active but is deleted from the body, trigger re-injection
      const container = document.getElementById("smart-markdown-floating-container");
      if (!container) {
        shouldRecheck = true;
      }

      // 2. For the top-level frame, check if a large task iframe was added/removed to toggle top-level button visibility
      if (window === window.top) {
        for (const mutation of mutations) {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          for (const node of nodes) {
            if (node.tagName === "IFRAME" || (node.querySelectorAll && node.querySelectorAll("iframe").length > 0)) {
              shouldRecheck = true;
              break;
            }
          }
          if (shouldRecheck) break;
        }
      }

      // 3. For sub-frames, check if input elements were added or removed to toggle button visibility
      if (window !== window.top && !shouldRecheck) {
        for (const mutation of mutations) {
          const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
          for (const node of nodes) {
            if (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || (node.querySelectorAll && node.querySelectorAll("input, textarea, [contenteditable]:not([contenteditable='false'])").length > 0)) {
              shouldRecheck = true;
              break;
            }
          }
          if (shouldRecheck) break;
        }
      }

      if (shouldRecheck) {
        updateFloatingButtonVisibility();
      }
    });

    iframeObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();