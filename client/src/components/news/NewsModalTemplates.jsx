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
    return (
        <div className="news-template news-template-event">
            <TemplateSection title="Introduction">
                <p>{post.sections?.intro || post.summary}</p>
            </TemplateSection>

            <TemplateSection title="What's Available Now">
                <HighlightGrid items={post.highlights} />
            </TemplateSection>

            <TemplateSection title="Launch Timeline">
                <div className="news-template-timeline">
                    {(post.sections?.timeline || []).map((item, index) => (
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