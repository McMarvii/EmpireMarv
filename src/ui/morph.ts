/**
 * Brings `el` to the markup in `html` while keeping every element whose tag still matches.
 *
 * Replacing `innerHTML` creates new buttons on each refresh. Under a resting cursor that drops the
 * hover state for a frame (flicker), and a click whose mousedown and mouseup land on two different
 * copies of a button never fires. Patching attributes and text in place leaves the button itself alone.
 */
export function morph(el: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  patchChildren(el, tpl.content);
}

function patchChildren(cur: Node, next: Node): void {
  const wanted = Array.from(next.childNodes);
  for (let i = 0; i < wanted.length; i++) {
    const n = wanted[i];
    const c = cur.childNodes[i];
    if (!c) {
      cur.appendChild(n);
    } else if (c.nodeType !== n.nodeType || c.nodeName !== n.nodeName) {
      cur.replaceChild(n, c);
    } else if (c.nodeType === Node.ELEMENT_NODE) {
      patchAttributes(c as Element, n as Element);
      patchChildren(c, n);
    } else if (c.nodeValue !== n.nodeValue) {
      c.nodeValue = n.nodeValue;
    }
  }
  while (cur.childNodes.length > wanted.length) cur.removeChild(cur.lastChild!);
}

function patchAttributes(cur: Element, next: Element): void {
  for (const a of Array.from(cur.attributes)) if (!next.hasAttribute(a.name)) cur.removeAttribute(a.name);
  for (const a of Array.from(next.attributes)) if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
}
