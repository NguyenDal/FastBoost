import ArrowUpRightIcon from './ArrowUpRightIcon';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import CleanIcon from './CleanIcon';
import { roleGuides, roleGuidesBySlug } from '../data/roleGuides';
import '../styles/RoleGuides.css';

const LESSON_TABS = [
  { id: 'fundamentals', label: 'Fundamentals' },
  { id: 'decision', label: 'Map decision' },
  { id: 'practice', label: 'Practice' },
];

const MAP_POINTS = [
  { id: 'top', label: 'Top lane', x: 10, y: 10, icon: '/assets/roles/top.png' },
  { id: 'jungle', label: 'Jungle', x: 36, y: 65, icon: '/assets/roles/jungle.png' },
  { id: 'mid', label: 'Mid lane', x: 50, y: 50, icon: '/assets/roles/mid.png' },
  { id: 'bot', label: 'Bot lane', x: 90, y: 90, icon: '/assets/roles/bot.png' },
  { id: 'river', label: 'River vision', x: 38, y: 36, icon: 'ward' },
  { id: 'objective', label: 'Neutral objective', x: 67, y: 70, icon: 'objective' },
];

function mapPointPosition(point, roleSlug) {
  if (roleSlug === 'top' && point?.id === 'objective') return { x: 33, y: 29 };
  if (roleSlug === 'top' && point?.id === 'river') return { x: 47, y: 43 };
  return point;
}

const practiceKey = slug => `fastboost:role-practice:v1:${slug}`;

function readPractice(slug, count) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(practiceKey(slug)) || '[]');
    if (Array.isArray(stored)) return Array.from({ length: count }, (_, index) => stored[index] === true);
  } catch {
    // The checklist works without local storage.
  }
  return Array(count).fill(false);
}

function writePractice(slug, checked) {
  try {
    window.localStorage.setItem(practiceKey(slug), JSON.stringify(checked));
  } catch {
    // Keep the current page interactive if storage is unavailable.
  }
}

function LessonMap({ role, activeHotspot, onSelect }) {
  const note = role.mapNotes[activeHotspot];
  const activePoint = MAP_POINTS.find(point => point.id === activeHotspot);
  const activePosition = mapPointPosition(activePoint, role.slug);
  const activeX = activePosition?.x;
  const activeY = activePosition?.y;

  useEffect(() => {
    if (!activeHotspot) return undefined;
    const dismissOutside = event => {
      if (!event.target.closest?.('.role-map-hotspot')) onSelect(null);
    };
    const dismissEscape = event => {
      if (event.key === 'Escape') onSelect(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [activeHotspot, onSelect]);

  return <div className="role-map-canvas" role="group" aria-label="Interactive Summoner's Rift minimap">
      {/* User-selected minimap: https://wiki.leagueoflegends.com/en-us/File%3ASummoner%27s_Rift_Minimap.png */}
      <img className="role-map-image" src="/assets/guides/summoners-rift.png" alt="" draggable="false" />
      {MAP_POINTS.filter(point => role.mapNotes[point.id]).map(point => <button
        key={point.id}
        type="button"
        className={`role-map-hotspot${point.id === activeHotspot ? ' is-active' : ''}`}
        style={{
          left: `${mapPointPosition(point, role.slug).x}%`,
          top: `${mapPointPosition(point, role.slug).y}%`,
        }}
        aria-label={`${point.id === activeHotspot ? 'Hide' : 'Show'} ${point.label} tip`}
        aria-expanded={point.id === activeHotspot}
        aria-controls={point.id === activeHotspot ? `role-map-tip-${role.slug}` : undefined}
        title={point.label}
        onClick={() => onSelect(point.id === activeHotspot ? null : point.id)}
      >{point.icon === 'ward'
          ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12c2.5-3.5 5.5-5.2 9-5.2s6.5 1.7 9 5.2c-2.5 3.5-5.5 5.2-9 5.2S5.5 15.5 3 12Z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M12 2v3m0 14v3" stroke="currentColor" strokeWidth="1.6" /></svg>
          : point.icon === 'objective'
            ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 3.1 6.8L22 12l-6.9 3.2L12 22l-3.1-6.8L2 12l6.9-3.2L12 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="12" r="2" fill="currentColor" /></svg>
            : <img src={point.icon} alt="" />}</button>)}
      {note && activePoint && <div
        id={`role-map-tip-${role.slug}`}
        className="role-map-popover"
        role="status"
        style={{
          left: `clamp(12px, calc(${activeX}% - 110px), calc(100% - 232px))`,
          ...(activeY > 55
            ? { bottom: `calc(${100 - activeY}% + 27px)` }
            : { top: `calc(${activeY}% + 27px)` }),
        }}
      ><strong>{note.title}</strong><span>{note.body}</span></div>}
  </div>;
}

function RoleGuideContent({ role }) {
  const [activeTab, setActiveTab] = useState('fundamentals');
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [answers, setAnswers] = useState([null, null]);
  const [activeHotspot, setActiveHotspot] = useState(null);
  const [checked, setChecked] = useState(() => readPractice(role.slug, role.practice.length));
  const tabRefs = useRef({});
  const scenarioHeadingRef = useRef(null);
  const scenario = role.scenarios[scenarioIndex];
  const selectedAnswer = answers[scenarioIndex];
  const solved = selectedAnswer === scenario.correctIndex;
  const completedCount = checked.filter(Boolean).length;

  const chooseTab = tab => {
    setActiveTab(tab);
    tabRefs.current[tab]?.focus();
  };
  const onTabKeyDown = (event, index) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % LESSON_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + LESSON_TABS.length) % LESSON_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = LESSON_TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(LESSON_TABS[next].id);
    tabRefs.current[LESSON_TABS[next].id]?.focus();
  };
  const chooseAnswer = index => {
    setAnswers(current => current.map((answer, position) => position === scenarioIndex ? index : answer));
  };
  const nextScenario = () => {
    if (!solved || scenarioIndex >= role.scenarios.length - 1) return;
    const next = scenarioIndex + 1;
    setScenarioIndex(next);
    setActiveHotspot(null);
    window.requestAnimationFrame(() => scenarioHeadingRef.current?.focus());
  };
  const resetDecisions = () => {
    setAnswers(role.scenarios.map(() => null));
    setScenarioIndex(0);
    setActiveHotspot(null);
  };
  const togglePractice = index => {
    const next = checked.map((value, position) => position === index ? !value : value);
    setChecked(next);
    writePractice(role.slug, next);
  };
  const resetPractice = () => {
    const next = role.practice.map(() => false);
    setChecked(next);
    writePractice(role.slug, next);
  };

  return <div className={`role-lesson role-lesson-${role.slug}`}>
    <header className="role-lesson-hero">
      <div className="role-lesson-hero-inner">
        <Link to="/hub/guides" className="role-lesson-back">← All guides</Link>
        <div className="role-lesson-hero-copy">
          <span className="role-lesson-kicker">League of Legends · Role guide</span>
          <h1>{role.title}</h1>
          <p className="role-lesson-tagline">{role.tagline}</p>
          <p className="role-lesson-goal">{role.goal}</p>
        </div>
        <div className="role-lesson-hero-art" aria-hidden="true"><CleanIcon src={role.image} alt="" /></div>
      </div>
    </header>

    <div className="role-lesson-inner">
      <nav className="role-lesson-role-nav" aria-label="Explore role guides">
        {roleGuides.map(item => <Link key={item.slug} to={`/hub/guides/${item.slug}`} aria-label={`View ${item.title} guide`} title={item.title} aria-current={item.slug === role.slug ? 'page' : undefined}><img src={item.image} alt="" /></Link>)}
      </nav>

      <div className="role-lesson-tabs" role="tablist" aria-label="Guide sections">
        {LESSON_TABS.map((tab, index) => <button
          key={tab.id}
          id={`role-tab-${tab.id}`}
          ref={element => { tabRefs.current[tab.id] = element; }}
          type="button"
          role="tab"
          tabIndex={activeTab === tab.id ? 0 : -1}
          aria-selected={activeTab === tab.id}
          aria-controls={activeTab === tab.id ? `role-panel-${tab.id}` : undefined}
          onClick={() => chooseTab(tab.id)}
          onKeyDown={event => onTabKeyDown(event, index)}
        >{tab.label}</button>)}
      </div>

      {activeTab === 'fundamentals' && <section id="role-panel-fundamentals" className="role-lesson-panel" role="tabpanel" aria-labelledby="role-tab-fundamentals" tabIndex={0}>
        <div className="role-lesson-section-head"><h2>The decisions that matter most</h2><p>Keep these three ideas in mind during your next match.</p></div>
        <div className="role-lesson-fundamentals">{role.fundamentals.map((point, index) => <article key={point.title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{point.title}</h3><p>{point.body}</p></article>)}</div>
        <button type="button" className="role-lesson-primary" onClick={() => chooseTab('decision')}>Try a map decision <span aria-hidden="true">→</span></button>
      </section>}

      {activeTab === 'decision' && <section id="role-panel-decision" className="role-lesson-panel" role="tabpanel" aria-labelledby="role-tab-decision" tabIndex={0}>
        <div className="role-lesson-section-head"><h2>Choose the next move</h2><p>Explore a map point, then make a call from the information you have.</p></div>
        <div className="role-lesson-decision-layout">
          <LessonMap role={role} activeHotspot={activeHotspot} onSelect={setActiveHotspot} />
          <div className="role-decision-card">
            <div className="role-decision-progress"><span>Decision {scenarioIndex + 1} of {role.scenarios.length}</span><button type="button" onClick={resetDecisions}>Reset</button></div>
            <div className="role-decision-progress-track" aria-hidden="true"><span style={{ width: `${((scenarioIndex + 1) / role.scenarios.length) * 100}%` }} /></div>
            <span className="role-decision-kicker">What would you do?</span>
            <h3 ref={scenarioHeadingRef} tabIndex={-1}>{scenario.title}</h3>
            <p className="role-decision-prompt">{scenario.prompt}</p>
            <div className="role-decision-choices" role="group" aria-label="Choose the best move">
              {scenario.choices.map((choice, index) => <button
                key={choice.text}
                type="button"
                className={`role-decision-choice${selectedAnswer === index ? ' is-selected' : ''}${selectedAnswer === index && solved ? ' is-correct' : ''}`}
                aria-pressed={selectedAnswer === index}
                onClick={() => chooseAnswer(index)}
              ><span className="role-decision-choice-letter" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span>{choice.text}</span></button>)}
            </div>
            {selectedAnswer !== null && <div className={`role-decision-feedback${solved ? ' is-correct' : ''}`} role="status" aria-live="polite">
              <strong>{solved ? 'Good call.' : 'Think it through again.'}</strong>
              <p>{scenario.choices[selectedAnswer].feedback}</p>
              {!solved && <span>Choose another move to continue.</span>}
            </div>}
            <div className="role-decision-actions">
              {scenarioIndex < role.scenarios.length - 1
                ? <button type="button" className="role-lesson-primary" disabled={!solved} onClick={nextScenario}>Next decision <span aria-hidden="true">→</span></button>
                : solved && <button type="button" className="role-lesson-primary" onClick={() => chooseTab('practice')}>Practice this role <span aria-hidden="true">→</span></button>}
              {scenarioIndex === role.scenarios.length - 1 && solved && <span className="role-decision-complete">Both decisions complete</span>}
            </div>
          </div>
        </div>
      </section>}

      {activeTab === 'practice' && <section id="role-panel-practice" className="role-lesson-panel" role="tabpanel" aria-labelledby="role-tab-practice" tabIndex={0}>
        <div className="role-lesson-section-head"><h2>Your next-match checklist</h2><p>Choose a focus and check it off after you practice. Progress is saved on this device.</p></div>
        <div className="role-practice-card">
          <div className="role-practice-progress"><strong>{completedCount} of {role.practice.length} practiced</strong><button type="button" onClick={resetPractice} disabled={completedCount === 0}>Reset checklist</button></div>
          <div className="role-practice-progress-track" aria-hidden="true"><span style={{ width: `${(completedCount / role.practice.length) * 100}%` }} /></div>
          <ul>{role.practice.map((item, index) => <li key={item}><label><input type="checkbox" checked={checked[index]} onChange={() => togglePractice(index)} /><span className="role-practice-checkbox" aria-hidden="true">✓</span><span><b>{String(index + 1).padStart(2, '0')}</b>{item}</span></label></li>)}</ul>
          {completedCount === role.practice.length && <p className="role-practice-done" role="status">All three focuses practiced. Use another match to repeat what helped.</p>}
        </div>
      </section>}

    </div>
  </div>;
}

export function RoleGuidePage({ role }) {
  const selected = typeof role === 'string' ? roleGuidesBySlug[role] : role;
  if (!selected) return <div className="role-lesson-not-found"><h1>Guide not found</h1><p>Choose another role to keep learning.</p><Link to="/hub/guides">Browse role guides</Link></div>;
  return <RoleGuideContent key={selected.slug} role={selected} />;
}

export default function RoleGuides() {
  return <section className="role-guides-directory" aria-labelledby="role-guides-heading">
    <div className="role-guides-intro"><div><span>League of Legends · Field guides</span><h2 id="role-guides-heading">Learn your role. <em>Own your next move.</em></h2></div></div>
    <div className="role-guides-grid">{roleGuides.map(role => <article id={`role-guide-${role.slug}`} className={`role-guides-card role-guides-card-${role.slug}`} key={role.slug}>
      <Link to={`/hub/guides/${role.slug}`} aria-label={`Open ${role.title} guide`}>
        <div className="role-guides-card-art" aria-hidden="true"><CleanIcon src={role.image} alt="" /><span className="role-guides-card-grid" /></div>
        <div className="role-guides-card-copy"><span>Role guide</span><h3>{role.title}</h3><p>{role.tagline}</p><strong>Explore guide <span aria-hidden="true"><ArrowUpRightIcon /></span></strong></div>
      </Link>
    </article>)}</div>
  </section>;
}
