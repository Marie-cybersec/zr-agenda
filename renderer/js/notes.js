import { html, useState, useEffect, useRef, useMemo } from './lib.js'
import { fmtRelativeDay, fmtTime, diffDays } from './dates.js'
import { Icon } from './icons.js'
import { IconButton, Empty, Floating, Menu, cx } from './ui.js'
import { useDb, useUi, db, setUi, addNote, updateNote, removeNote, mutate, withUndo, toast, uid, ask, CAL_COLORS } from './store.js'

export const stripHtml = s => {
  const d = document.createElement('div')
  d.innerHTML = s || ''
  d.querySelectorAll('li, p, div, h1, h2, h3, blockquote, pre, br').forEach(n => n.append(' '))
  return (d.textContent || '').replace(/\s+/g, ' ').trim()
}

// Nettoie le HTML collé / stocké : seules les balises de mise en forme sont conservées.
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'P', 'DIV', 'BR', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'HR', 'SPAN'])
export function sanitize(htmlText) {
  const tpl = document.createElement('template')
  tpl.innerHTML = htmlText
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!ALLOWED.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) { child.remove(); continue }
          walk(child)
          child.replaceWith(...child.childNodes)
          continue
        }
        for (const a of [...child.attributes]) {
          const keep = (child.tagName === 'A' && a.name === 'href' && /^(https?:|mailto:)/i.test(a.value)) ||
            (child.tagName === 'UL' && a.name === 'class' && a.value === 'checklist') ||
            (child.tagName === 'LI' && a.name === 'class' && a.value === 'checked')
          if (!keep) child.removeAttribute(a.name)
        }
        if (child.tagName === 'A') child.setAttribute('target', '_blank')
        walk(child)
      }
    }
  }
  walk(tpl.content)
  return tpl.innerHTML
}

function htmlToMarkdown(h) {
  const tpl = document.createElement('template')
  tpl.innerHTML = h
  const conv = (node, ctx = {}) => [...node.childNodes].map(n => {
    if (n.nodeType === 3) return n.textContent
    if (n.nodeType !== 1) return ''
    const inner = () => conv(n, ctx)
    switch (n.tagName) {
      case 'B': case 'STRONG': return '**' + inner() + '**'
      case 'I': case 'EM': return '_' + inner() + '_'
      case 'S': case 'STRIKE': return '~~' + inner() + '~~'
      case 'CODE': return '`' + inner() + '`'
      case 'A': return '[' + inner() + '](' + n.getAttribute('href') + ')'
      case 'H1': return '\n# ' + inner() + '\n'
      case 'H2': return '\n## ' + inner() + '\n'
      case 'H3': return '\n### ' + inner() + '\n'
      case 'BLOCKQUOTE': return '\n> ' + inner().trim().replace(/\n/g, '\n> ') + '\n'
      case 'PRE': return '\n```\n' + n.textContent + '\n```\n'
      case 'HR': return '\n---\n'
      case 'BR': return '\n'
      case 'UL': case 'OL': {
        const check = n.classList.contains('checklist')
        return '\n' + [...n.children].map((li, i) => (check ? (li.classList.contains('checked') ? '- [x] ' : '- [ ] ') : n.tagName === 'OL' ? (i + 1) + '. ' : '- ') + conv(li).trim()).join('\n') + '\n'
      }
      case 'P': case 'DIV': return '\n' + inner()
      default: return inner()
    }
  }).join('')
  return conv(tpl.content).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function noteDate(iso) {
  const d = new Date(iso), now = new Date()
  const n = diffDays(d, now)
  if (n === 0) return fmtTime(d)
  if (n < 7) return fmtRelativeDay(d, now)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

export function NotesSection() {
  const d = useDb()
  const u = useUi()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const filter = u.notebookFilter
  const q = query.trim().toLowerCase()

  const list = useMemo(() => {
    let l = d.notes
    if (filter === 'pinned') l = l.filter(n => n.pinned)
    else if (filter !== 'all') l = l.filter(n => n.notebookId === filter)
    if (q) l = l.filter(n => n.title.toLowerCase().includes(q) || stripHtml(n.content).toLowerCase().includes(q))
    return l.slice().sort((a, b) => (b.pinned - a.pinned) ||
      (sort === 'title' ? (a.title || '').localeCompare(b.title || '', 'fr') : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)))
  }, [d.notes, filter, q, sort])

  const current = d.notes.find(n => n.id === u.selectedNote)
  const create = () => {
    const n = addNote({ notebookId: filter !== 'all' && filter !== 'pinned' ? filter : null, pinned: filter === 'pinned' })
    setUi({ selectedNote: n.id })
  }

  const newNotebook = () => {
    setUi({ popover: { kind: 'notebook-new', rect: document.querySelector('.nb-add').getBoundingClientRect() } })
  }

  return html`
    <section class="section notes-section">
      <div class="notes-layout">
        <nav class="nb-pane">
          <div class="pane-title">Carnets</div>
          <button class=${cx('nb-link', filter === 'all' && 'active')} onClick=${() => setUi({ notebookFilter: 'all' })}>
            <${Icon} name="inbox" size=${15} /><span>Toutes les notes</span><span class="count">${d.notes.length}</span></button>
          <button class=${cx('nb-link', filter === 'pinned' && 'active')} onClick=${() => setUi({ notebookFilter: 'pinned' })}>
            <${Icon} name="pin" size=${15} /><span>Épinglées</span><span class="count">${d.notes.filter(n => n.pinned).length}</span></button>
          <div class="nb-sep"></div>
          ${d.notebooks.map(nb => html`
            <button class=${cx('nb-link', filter === nb.id && 'active')} key=${nb.id} onClick=${() => setUi({ notebookFilter: nb.id })}
              onContextMenu=${e => { e.preventDefault(); setUi({ popover: { kind: 'notebook-menu', rect: { x: e.clientX, y: e.clientY }, payload: nb } }) }}>
              <span class="nb-swatch" style=${{ background: nb.color }}></span><span>${nb.name}</span>
              <span class="count">${d.notes.filter(n => n.notebookId === nb.id).length}</span>
            </button>`)}
          <button class="nb-link nb-add" onClick=${newNotebook}><${Icon} name="plus" size=${15} /><span>Nouveau carnet</span></button>
        </nav>

        <div class="note-list-pane">
          <div class="nl-head">
            <div class="search-field grow"><${Icon} name="search" size=${14} />
              <input placeholder="Rechercher dans les notes" value=${query} onInput=${e => setQuery(e.target.value)} /></div>
            <${IconButton} icon="plus" label="Nouvelle note" kbd="Ctrl+N" onClick=${create} />
          </div>
          <div class="nl-sort">
            <span>${list.length} note${list.length > 1 ? 's' : ''}</span>
            <select class="ghost-select" value=${sort} onChange=${e => setSort(e.target.value)}>
              <option value="updated">Modifiées récemment</option>
              <option value="created">Créées récemment</option>
              <option value="title">Titre (A → Z)</option>
            </select>
          </div>
          <div class="nl-items">
            ${list.length === 0 && html`<${Empty} icon="note" title=${q ? 'Aucun résultat' : 'Aucune note'}
              text=${q ? 'Aucune note ne contient « ' + query + ' ».' : 'Capturez une idée, un compte rendu ou une liste.'}
              action=${!q && html`<button class="btn btn-secondary" onClick=${create}>Nouvelle note</button>`} />`}
            ${list.map(n => {
              const nb = d.notebooks.find(x => x.id === n.notebookId)
              const preview = stripHtml(n.content)
              return html`<button key=${n.id} class=${cx('nl-item', n.id === u.selectedNote && 'active')} onClick=${() => setUi({ selectedNote: n.id })}>
                <div class="nl-title">${n.pinned && html`<${Icon} name="pin" size=${12} class="pin" />`}${n.title || 'Sans titre'}</div>
                <div class="nl-preview">${preview || 'Aucun contenu'}</div>
                <div class="nl-meta">${noteDate(n.updatedAt)}${nb && html`<span class="nl-nb"><span class="nb-swatch sm" style=${{ background: nb.color }}></span>${nb.name}</span>`}</div>
              </button>`
            })}
          </div>
        </div>

        ${current ? html`<${NoteEditor} key=${current.id} note=${current} />` : html`
          <div class="note-empty"><${Empty} icon="note" title="Sélectionnez une note"
            text="Ou créez-en une nouvelle. Astuce : tapez « # » ou « - » en début de ligne pour mettre en forme."
            action=${html`<button class="btn btn-primary" onClick=${create}><${Icon} name="plus" size=${15} />Nouvelle note</button>`} /></div>`}
      </div>
    </section>`
}

function NoteEditor({ note }) {
  const d = db()
  const ref = useRef()
  const initial = useRef(sanitize(note.content || ''))
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [saved, setSaved] = useState(true)
  const [blockType, setBlockType] = useState('p')
  const timer = useRef()

  const computeStats = () => {
    const txt = ref.current ? ref.current.innerText : ''
    const words = (txt.match(/[\p{L}\p{N}’'-]+/gu) || []).length
    setStats({ words, chars: txt.replace(/\n/g, '').length })
  }

  useEffect(() => {
    computeStats()
    if (!note.title && !note.content) document.querySelector('.ne-title')?.focus()
    return () => { clearTimeout(timer.current); persist() }
  }, [])

  const persist = () => {
    if (!ref.current) return
    const content = ref.current.innerHTML
    const cur = db().notes.find(n => n.id === note.id)
    if (cur && cur.content !== content) updateNote(note.id, { content })
    setSaved(true)
  }

  const onInput = () => {
    setSaved(false)
    clearTimeout(timer.current)
    timer.current = setTimeout(persist, 500)
    computeStats()
  }

  const exec = (cmd, val) => {
    ref.current.focus()
    document.execCommand(cmd, false, val)
    onInput()
    updateBlockType()
  }

  const setBlock = tag => {
    const cur = document.queryCommandValue('formatBlock').toLowerCase()
    exec('formatBlock', cur === tag ? 'p' : tag)
  }

  const insertChecklist = () => {
    exec('insertUnorderedList')
    const sel = window.getSelection()
    const li = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('ul')
    if (li) li.classList.toggle('checklist')
    onInput()
  }

  const insertLink = async () => {
    const sel = window.getSelection()
    const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    const url = await ask({
      title: 'Insérer un lien', input: { placeholder: 'https://…' },
      actions: [{ label: 'Annuler', value: false }, { label: 'Insérer', value: true, tone: 'primary' }]
    })
    if (!url || !url.trim()) return
    ref.current.focus()
    if (range) { sel.removeAllRanges(); sel.addRange(range) }
    const href = /^(https?:|mailto:)/.test(url.trim()) ? url.trim() : 'https://' + url.trim()
    if (range && !range.collapsed) document.execCommand('createLink', false, href)
    else document.execCommand('insertHTML', false, '<a href="' + href.replace(/"/g, '&quot;') + '" target="_blank">' + href.replace(/</g, '&lt;') + '</a>&nbsp;')
    onInput()
  }

  const updateBlockType = () => {
    try { setBlockType(document.queryCommandValue('formatBlock').toLowerCase() || 'p') } catch {}
  }

  // Raccourcis Markdown en début de ligne
  const onKeyDown = e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'b') { e.preventDefault(); exec('bold') }
      if (k === 'i') { e.preventDefault(); exec('italic') }
      if (k === 'u') { e.preventDefault(); exec('underline') }
      if (k === 'k') { e.preventDefault(); e.stopPropagation(); insertLink() }
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'x') { e.preventDefault(); exec('strikeThrough') }
      if (k === '7') { e.preventDefault(); exec('insertOrderedList') }
      if (k === '8') { e.preventDefault(); exec('insertUnorderedList') }
      if (k === '9') { e.preventDefault(); insertChecklist() }
    }
    if (e.key === ' ') {
      const sel = window.getSelection()
      if (!sel.rangeCount) return
      const node = sel.anchorNode
      if (node.nodeType !== 3) return
      const before = node.textContent.slice(0, sel.anchorOffset)
      const map = { '#': 'h1', '##': 'h2', '###': 'h3', '>': 'blockquote' }
      const block = node.parentElement.closest('div, p, h1, h2, h3, li, blockquote, .ne-content')
      const atStart = block && (block.classList.contains('ne-content') || block.textContent.indexOf(before) === 0)
      if (!atStart) return
      const clear = () => { node.textContent = node.textContent.slice(sel.anchorOffset); const r = document.createRange(); r.setStart(node, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r) }
      if (map[before]) { e.preventDefault(); clear(); exec('formatBlock', map[before]) }
      else if (before === '-' || before === '*') { e.preventDefault(); clear(); exec('insertUnorderedList') }
      else if (before === '1.') { e.preventDefault(); clear(); exec('insertOrderedList') }
      else if (before === '[]' || before === '[ ]') { e.preventDefault(); clear(); insertChecklist() }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const sel = window.getSelection()
      const node = sel.anchorNode
      if (node && node.nodeType === 3 && node.textContent === '---' && sel.anchorOffset === 3) {
        e.preventDefault(); node.textContent = ''; exec('insertHorizontalRule')
      }
    }
  }

  const onClick = e => {
    const li = e.target.closest('ul.checklist > li')
    if (li && e.offsetX < 22 && e.target === li) {
      li.classList.toggle('checked')
      onInput()
    }
  }

  const onPaste = e => {
    const h = e.clipboardData.getData('text/html')
    if (h) { e.preventDefault(); document.execCommand('insertHTML', false, sanitize(h)) }
  }

  const exportMd = async () => {
    persist()
    const n = db().notes.find(x => x.id === note.id)
    const md = (n.title ? '# ' + n.title + '\n\n' : '') + htmlToMarkdown(n.content)
    const p = await window.zr.saveFile({ defaultPath: (n.title || 'note').replace(/[\\/:*?"<>|]/g, '-') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }], content: md })
    if (p) toast('Note exportée')
  }

  const del = () => {
    clearTimeout(timer.current)
    persist()
    setUi({ selectedNote: null })
    withUndo('Note supprimée', () => removeNote(note.id))
  }

  const nb = d.notebooks.find(x => x.id === note.notebookId)
  const tools = [
    ['bold', 'Gras (Ctrl+B)', () => exec('bold')],
    ['italic', 'Italique (Ctrl+I)', () => exec('italic')],
    ['underline', 'Souligné (Ctrl+U)', () => exec('underline')],
    ['strike', 'Barré (Ctrl+Maj+X)', () => exec('strikeThrough')],
    '|',
    ['list', 'Liste à puces', () => exec('insertUnorderedList')],
    ['listOrdered', 'Liste numérotée', () => exec('insertOrderedList')],
    ['listCheck', 'Liste de tâches', insertChecklist],
    '|',
    ['quote', 'Citation', () => setBlock('blockquote')],
    ['code', 'Bloc de code', () => setBlock('pre')],
    ['link', 'Lien (Ctrl+K)', insertLink],
    ['divider', 'Séparateur', () => exec('insertHorizontalRule')],
    '|',
    ['eraser', 'Effacer la mise en forme', () => { exec('removeFormat'); exec('formatBlock', 'p') }]
  ]

  return html`
    <article class="note-editor">
      <div class="ne-bar">
        <div class="ne-tools">
          <select class="ghost-select block-select" value=${['h1', 'h2', 'h3'].includes(blockType) ? blockType : 'p'}
            onChange=${e => exec('formatBlock', e.target.value)} title="Style de paragraphe">
            <option value="p">Texte</option>
            <option value="h1">Titre 1</option>
            <option value="h2">Titre 2</option>
            <option value="h3">Titre 3</option>
          </select>
          <span class="tool-sep"></span>
          ${tools.map(t => t === '|' ? html`<span class="tool-sep"></span>` : html`
            <button class="tool" title=${t[1]} aria-label=${t[1]} onMouseDown=${e => { e.preventDefault(); t[2]() }}><${Icon} name=${t[0]} size=${15} /></button>`)}
        </div>
        <div class="ne-actions">
          <select class="ghost-select" value=${note.notebookId || ''} onChange=${e => updateNote(note.id, { notebookId: e.target.value || null }, false)} title="Carnet">
            <option value="">Sans carnet</option>
            ${d.notebooks.map(n => html`<option value=${n.id}>${n.name}</option>`)}
          </select>
          <${IconButton} icon="pin" label=${note.pinned ? 'Désépingler' : 'Épingler'} active=${note.pinned} onClick=${() => updateNote(note.id, { pinned: !note.pinned }, false)} />
          <${IconButton} icon="download" label="Exporter en Markdown" onClick=${exportMd} />
          <${IconButton} icon="trash" label="Supprimer la note" onClick=${del} />
        </div>
      </div>
      <div class="ne-scroll">
        <div class="ne-page">
          <input class="ne-title" placeholder="Titre" value=${note.title}
            onInput=${e => updateNote(note.id, { title: e.target.value })}
            onKeyDown=${e => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ref.current.focus() } }} />
          <div class="ne-info">
            ${nb && html`<span class="nl-nb"><span class="nb-swatch sm" style=${{ background: nb.color }}></span>${nb.name}</span>`}
            <span>Modifiée ${noteDate(note.updatedAt).match(/^\d/) && diffDays(new Date(note.updatedAt), new Date()) === 0 ? 'à ' : 'le '}${noteDate(note.updatedAt).toLowerCase()}</span>
          </div>
          <div ref=${ref} class="ne-content" contenteditable="true" spellcheck="true"
            data-placeholder="Commencez à écrire…"
            dangerouslySetInnerHTML=${{ __html: initial.current }}
            onInput=${onInput} onKeyDown=${onKeyDown} onKeyUp=${updateBlockType} onMouseUp=${updateBlockType}
            onClick=${onClick} onPaste=${onPaste} onBlur=${persist}></div>
        </div>
      </div>
      <div class="ne-status">
        <span>${stats.words} mot${stats.words > 1 ? 's' : ''}</span>
        <span>${stats.chars} caractère${stats.chars > 1 ? 's' : ''}</span>
        <span>${Math.max(1, Math.round(stats.words / 230))} min de lecture</span>
        <span class="grow"></span>
        <span class=${cx('save-state', !saved && 'pending')}>${saved ? 'Enregistré' : 'Enregistrement…'}</span>
      </div>
    </article>`
}

// ─── Popovers carnets ───────────────────────────────────────────────────────

function NotebookForm({ initial, onDone }) {
  const [name, setName] = useState(initial?.name || '')
  const [color, setColor] = useState(initial?.color || CAL_COLORS[(db().notebooks.length) % CAL_COLORS.length])
  const submit = () => {
    if (!name.trim()) return
    if (initial) mutate(d => { d.notebooks = d.notebooks.map(n => n.id === initial.id ? { ...n, name: name.trim(), color } : n) })
    else {
      const nb = { id: uid(), name: name.trim(), color }
      mutate(d => { d.notebooks = [...d.notebooks, nb] })
      setUi({ notebookFilter: nb.id })
    }
    onDone()
  }
  return html`<div class="form-pop">
    <div class="form-pop-title">${initial ? 'Modifier le carnet' : 'Nouveau carnet'}</div>
    <input class="input" placeholder="Nom du carnet" value=${name} autoFocus onInput=${e => setName(e.target.value)} onKeyDown=${e => e.key === 'Enter' && submit()} />
    <div class="swatches">${CAL_COLORS.map(c => html`<button class=${cx('swatch', c === color && 'active')} style=${{ background: c }} aria-label="Couleur" onClick=${() => setColor(c)}></button>`)}</div>
    <div class="form-pop-actions"><button class="btn btn-secondary sm" onClick=${onDone}>Annuler</button><button class="btn btn-primary sm" onClick=${submit}>${initial ? 'Enregistrer' : 'Créer'}</button></div>
  </div>`
}

export function NotePopovers() {
  const u = useUi()
  const p = u.popover
  if (!p) return null
  const close = () => setUi({ popover: null })
  if (p.kind === 'notebook-new') return html`<${Floating} anchor=${p.rect} onClose=${close} width=${260}><${NotebookForm} onDone=${close} /><//>`
  if (p.kind === 'notebook-edit') return html`<${Floating} anchor=${p.rect} onClose=${close} width=${260}><${NotebookForm} initial=${p.payload} onDone=${close} /><//>`
  if (p.kind === 'notebook-menu') {
    const nb = p.payload
    return html`<${Floating} anchor=${p.rect} onClose=${close} width=${200}><${Menu} onClose=${() => {}} items=${[
      { label: 'Modifier', icon: 'edit', onClick: () => setUi({ popover: { kind: 'notebook-edit', rect: p.rect, payload: nb } }) },
      { label: 'Supprimer', icon: 'trash', danger: true, onClick: async () => {
        close()
        const count = db().notes.filter(n => n.notebookId === nb.id).length
        const r = await ask({ title: 'Supprimer « ' + nb.name + ' » ?', message: count ? 'Les ' + count + ' note(s) du carnet seront conservées, sans carnet.' : 'Ce carnet est vide.',
          actions: [{ label: 'Annuler', value: false }, { label: 'Supprimer', value: true, tone: 'danger' }] })
        if (!r) return
        if (u.notebookFilter === nb.id) setUi({ notebookFilter: 'all' })
        withUndo('Carnet supprimé', () => mutate(d => {
          d.notebooks = d.notebooks.filter(n => n.id !== nb.id)
          d.notes = d.notes.map(n => n.notebookId === nb.id ? { ...n, notebookId: null } : n)
        }))
      } }
    ]} /><//>`
  }
  return null
}
