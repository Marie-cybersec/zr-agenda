// Composants d'interface partagés.

import { html, useEffect, useLayoutEffect, useRef, useState } from './lib.js'
import { Icon } from './icons.js'
import { useUi, dismissToast } from './store.js'

export const cx = (...a) => a.filter(Boolean).join(' ')

// Élément flottant ancré (popover, menu). anchor = DOMRect ou { x, y }.
export function Floating({ anchor, onClose, children, placement = 'bottom-start', class: cls = '', offset = 6, width }) {
  const ref = useRef()
  const [pos, setPos] = useState({ left: -9999, top: -9999 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !anchor) return
    const a = 'width' in anchor ? anchor : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 }
    const w = el.offsetWidth, h = el.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    let left, top
    if (placement.startsWith('right')) {
      left = a.right + offset
      if (left + w > vw - 8) left = a.left - w - offset
      top = a.top
    } else {
      left = placement.endsWith('end') ? a.right - w : a.left
      top = placement.startsWith('top') ? a.top - h - offset : a.bottom + offset
      if (top + h > vh - 8) top = a.top - h - offset
    }
    left = Math.max(8, Math.min(left, vw - w - 8))
    top = Math.max(8, Math.min(top, vh - h - 8))
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return html`
    <div class="floating-layer" onMouseDown=${e => { if (e.target === e.currentTarget) onClose() }}
      onContextMenu=${e => { e.preventDefault(); onClose() }}>
      <div ref=${ref} class=${cx('floating', cls)} style=${{ left: pos.left + 'px', top: pos.top + 'px', width: width ? width + 'px' : undefined }}>
        ${children}
      </div>
    </div>`
}

export function Menu({ items, onClose }) {
  return html`<div class="menu">
    ${items.map((it, i) => it === '-' ? html`<div class="menu-sep" key=${i}></div>` : html`
      <button key=${i} class=${cx('menu-item', it.danger && 'danger')} disabled=${it.disabled}
        onClick=${() => { onClose && onClose(); it.onClick() }}>
        ${it.icon && html`<${Icon} name=${it.icon} size=${15} />`}
        ${it.color && html`<span class="dot" style=${{ background: it.color }}></span>`}
        <span class="menu-label">${it.label}</span>
        ${it.checked && html`<${Icon} name="check" size=${14} class="menu-check" />`}
        ${it.hint && html`<span class="menu-hint">${it.hint}</span>`}
      </button>`)}
  </div>`
}

export function Modal({ onClose, children, class: cls = '', width = 520, labelledBy }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return html`
    <div class="modal-layer" onMouseDown=${e => { if (e.target === e.currentTarget) onClose() }}>
      <div class=${cx('modal', cls)} style=${{ width: width + 'px' }} role="dialog" aria-modal="true" aria-labelledby=${labelledBy}>
        ${children}
      </div>
    </div>`
}

export function DialogHost() {
  const { dialog } = useUi()
  if (!dialog) return null
  return html`<${Dialog} dialog=${dialog} />`
}

function Dialog({ dialog }) {
  const first = useRef()
  const inputRef = useRef()
  const [val, setVal] = useState(dialog.input?.value || '')
  useEffect(() => { (inputRef.current || first.current)?.focus() }, [])
  const actions = dialog.actions || [{ label: 'Annuler', value: false }, { label: 'Confirmer', value: true, tone: 'primary' }]
  const resolve = v => dialog.resolve(dialog.input && v === true ? val : v)
  return html`
    <${Modal} onClose=${() => dialog.resolve(null)} width=${dialog.width || 420} class="dialog">
      <div class="dialog-body">
        <h3 class="dialog-title">${dialog.title}</h3>
        ${dialog.message && html`<p class="dialog-text">${dialog.message}</p>`}
        ${dialog.input && html`<input ref=${inputRef} class="input" type=${dialog.input.type || 'text'} placeholder=${dialog.input.placeholder}
          value=${val} onInput=${e => setVal(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') resolve(true) }} />`}
      </div>
      <div class=${cx('dialog-actions', dialog.stacked && 'stacked')}>
        ${actions.map(a => html`
          <button ref=${a.tone === 'primary' || a.tone === 'danger' ? first : null}
            class=${cx('btn', a.tone === 'primary' && 'btn-primary', a.tone === 'danger' && 'btn-danger', !a.tone && 'btn-secondary')}
            onClick=${() => resolve(a.value)}>${a.label}</button>`)}
      </div>
    <//>`
}

export function Toasts() {
  const { toasts } = useUi()
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map(t => html`
      <div class="toast" key=${t.id}>
        <span>${t.message}</span>
        ${t.action && html`<button class="toast-action" onClick=${() => { dismissToast(t.id); t.onAction() }}>${t.action}</button>`}
        <button class="toast-close" aria-label="Fermer" onClick=${() => dismissToast(t.id)}><${Icon} name="x" size=${14} /></button>
      </div>`)}
  </div>`
}

export function Segmented({ value, options, onChange, size }) {
  return html`<div class=${cx('segmented', size === 'sm' && 'sm')} role="tablist">
    ${options.map(o => html`
      <button role="tab" aria-selected=${value === o.value} class=${cx('seg', value === o.value && 'active')}
        title=${o.title || ''} onClick=${() => onChange(o.value)}>${o.icon ? html`<${Icon} name=${o.icon} size=${15} />` : null}${o.label}</button>`)}
  </div>`
}

export function Switch({ checked, onChange, label }) {
  return html`<button role="switch" aria-checked=${!!checked} aria-label=${label}
    class=${cx('switch', checked && 'on')} onClick=${() => onChange(!checked)}><span></span></button>`
}

export function Checkbox({ checked, onChange, color, round, label, size = 16 }) {
  return html`<button role="checkbox" aria-checked=${!!checked} aria-label=${label}
    class=${cx('check', round && 'round', checked && 'on')} style=${{ '--c': color || 'var(--accent)', width: size + 'px', height: size + 'px' }}
    onClick=${e => { e.stopPropagation(); onChange(!checked) }}>
    ${checked && html`<${Icon} name="check" size=${size - 4} stroke=${2.5} />`}
  </button>`
}

export function Kbd({ children }) {
  return html`<kbd class="kbd">${children}</kbd>`
}

export function Empty({ icon, title, text, action }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${22} /></div>
    <div class="empty-title">${title}</div>
    ${text && html`<div class="empty-text">${text}</div>`}
    ${action}
  </div>`
}

export function IconButton({ icon, label, onClick, active, size = 16, class: cls = '', kbd }) {
  return html`<button class=${cx('icon-btn', active && 'active', cls)} aria-label=${label}
    title=${label + (kbd ? ' (' + kbd + ')' : '')} onClick=${onClick}><${Icon} name=${icon} size=${size} /></button>`
}

// Champ texte qui s'agrandit avec son contenu.
export function AutoTextarea({ value, onInput, placeholder, class: cls = '', minRows = 2 }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const el = ref.current
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return html`<textarea ref=${ref} class=${cls} rows=${minRows} placeholder=${placeholder} value=${value}
    onInput=${e => onInput(e.target.value)}></textarea>`
}
