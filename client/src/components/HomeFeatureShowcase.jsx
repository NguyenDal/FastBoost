import { useEffect, useRef } from 'react';
import '../styles/HomeFeatureShowcase.css';

const SCENES = [['goal', 7500], ['chat', 7000], ['highlights', 6500], ['rewards', 6500]];
const CYCLE_DURATION = SCENES.reduce((total, [, duration]) => total + duration, 0);
const ease = value => 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);

function Heading({ children, gold = false }) {
  return <div className="hfs-card-heading"><span className="hfs-card-title"><span className={`hfs-status-light${gold ? ' hfs-gold-light' : ''}`} />{children}</span></div>;
}

export default function HomeFeatureShowcase() {
  const rootRef = useRef(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scenes = [...root.querySelectorAll('[data-scene]')];
    const markers = [...root.querySelectorAll('[data-marker]')];
    const part = name => root.querySelector(`[data-part="${name}"]`);
    const arrow = part('arrow');
    const target = part('target');
    const userMessage = part('user-message');
    const agentRow = part('agent-row');
    const typing = part('typing');
    const reply = part('reply');
    const thumbnail = part('thumbnail');
    const highlightFill = part('highlight-fill');
    const shimmer = part('shimmer');
    const saved = part('saved');
    const tier = part('tier');
    const count = part('count');
    const cashback = part('cashback');
    const tierBenefits = part('tier-benefits');
    let frame;
    let last;
    let activeScene;
    let inView = !('IntersectionObserver' in window);

    const enter = (node, amount, distance = 5) => {
      node.style.opacity = amount.toFixed(3);
      node.style.transform = `translateY(${((1 - amount) * distance).toFixed(2)}px)`;
    };
    function render() {
      let phase = motion.matches ? 4200 : elapsedRef.current % CYCLE_DURATION;
      let scene = 'goal';
      if (!motion.matches) {
        for (const [name, duration] of SCENES) {
          if (phase < duration) { scene = name; break; }
          phase -= duration;
        }
      }
      if (activeScene !== scene) {
        activeScene = scene;
        root.dataset.activeScene = scene;
        scenes.forEach(node => node.classList.toggle('is-active', node.dataset.scene === scene));
        markers.forEach(node => node.classList.toggle('is-active', node.dataset.marker === scene));
      }
      if (scene === 'goal') {
        const flow = motion.matches ? 0 : Math.sin(phase / 700);
        arrow.style.transform = `translateX(${(flow * 3).toFixed(2)}px)`;
        arrow.style.opacity = (.78 + .22 * (flow + 1) / 2).toFixed(3);
        target.style.filter = `drop-shadow(0 0 ${(4 + (flow + 1) * 2).toFixed(2)}px rgba(174,139,255,.25))`;
      } else if (scene === 'chat') {
        enter(userMessage, ease(phase / 420), 7);
        enter(agentRow, ease((phase - 1000) / 400));
        const replied = ease((phase - 3000) / 450);
        typing.style.opacity = String(1 - replied);
        enter(reply, replied);
      } else if (scene === 'highlights') {
        const entry = ease(phase / 650);
        thumbnail.style.transform = `translateY(${((1 - entry) * 8).toFixed(2)}px) rotate(${((1 - entry) * -5).toFixed(2)}deg)`;
        thumbnail.style.opacity = String(.5 + .5 * entry);
        highlightFill.style.transform = `scaleX(${(.08 + .84 * ease((phase - 600) / 3900)).toFixed(3)})`;
        shimmer.style.transform = `translateX(${(-130 + Math.min(1, phase / 3500) * 260).toFixed(2)}%)`;
        enter(saved, ease((phase - 2900) / 480), 4);
      } else {
        const earned = ease((phase - 800) / 2200);
        enter(tierBenefits, ease((phase - 500) / 500));
        count.textContent = `+${Math.round(earned * 500)}`;
        cashback.textContent = `${Math.round(3 + earned * 2)}%`;
        tier.classList.toggle('is-unlocked', phase >= 800);
      }
    }
    function tick(now) {
      elapsedRef.current += Math.max(0, Math.min(now - last, 100));
      last = now;
      render();
      frame = window.requestAnimationFrame(tick);
    }
    function syncPlayback() {
      window.cancelAnimationFrame(frame);
      const playing = !motion.matches && !document.hidden && inView;
      root.dataset.paused = String(!playing);
      root.dataset.reducedMotion = String(motion.matches);
      render();
      if (playing) {
        last = performance.now();
        frame = window.requestAnimationFrame(tick);
      }
    }
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      syncPlayback();
    }) : null;
    observer?.observe(root);
    motion.addEventListener('change', syncPlayback);
    document.addEventListener('visibilitychange', syncPlayback);
    syncPlayback();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      motion.removeEventListener('change', syncPlayback);
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, []);

  return <div ref={rootRef} className="home-feature-showcase" role="group" aria-label="Explore FastBoost features">
    <p className="hfs-sr-only">Set your rank goal and get help reaching it. Stay in touch through order chat and keep your match highlights. Reach Gold loyalty tier with $500 in completed orders to earn a 500 gold tier bonus and increase your cashback from Silver’s 3% to Gold’s 5%. Illustrations show sample ranks and conversations.</p>
    <div className="hfs-scenes" aria-hidden="true">
      <section className="hfs-feature-scene is-active" data-scene="goal">
        <Heading>Your next milestone</Heading>
        <div className="hfs-rank-route">
          <div className="hfs-rank-endpoint"><img src="/assets/services/ranks/gold.png" width="44" height="44" alt="" /><div><small>YOUR RANK</small><strong>Gold II</strong></div></div>
          <svg className="hfs-goal-arrow" data-part="arrow" width="68" height="28" viewBox="0 0 68 28"><path d="M4 14H60M50 4L60 14L50 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="hfs-rank-endpoint hfs-rank-target" data-part="target"><div><small>YOUR GOAL</small><strong>Diamond IV</strong></div><img src="/assets/services/ranks/diamond.png" width="48" height="48" alt="" /></div>
        </div>
        <p className="hfs-goal-caption">You set the goal. We help you get there.</p>
      </section>
      <section className="hfs-feature-scene" data-scene="chat">
        <Heading>Stay in the loop</Heading>
        <div className="hfs-chat-demo">
          <div className="hfs-message-row hfs-message-user" data-part="user-message"><span className="hfs-chat-bubble">How’s my order going?</span><span className="hfs-chat-avatar hfs-avatar-customer">You</span></div>
          <div className="hfs-message-row hfs-message-agent" data-part="agent-row"><span className="hfs-chat-avatar hfs-avatar-agent">F</span><div className="hfs-reply-slot"><div className="hfs-typing-bubble" data-part="typing"><span /><span /><span /></div><div className="hfs-chat-bubble hfs-agent-bubble" data-part="reply">Your progress is in the dashboard.<br />You can follow every update there.</div></div></div>
        </div>
      </section>
      <section className="hfs-feature-scene" data-scene="highlights">
        <Heading>The moments worth keeping</Heading>
        <div className="hfs-highlight-demo">
          <div className="hfs-highlight-stack"><div className="hfs-highlight-back" /><div className="hfs-highlight-thumbnail" data-part="thumbnail"><img src="/assets/home/league-gameplay.jpg" width="128" height="72" alt="" decoding="async" /><span className="hfs-highlight-shimmer" data-part="shimmer" /><div className="hfs-highlight-timeline"><span data-part="highlight-fill" /></div></div></div>
          <div className="hfs-highlight-copy"><span className="hfs-highlight-eyebrow">ORDER HIGHLIGHT</span><strong>The turning point</strong><span className="hfs-highlight-caption">Your best moments,<br />all in one place.</span><span className="hfs-highlight-saved" data-part="saved"><span>✓</span> Saved to your order</span></div>
        </div>
      </section>
      <section className="hfs-feature-scene" data-scene="rewards">
        <Heading gold>Every climb gives back</Heading>
        <div className="hfs-tier-route"><span className="hfs-tier-label">LOYALTY TIER</span><span className="hfs-tier-from">Silver</span><span className="hfs-tier-arrow">→</span><strong className="hfs-tier-goal" data-part="tier"><span>✦</span> Gold</strong></div>
        <div className="hfs-tier-benefits" data-part="tier-benefits">
          <div><strong className="hfs-tier-gold"><span data-part="count">+0</span> Gold</strong><small>Tier bonus</small></div>
          <div><strong className="hfs-tier-cashback"><span className="hfs-cashback-before">3%</span><span className="hfs-cashback-arrow">→</span><span data-part="cashback">3%</span></strong><small>Cashback at Gold</small></div>
        </div>
        <p className="hfs-tier-qualification">Unlock Gold with $500 in completed orders.</p>
      </section>
      <div className="hfs-scene-markers">{SCENES.map(([scene], index) => <span key={scene} className={index === 0 ? 'is-active' : ''} data-marker={scene} />)}</div>
    </div>
  </div>;
}
