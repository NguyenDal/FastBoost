import { useEffect, useRef, useState } from 'react';
import { HIGHLIGHT_TITLE_GROUPS, isHighlightTitlePreset } from '../utils/highlightTitlePresets';

export default function HighlightTitlePicker({ orderId, gameMode = 'lol', mode, onModeChange, presetTitle, onPresetTitleChange, customTitle, onCustomTitleChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const groups = HIGHLIGHT_TITLE_GROUPS[gameMode === 'tft' ? 'tft' : 'lol'];
  const selectedPreset = isHighlightTitlePreset(gameMode, presetTitle) ? presetTitle : '';
  const visibleGroups = groups.map(group => ({
    ...group,
    options: group.label.toLowerCase().includes(search.trim().toLowerCase())
      ? group.options
      : group.options.filter(option => option.toLowerCase().includes(search.trim().toLowerCase())),
  })).filter(group => group.options.length);
  const titleLabelId = `highlight-title-label-${orderId}`;
  const panelId = `highlight-preset-panel-${orderId}`;

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    searchRef.current?.focus();
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function selectMode(nextMode) {
    onModeChange(nextMode);
    setOpen(false);
  }

  function selectPreset(option) {
    onPresetTitleChange(option);
    setOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  }

  function changeSearch(value) {
    setSearch(value);
    const matchingGroup = groups.find(group => group.label.toLowerCase().includes(value.trim().toLowerCase())
      || group.options.some(option => option.toLowerCase().includes(value.trim().toLowerCase())));
    setExpandedGroup(value.trim() ? matchingGroup?.label || null : null);
  }

  return <div className="highlight-title-picker">
    <span className="highlight-title-label" id={titleLabelId}>Clip title</span>
    <div className="highlight-title-modes" role="group" aria-label="Clip title entry method">
      <button type="button" className={mode === 'preset' ? 'is-active' : ''} aria-pressed={mode === 'preset'} disabled={disabled} onClick={() => selectMode('preset')}>Choose a moment</button>
      <button type="button" className={mode === 'custom' ? 'is-active' : ''} aria-pressed={mode === 'custom'} disabled={disabled} onClick={() => selectMode('custom')}>Write my own</button>
    </div>
    {mode === 'custom' ? <input id={`highlight-title-${orderId}`} aria-labelledby={titleLabelId} type="text" value={customTitle} maxLength={100}
      placeholder="e.g. Final push to Gold" disabled={disabled} onChange={event => onCustomTitleChange(event.target.value)} />
      : <div className="highlight-preset" ref={rootRef} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
      }}>
        <button ref={triggerRef} type="button" className={`highlight-preset-trigger ${selectedPreset ? 'has-selection' : ''}`} id={`highlight-preset-trigger-${orderId}`}
          aria-labelledby={`${titleLabelId} highlight-preset-trigger-${orderId}`} aria-expanded={open} aria-controls={panelId} disabled={disabled}
          onClick={() => setOpen(value => !value)}>
          <span>{selectedPreset || 'Choose a highlight moment'}</span><span className="highlight-preset-chevron" aria-hidden="true">⌄</span>
        </button>
        {open && <div className="highlight-preset-panel" id={panelId}>
          <label className="highlight-preset-search-label" htmlFor={`highlight-preset-search-${orderId}`}>Find a moment</label>
          <input ref={searchRef} id={`highlight-preset-search-${orderId}`} type="text" value={search} placeholder="Search moments…" autoComplete="off"
            onChange={event => changeSearch(event.target.value)} />
          <div className="highlight-preset-groups">
            {visibleGroups.length ? visibleGroups.map((group, index) => {
              const expanded = expandedGroup === group.label;
              const groupId = `highlight-preset-group-${orderId}-${index}`;
              return <div className="highlight-preset-group" key={group.label}>
                <button type="button" className="highlight-preset-group-trigger" aria-expanded={expanded} aria-controls={groupId}
                  onClick={() => setExpandedGroup(expanded ? null : group.label)}>
                  <span>{group.label}</span><small>{group.options.length} {group.options.length === 1 ? 'moment' : 'moments'}</small><span className="highlight-preset-chevron" aria-hidden="true">⌄</span>
                </button>
                {expanded && <div className="highlight-preset-options" id={groupId}>
                  {group.options.map(option => <button type="button" className={selectedPreset === option ? 'is-selected' : ''} key={option}
                    onClick={() => selectPreset(option)} aria-pressed={selectedPreset === option}>{option}</button>)}
                </div>}
              </div>;
            }) : <p className="highlight-preset-no-results">No matching moments. Use “Write my own” for a custom title.</p>}
          </div>
        </div>}
      </div>}
    <p className="highlight-title-hint">{mode === 'preset' ? 'Open a group, then choose the moment shown in your clip.' : 'Give this moment a short name customers will recognize.'}</p>
  </div>;
}
