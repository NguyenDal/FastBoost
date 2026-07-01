import { useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import NewsModal from "../components/news/NewsModal";
import { NEWS_CATEGORIES, newsPosts } from "../data/newsData";
import {
    getStoredUser,
    hasValidSession,
    notifyAuthChanged,
} from "../utils/authSession";
import "../styles/News.css";

const POSTS_PER_PAGE = 4;


function getPostByType(type, fallbackIndex = 0) {
    return newsPosts.find((post) => post.type === type) || newsPosts[fallbackIndex] || null;
}

function getPaginationItems(totalPages) {
    if (totalPages <= 5) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    return [1, 2, 3, 4, "ellipsis", totalPages];
}

function UpdatesPage() {
    const [currentUser, setCurrentUser] = useState(() => {
        if (!hasValidSession()) return null;
        return getStoredUser();
    });

    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState("all");
    const [sortMode, setSortMode] = useState("newest");
    const [currentPage, setCurrentPage] = useState(1);

    const [activeNewsPost, setActiveNewsPost] = useState(null);
    const [newsModalOrigin, setNewsModalOrigin] = useState(null);
    const [newsModalClosing, setNewsModalClosing] = useState(false);

    const hasSession = Boolean(localStorage.getItem("token")) || Boolean(currentUser);

    const profileImage =
        currentUser?.profileImage ||
        currentUser?.avatar ||
        currentUser?.photoUrl ||
        "";

    const filteredPosts = useMemo(() => {
        const categoryFiltered =
            selectedCategory === "all"
                ? newsPosts
                : newsPosts.filter((post) => post.type === selectedCategory);

        return [...categoryFiltered].sort((a, b) => {
            if (sortMode === "oldest") {
                return new Date(a.date) - new Date(b.date);
            }

            return (a.homePriority || 999) - (b.homePriority || 999);
        });
    }, [selectedCategory, sortMode]);

    const totalPages = Math.max(1, Math.ceil(filteredPosts.length / POSTS_PER_PAGE));

    const visiblePosts = filteredPosts.slice(
        (currentPage - 1) * POSTS_PER_PAGE,
        currentPage * POSTS_PER_PAGE
    );

    const previewEvent = getPostByType("event", 0);
    const previewUpdate = getPostByType("update", 1);
    const previewMaintenance = getPostByType("maintenance", 3);
    const paginationItems = getPaginationItems(totalPages);

    const openNewsModal = (post, event) => {
        if (!post) return;

        const rect = event.currentTarget.getBoundingClientRect();

        setNewsModalOrigin({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        });

        setNewsModalClosing(false);
        setActiveNewsPost(post);
    };

    const closeNewsModal = () => {
        if (newsModalClosing) return;

        setNewsModalClosing(true);

        setTimeout(() => {
            setActiveNewsPost(null);
            setNewsModalClosing(false);
        }, 480);
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setCurrentUser(null);
        setShowProfileMenu(false);

        notifyAuthChanged({ loggedOut: true });
    };

    const handleCategoryClick = (categoryKey) => {
        setSelectedCategory(categoryKey);
        setCurrentPage(1);
    };

    return (
        <div className="app-shell updates-page-shell">
            <Navbar
                hasSession={hasSession}
                currentUser={currentUser}
                profileImage={profileImage}
                showProfileMenu={showProfileMenu}
                setShowProfileMenu={setShowProfileMenu}
                setAuthMode={() => { }}
                setAuthMessage={() => { }}
                setAuthSuccess={() => { }}
                setLoginErrors={() => { }}
                setRegisterErrors={() => { }}
                setForgotError={() => { }}
                setForgotEmail={() => { }}
                setShowAuthModal={() => { }}
                handleLogout={handleLogout}
            />

            <main className="updates-page">
                <section className="updates-board page-content">
                    <div className="updates-left-column">
                        <section className="updates-hero">
                            <div className="updates-hero-copy">
                                <h1>FastBoost Updates</h1>
                                <p>
                                    Stay up to date with the latest events, platform updates, and important
                                    announcements from the FastBoost team.
                                </p>
                            </div>
                        </section>

                        <div className="updates-toolbar">
                            <div className="updates-filter-row" aria-label="News categories">
                                {NEWS_CATEGORIES.map((category) => (
                                    <button
                                        key={category.key}
                                        type="button"
                                        className={`updates-filter-btn updates-filter-${category.key} ${selectedCategory === category.key ? "updates-filter-btn-active" : ""
                                            }`}
                                        onClick={() => handleCategoryClick(category.key)}
                                    >
                                        {category.label}
                                    </button>
                                ))}
                            </div>

                            <select
                                className="updates-sort-select"
                                value={sortMode}
                                onChange={(event) => setSortMode(event.target.value)}
                                aria-label="Sort news"
                            >
                                <option value="newest">Newest First</option>
                                <option value="oldest">Oldest First</option>
                            </select>
                        </div>

                        <div className="updates-news-list">
                            {visiblePosts.map((post) => (
                                <article
                                    key={post.id}
                                    className={`updates-list-card updates-card-${post.type}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => openNewsModal(post, event)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            openNewsModal(post, event);
                                        }
                                    }}
                                >
                                    <div className="updates-list-image">
                                        <img src={post.image} alt={post.title} />
                                    </div>

                                    <div className="updates-list-content">
                                        <span className={`updates-category-chip updates-category-${post.type}`}>
                                            {post.type}
                                        </span>

                                        <h2>{post.title}</h2>
                                        <p>{post.summary}</p>

                                        <div className="updates-card-footer">
                                            <span>{post.date}</span>
                                            <button type="button">Read More <span>→</span></button>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>

                        <div className="updates-pagination">
                            <button
                                type="button"
                                className="updates-pagination-nav"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                            >
                                ‹ Prev
                            </button>

                            <div className="updates-pagination-pages">
                                {paginationItems.map((item) =>
                                    item === "ellipsis" ? (
                                        <span key="ellipsis" className="updates-pagination-ellipsis">...</span>
                                    ) : (
                                        <button
                                            key={item}
                                            type="button"
                                            className={currentPage === item ? "updates-page-btn-active" : ""}
                                            onClick={() => setCurrentPage(item)}
                                        >
                                            {item}
                                        </button>
                                    )
                                )}
                            </div>

                            <button
                                type="button"
                                className="updates-pagination-nav"
                                disabled={currentPage === totalPages}
                                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                            >
                                Next ›
                            </button>
                        </div>
                    </div>

                    <aside className="updates-side-column">
                        <div className="updates-side-header">
                            <h2>News Detail Page Templates</h2>
                            <p>Different layouts based on content type</p>
                        </div>

                        <div className="updates-template-preview-grid">
                            {previewEvent && (
                                <article
                                    className="updates-template-card updates-template-card-feature updates-card-event"
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => openNewsModal(previewEvent, event)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") openNewsModal(previewEvent, event);
                                    }}
                                >
                                    <img src={previewEvent.image} alt={previewEvent.title} />
                                    <div className="updates-template-card-overlay" />

                                    <div className="updates-template-feature-body">
                                        <span className="updates-category-chip updates-category-event">Event</span>
                                        <h3>FastBoost Opening Day</h3>
                                        <div className="updates-template-meta">
                                            <span>▣ May 25, 2025</span>
                                            <span>◴ 3 min read</span>
                                        </div>
                                        <p>
                                            We are excited to announce that FastBoost is officially live! You can now
                                            access our League of Legends and Teamfight Tactics services.
                                        </p>

                                        <h4>What’s Available Now</h4>
                                        <ul>
                                            <li>League of Legends Services</li>
                                            <li>Teamfight Tactics Services</li>
                                            <li>Secure Checkout</li>
                                            <li>Private Order Chat</li>
                                        </ul>
                                    </div>
                                </article>
                            )}

                            {previewUpdate && (
                                <article
                                    className="updates-template-card updates-template-card-small updates-card-update"
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => openNewsModal(previewUpdate, event)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") openNewsModal(previewUpdate, event);
                                    }}
                                >
                                    <img src={previewUpdate.image} alt={previewUpdate.title} />
                                    <div className="updates-template-card-overlay" />
                                    <div className="updates-template-small-body">
                                        <span className="updates-category-chip updates-category-update">Update</span>
                                        <h3>Live Chat Will Be Available Soon</h3>
                                        <div className="updates-template-meta">
                                            <span>▣ May 24, 2025</span>
                                            <span>◴ 2 min read</span>
                                        </div>
                                        <p>We’re working hard to bring you live chat support for a better and faster experience.</p>
                                        <h4>What to Expect</h4>
                                        <ul>
                                            <li>Real-time support from our team</li>
                                            <li>Faster responses to your questions</li>
                                            <li>Better overall experience</li>
                                        </ul>
                                    </div>
                                </article>
                            )}

                            {previewMaintenance && (
                                <article
                                    className="updates-template-card updates-template-card-small updates-card-maintenance"
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => openNewsModal(previewMaintenance, event)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") openNewsModal(previewMaintenance, event);
                                    }}
                                >
                                    <img src={previewMaintenance.image} alt={previewMaintenance.title} />
                                    <div className="updates-template-card-overlay" />
                                    <div className="updates-template-small-body">
                                        <span className="updates-category-chip updates-category-maintenance">Maintenance</span>
                                        <h3>Scheduled Maintenance</h3>
                                        <div className="updates-template-meta">
                                            <span>▣ May 18, 2025</span>
                                            <span>◴ 1 min read</span>
                                        </div>
                                        <p>We will be performing scheduled maintenance to improve our platform.</p>
                                        <h4>Maintenance Schedule</h4>
                                        <ul>
                                            <li>Start: May 28, 2:00 AM UTC</li>
                                            <li>End: May 28, 4:00 AM UTC</li>
                                            <li>Duration: 2 hours</li>
                                        </ul>
                                    </div>
                                </article>
                            )}
                        </div>
                    </aside>
                </section>
            </main>

            <NewsModal
                post={activeNewsPost}
                origin={newsModalOrigin}
                closing={newsModalClosing}
                onClose={closeNewsModal}
            />
        </div>
    );
}

export default UpdatesPage;