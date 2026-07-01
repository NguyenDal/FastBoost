function TemplateSection({ title, children }) {
    return (
        <section className="news-template-section">
            <h3>{title}</h3>
            {children}
        </section>
    );
}

function HighlightGrid({ items = [] }) {
    return (
        <div className="news-template-grid">
            {items.map((item) => (
                <div className="news-template-mini-card" key={item}>
                    <span>✓</span>
                    <p>{item}</p>
                </div>
            ))}
        </div>
    );
}

function EventTemplate({ post }) {
  const eventDetails = post.eventDetails || [];
  const highlightCards = post.highlightCards || post.highlights || [];
  const includedItems = post.includedItems || [];
  const timeline = post.timeline || post.sections?.timeline || [];
  const footerNotice = post.footerNotice;

  return (
    <div className="news-detail-template news-detail-template-event">
      <section className="news-detail-hero">
        <img src={post.image} alt={post.detailTitle || post.title} />
        <div className="news-detail-hero-overlay" />

        <div className="news-detail-hero-content">
          <span className={`updates-category-chip updates-category-${post.type}`}>
            Events
          </span>

          <h1>{post.detailTitle || post.title}</h1>

          <div className="news-detail-meta">
            <span>▣ {post.date}</span>
            <span>◴ {post.readTime}</span>
          </div>

          <p>{post.subtitle}</p>
        </div>
      </section>

      <section className="news-detail-card-grid news-detail-card-grid-three">
        <article className="news-detail-panel">
          <h3>Event Details</h3>

          <div className="news-detail-list">
            {eventDetails.map((item) => (
              <div key={`${item.label}-${item.value}`} className="news-detail-list-row">
                <span className="news-detail-row-icon">{item.icon}</span>

                <div>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="news-detail-panel">
          <h3>Highlights</h3>

          <ul className="news-detail-check-list">
            {highlightCards.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>

          <button type="button" className="news-detail-outline-btn">
            View All Rewards
          </button>
        </article>

        <article className="news-detail-panel">
          <h3>What’s Included</h3>

          <div className="news-detail-included-list">
            {includedItems.map((item) => (
              <div key={item.title} className="news-detail-included-row">
                <span>{item.icon}</span>

                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="news-detail-panel news-detail-timeline-panel">
        <h3>Event Timeline</h3>

        <div className="news-detail-timeline">
          {timeline.map((step, index) => {
            const normalizedStep =
              typeof step === "string"
                ? { title: step, date: "" }
                : step;

            return (
              <div key={`${normalizedStep.title}-${index}`} className="news-detail-timeline-step">
                <span className="news-detail-timeline-dot" />
                <strong>{normalizedStep.title}</strong>
                <small>{normalizedStep.date}</small>
              </div>
            );
          })}
        </div>
      </section>

      {footerNotice && (
        <section className="news-detail-footer-cta">
          <div className="news-detail-footer-left">
            <span>{footerNotice.icon}</span>
            <p>{footerNotice.text}</p>
          </div>

          <button type="button" className="news-detail-primary-btn">
            {footerNotice.ctaText || "Learn More"}
          </button>
        </section>
      )}
    </div>
  );
}

function UpdateTemplate({ post }) {
    return (
        <div className="news-template news-template-update">
            <TemplateSection title="What Changed">
                <HighlightGrid items={post.highlights} />
            </TemplateSection>

            <div className="news-template-before-after">
                <div>
                    <h3>Before</h3>
                    {(post.sections?.before || []).map((item) => (
                        <p key={item}>• {item}</p>
                    ))}
                </div>

                <div>
                    <h3>After</h3>
                    {(post.sections?.after || []).map((item) => (
                        <p key={item}>• {item}</p>
                    ))}
                </div>
            </div>
        </div>
    );
}

function GuideTemplate({ post }) {
    return (
        <div className="news-template news-template-guide">
            <TemplateSection title="Step-by-step">
                <div className="news-template-steps">
                    {(post.steps || post.highlights || []).map((item, index) => (
                        <div className="news-template-step" key={item}>
                            <span>{index + 1}</span>
                            <p>{item}</p>
                        </div>
                    ))}
                </div>
            </TemplateSection>

            {post.faq?.length > 0 && (
                <TemplateSection title="FAQ Preview">
                    <div className="news-template-faq">
                        {post.faq.map((item) => (
                            <details key={item.question}>
                                <summary>{item.question}</summary>
                                <p>{item.answer}</p>
                            </details>
                        ))}
                    </div>
                </TemplateSection>
            )}
        </div>
    );
}

function MaintenanceTemplate({ post }) {
    return (
        <div className="news-template news-template-maintenance">
            <TemplateSection title="Maintenance Window">
                <div className="news-template-maintenance-box">
                    <p><strong>Window:</strong> {post.maintenance?.window}</p>
                    <p><strong>Duration:</strong> {post.maintenance?.duration}</p>
                </div>
            </TemplateSection>

            <TemplateSection title="Affected Services">
                <HighlightGrid items={post.maintenance?.affected || post.highlights} />
            </TemplateSection>

            <TemplateSection title="Progress">
                <div className="news-template-timeline">
                    {(post.maintenance?.progress || []).map((item, index) => (
                        <div className="news-template-timeline-item" key={item}>
                            <span>{index + 1}</span>
                            <p>{item}</p>
                        </div>
                    ))}
                </div>
            </TemplateSection>
        </div>
    );
}

function ServiceTemplate({ post }) {
    return (
        <div className="news-template news-template-service">
            <TemplateSection title="Key Benefits">
                <HighlightGrid items={post.highlights} />
            </TemplateSection>

            <TemplateSection title="Availability">
                <div className="news-template-pill-row">
                    {(post.availability || []).map((item) => (
                        <span key={item}>{item}</span>
                    ))}
                </div>
            </TemplateSection>
        </div>
    );
}

function PromotionTemplate({ post }) {
    return (
        <div className="news-template news-template-promotion">
            <div className="news-template-offer-box">
                <span>{post.offer?.label || "Special Offer"}</span>
                <strong>{post.offer?.value || "Limited Offer"}</strong>
            </div>

            <TemplateSection title="Eligibility">
                <HighlightGrid items={post.offer?.eligibility || post.highlights} />
            </TemplateSection>

            <TemplateSection title="Important Notes">
                <p>
                    Promotion details can be adjusted later from the future admin news
                    management system.
                </p>
            </TemplateSection>
        </div>
    );
}

function NewsModalTemplates({ post }) {
    if (!post) return null;

    switch (post.modalTemplate || "event") {
        case "event":
            return <EventTemplate post={post} />;
        case "update":
            return <UpdateTemplate post={post} />;
        case "guide":
            return <GuideTemplate post={post} />;
        case "maintenance":
            return <MaintenanceTemplate post={post} />;
        case "service":
            return <ServiceTemplate post={post} />;
        case "promotion":
            return <PromotionTemplate post={post} />;
        default:
            return <EventTemplate post={post} />;
    }
}

export default NewsModalTemplates;