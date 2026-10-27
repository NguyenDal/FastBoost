import { useId, useRef, useState } from 'react';
import CleanIcon from './CleanIcon';
import '../styles/OpeningIntroduction.css';

function TourIcon({ kind }) {
  const paths = {
    goal: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m12 12 8-8M16 4h4v4" /></>,
    team: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-3 3v-9.5A7.5 7.5 0 0 1 9.5 5H12" /><path d="M16 3h6v6M22 3l-9 9M7 14h6" /></>,
    moments: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 4v5M16 4v5m-7 6 2 2 4-4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

function PreviewHeader({ children }) {
  return <div className="opening-intro-preview-header"><span>{children}</span><span className="opening-intro-example">Example view</span></div>;
}

function GoalPreview() {
  return <div className="opening-intro-preview opening-intro-goal">
    <PreviewHeader>Your next milestone</PreviewHeader>
    <div className="opening-intro-rank-path">
      <div className="opening-intro-rank"><span>Starting point</span><CleanIcon src="/assets/services/ranks/silver.png" alt="" /><strong>Silver IV</strong></div>
      <div className="opening-intro-rank-connector" aria-hidden="true"><span /><span>→</span><span /></div>
      <div className="opening-intro-rank is-target"><span>Your goal</span><CleanIcon src="/assets/services/ranks/gold.png" alt="" /><strong>Gold IV</strong></div>
    </div>
    <div className="opening-intro-goal-detail"><span><i aria-hidden="true" />League of Legends</span><span>Rank Boost</span></div>
  </div>;
}

function TeamPreview() {
  return <div className="opening-intro-preview opening-intro-team">
    <PreviewHeader>One shared space</PreviewHeader>
    <ol className="opening-intro-order-status" aria-label="Example order progress">
      <li className="is-done"><span aria-hidden="true">✓</span>Placed</li>
      <li className="is-current"><span aria-hidden="true" />In progress</li>
      <li><span aria-hidden="true" />Complete</li>
    </ol>
    <div className="opening-intro-conversation">
      <div className="opening-intro-message is-you"><span>You</span><p>Where can I follow the updates?</p></div>
      <div className="opening-intro-message"><span><i aria-hidden="true">F</i>Your team</span><p>Right here, alongside your order.</p></div>
    </div>
    <div className="opening-intro-team-note"><TourIcon kind="team" /><span>Progress and conversation, together.</span></div>
  </div>;
}

function MomentsPreview() {
  return <div className="opening-intro-preview opening-intro-moments">
    <PreviewHeader>The highlight collection</PreviewHeader>
    <div className="opening-intro-highlight-stack">
      <div className="opening-intro-highlight is-back" aria-hidden="true" />
      <div className="opening-intro-highlight is-middle" aria-hidden="true" />
      <div className="opening-intro-highlight is-front">
        <div className="opening-intro-highlight-art" aria-hidden="true"><TourIcon kind="moments" /><span className="opening-intro-highlight-orbit" /><span className="opening-intro-highlight-spark" /></div>
        <div className="opening-intro-highlight-caption"><span><small>A moment from your order</small><strong>The turning point</strong></span><span className="opening-intro-clip-type">Highlight</span></div>
      </div>
    </div>
    <div className="opening-intro-moments-note"><span aria-hidden="true">✦</span> Your journey, a few frames at a time.</div>
  </div>;
}

const stages = [
  {
    id: 'goal',
    label: 'Your goal',
    title: 'Start with your next milestone.',
    description: 'League of Legends or Teamfight Tactics — make a plan around where you are and where you want to go.',
    points: ['Choose the service that fits your goal', 'Review your options before checkout'],
    Preview: GoalPreview,
  },
  {
    id: 'team',
    label: 'Your team',
    title: 'Stay close to your order.',
    description: 'Follow your progress and talk with your assigned team in the same space, from the first update to the last.',
    points: ['See your order status and updates', 'Keep the details in one conversation'],
    Preview: TeamPreview,
  },
  {
    id: 'moments',
    label: 'Your moments',
    title: 'Keep the plays worth revisiting.',
    description: 'When your team shares a highlight, it lives alongside your order. Come back to the moments that made the journey.',
    points: ['Clips shared by your FastBoost team', 'A highlight collection for each order'],
    Preview: MomentsPreview,
  },
];

export default function OpeningIntroduction() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef([]);
  const instanceId = useId();

  function handleTabKeyDown(event, index) {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % stages.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + stages.length - 1) % stages.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = stages.length - 1;
    else return;

    event.preventDefault();
    setActiveIndex(nextIndex);
    tabRefs.current[nextIndex]?.focus();
  }

  return <section className="opening-intro" aria-label="A look inside FastBoost">
    <div className="opening-intro-tabs" role="tablist" aria-label="Explore the FastBoost experience">
      {stages.map((stage, index) => <button
        key={stage.id}
        type="button"
        role="tab"
        id={`${instanceId}-tab-${stage.id}`}
        aria-controls={`${instanceId}-panel-${stage.id}`}
        aria-selected={index === activeIndex}
        tabIndex={index === activeIndex ? 0 : -1}
        ref={element => { tabRefs.current[index] = element; }}
        onClick={() => setActiveIndex(index)}
        onKeyDown={event => handleTabKeyDown(event, index)}
      ><TourIcon kind={stage.id} /><span>{stage.label}</span><span className="opening-intro-tab-number" aria-hidden="true">0{index + 1}</span></button>)}
    </div>
    {stages.map((stage, index) => {
      const Preview = stage.Preview;
      return <div
        key={stage.id}
        className="opening-intro-panel"
        role="tabpanel"
        id={`${instanceId}-panel-${stage.id}`}
        aria-labelledby={`${instanceId}-tab-${stage.id}`}
        hidden={index !== activeIndex}
        tabIndex={0}
      >
        <div className="opening-intro-copy">
          <span className="opening-intro-eyebrow">A look inside FastBoost <span aria-hidden="true">/ 0{index + 1}</span></span>
          <h2>{stage.title}</h2>
          <p>{stage.description}</p>
          <ul>{stage.points.map(point => <li key={point}><span aria-hidden="true">✓</span>{point}</li>)}</ul>
        </div>
        <Preview />
      </div>;
    })}
  </section>;
}
