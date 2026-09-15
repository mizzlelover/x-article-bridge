function dispatchHtml(root, html) {
  root.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(root);
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (!document.execCommand("insertHTML", false, html)) {
    range.deleteContents();
    const fragment = range.createContextualFragment(html);
    range.insertNode(fragment);
  }
  root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: null }));
}
