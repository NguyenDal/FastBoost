(() => {
  document.querySelector('[data-print]').addEventListener('click', () => window.print());
  const sections = [...document.querySelectorAll('.fb-section')];
  const links = [...document.querySelectorAll('[data-toc]')];
  let scheduled = false;
  let currentId = '';
  function updateCurrent() {
    scheduled = false;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= 140) current = section;
    }
    if ((window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 30)) current = sections[sections.length - 1];
    if (!current || current.id === currentId) return;
    currentId = current.id;
    links.forEach(link => {
      if (link.dataset.toc === currentId) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    const active = document.querySelector('.fb-toc [aria-current="location"]');
    const nav = document.querySelector('.fb-toc');
    if (active && nav && nav.clientHeight) {
      const relativeTop = active.getBoundingClientRect().top - nav.getBoundingClientRect().top;
      if (relativeTop < 0) nav.scrollTop += relativeTop;
      else if (relativeTop + active.offsetHeight > nav.clientHeight) nav.scrollTop += relativeTop + active.offsetHeight - nav.clientHeight;
    }
  }
  function onScroll() {
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(updateCurrent); }
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  window.addEventListener('resize', onScroll, {passive:true});
  const mobile = document.querySelector('.fb-mobile-contents');
  document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    const section = document.getElementById(link.getAttribute('href').slice(1));
    if (!section) return;
    event.preventDefault();
    if (mobile.contains(link)) mobile.open = false;
    // Authenticated srcdoc previews must scroll within the document instead of
    // navigating the iframe to the parent app's URL.
    if (window.location.protocol !== 'about:') window.history.pushState(null, '', '#' + section.id);
    const heading = section.querySelector('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({preventScroll:true});
    window.requestAnimationFrame(() => section.scrollIntoView({block:'start'}));
  }));
  updateCurrent();
})();
