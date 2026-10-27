import { Link, useParams, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { OpeningEventCard, OpeningEventDetail } from '../components/OpeningEvent';
import OpeningIntroduction from '../components/OpeningIntroduction';
import RoleGuides, { RoleGuidePage } from '../components/RoleGuides';
import { OPENING_CAMPAIGN, openingCampaignStartLabel } from '../data/openingCampaign';
import { roleGuidesBySlug } from '../data/roleGuides';
import '../styles/HubPage.css';

const categories = ['all', 'news', 'events', 'guides'];
const articles = {
  'welcome-to-fastboost': {
    category: 'news',
    title: 'Welcome to FastBoost',
    summary: 'Game services, order updates, and practical guides. Your next chapter starts here.',
  },
};

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function OpeningNewsCard() {
  return <article className="hub-news-poster">
    <Link to="/hub/news/welcome-to-fastboost" aria-label="Read Welcome to FastBoost">
      <div className="hub-news-poster-copy">
        <h2>Welcome to<br /><span>FastBoost.</span></h2>
        <p>Grand opening <span aria-hidden="true">·</span> <time dateTime={OPENING_CAMPAIGN.startsAt}>{openingCampaignStartLabel()}</time></p>
      </div>
      <span className="hub-news-poster-action">Read story <Arrow /></span>
    </Link>
  </article>;
}

function AllOverview() {
  return <>
    <OpeningNewsCard />
    <OpeningEventCard compact />
    <article className="hub-overview-card hub-overview-guides">
      <Link to="/hub/guides" className="hub-overview-link" aria-label="Browse League of Legends role guides">
        <span className="hub-guides-poster-label">Player guides</span>
        <h2>Find your<br />next play.</h2>
        <span className="hub-guides-poster-action">Check guides <Arrow /></span>
      </Link>
    </article>
  </>;
}

function ArticleView({ article }) {
  return <>
    <header className="hub-landing-hero hub-opening-news-hero">
      <div className="hub-page-inner">
        <Link to={`/hub?category=${article.category}`} className="hub-back">← Back to the Hub</Link>
        <div className="hub-hero-copy">
          <h1>Welcome to<br /><span>FastBoost.</span></h1>
          <p className="hub-opening-date">Grand opening <span aria-hidden="true">·</span> <time dateTime={OPENING_CAMPAIGN.startsAt}>{openingCampaignStartLabel()}</time></p>
        </div>
      </div>
    </header>
    <article className="hub-article-body hub-page-inner">
      <OpeningIntroduction />
    </article>
  </>;
}

function GuideDirectoryView() {
  return <>
    <div className="hub-landing-hero hub-guides-hero"><div className="hub-page-inner">
      <Link className="hub-back" to="/hub">← Back to the Hub</Link>
      <div className="hub-hero-copy"><h1>Player <span>Guides</span></h1><p>Find your next play.</p></div>
    </div></div>
    <div className="hub-content hub-content-guides hub-page-inner"><RoleGuides /></div>
  </>;
}

export default function HubPage({ guideDirectory = false }) {
  const { section, slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCategory = searchParams.get('category');
  const category = categories.includes(requestedCategory) ? requestedCategory : 'all';
  const article = section && slug && articles[slug]?.category === section ? articles[slug] : null;
  const role = section === 'guides' && slug ? roleGuidesBySlug[slug] : null;

  const chooseCategory = next => setSearchParams(next === 'all' ? {} : { category: next });
  return <div className="hub-shell">
    <Navbar />
    <main id="hub-main">
      {article ? <ArticleView article={article} /> : role ? <RoleGuidePage role={role} /> : guideDirectory ? <GuideDirectoryView /> : section === 'events' && slug === OPENING_CAMPAIGN.slug ? <OpeningEventDetail /> : section ? <div className="hub-not-found"><h1>That story isn’t here</h1><p>It may have moved. Explore what’s available in the Hub.</p><Link to="/hub" className="hub-primary-link">Return to the Hub <Arrow /></Link></div> : <>
        <div className="hub-landing-hero"><div className="hub-page-inner">
          <Link className="hub-back" to="/">← Home</Link>
          <div className="hub-hero-copy"><h1>The <span>Hub</span></h1><p>News, guides, and what’s next for players.</p></div>
          <div className="hub-filters" role="group" aria-label="Filter Hub content">{categories.map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => chooseCategory(item)}>{item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
        </div></div>
        <div className={`hub-content hub-content-${category} hub-page-inner`}>
          {category === 'all' && <AllOverview />}
          {category === 'news' && <OpeningNewsCard />}
          {category === 'guides' && <RoleGuides />}
          {category === 'events' && <OpeningEventCard />}
        </div>
      </>}
    </main>
  </div>;
}
