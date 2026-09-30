import { measureLineStats, prepareWithSegments } from "@chenglou/pretext";

// Preserve enlarged type; allocate wrapped button height from measured text.
export function fitPanelButtons(root: HTMLElement): () => void {
  let frame = 0;
  let stopped = false;
  const fit = () => {
    frame = 0;
    for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
      const style = getComputedStyle(button);
      const width = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width <= 0 || !button.textContent) continue;
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const prepared = prepareWithSegments(button.textContent, font, {
        letterSpacing: parseFloat(style.letterSpacing) || 0,
      });
      const lines = measureLineStats(prepared, Math.max(1, width - 2)).lineCount;
      const height = Math.max(44, lines * (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5)
        + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
      button.style.whiteSpace = "normal";
      const minimum = `${Math.ceil(height)}px`;
      if (button.style.minHeight !== minimum) button.style.minHeight = minimum;
    }
  };
  const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(fit); };
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  const changes = new MutationObserver(schedule);
  changes.observe(root, { childList: true, characterData: true, subtree: true });
  void document.fonts?.ready.then(schedule);
  schedule();
  return () => { stopped = true; cancelAnimationFrame(frame); resize.disconnect(); changes.disconnect(); };
}

