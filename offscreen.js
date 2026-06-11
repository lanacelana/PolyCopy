/**
 * Smart Multi-Copy Highlight - Offscreen Document Script
 * 
 * Executes clipboard read commands within a DOM-enabled extension context.
 * 
 * Crafted by lncln
 */

(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen' && message.action === 'read-clipboard') {
      try {
        const div = document.createElement("div");
        div.contentEditable = "true";
        document.body.appendChild(div);

        // Select the contenteditable element to target the paste operation
        const range = document.createRange();
        range.selectNodeContents(div);
        
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        div.focus();
        
        // Execute the paste command (supported in offscreen documents with clipboardRead permission)
        const success = document.execCommand('paste');
        
        const htmlText = div.innerHTML;
        const plainText = div.innerText || div.textContent;

        document.body.removeChild(div);

        sendResponse({ success, htmlText, plainText });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true; // Keep message channel open for response
    }
  });
})();
