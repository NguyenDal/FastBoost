import { useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import NewsModal from "../components/news/NewsModal";
import CleanIcon from "../components/CleanIcon";
import { NEWS_CATEGORIES, getRecentNewsPosts, newsPosts } from "../data/newsData";
import {
    getStoredUser,
    hasValidSession,
    notifyAuthChanged,
} from "../utils/authSession";
import "../styles/News.css";

const POSTS_PER_PAGE = 4;

const UPDATES_HERO_IMAGE =
    "https://fastboost-assets.s3.amazonaws.com/services/updates-megaphone.png";

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

    const recentPosts = [...newsPosts]
        .sort((a, b) => (a.homePriority || 999) - (b.homePriority || 999))
        .slice(0, 4);

    const openNewsModal = (post, event) => {
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

        notifyAuthChanged({
            loggedOut: true,
        });
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
                <section className="updates-hero page-content">
                    <div>
                        <p className="section-label updates-hero-label">Latest News</p>
                        <h1>FastBoost Updates</h1>
                        <p>
                            Stay up to date with the latest events, platform updates,
                            announcements, guides, and maintenance notices from the FastBoost team.
                        </p>
                    </div>

                    <div className="updates-hero-art">
                        <CleanIcon
                            src={UPDATES_HERO_IMAGE}
                            alt="FastBoost updates"
                            className="updates-hero-image"
                        />
                    </div>
                </section>

                <section className="updates-layout page-content">
                    <div className="updates-main-column">
                        <div className="updates-toolbar">
                            <div className="updates-filter-row">
                                {NEWS_CATEGORIES.map((category) => (
                                    <button
                                        key={category.key}
                                        type="button"
                                        className={`updates-filter-btn ${selectedCategory === category.key ? "updates-filter-btn-active" : ""
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
                                            <button type="button">Read More →</button>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>

                        <div className="updates-pagination">
                            <button
                                type="button"
                                disabled={currentPage === 1}
                                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                            >
                                ‹ Prev
                            </button>

                            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                                <button
                                    key={page}
                                    type="button"
                                    className={currentPage === page ? "updates-page-btn-active" : ""}
                                    onClick={() => setCurrentPage(page)}
                                >
                                    {page}
                                </button>
                            ))}

                            <button
                                type="button"
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

                        <div className="updates-recent-grid">
                            {recentPosts.map((post) => (
                                <article
                                    key={post.id}
                                    className={`updates-recent-card updates-card-${post.type}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={(event) => openNewsModal(post, event)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            openNewsModal(post, event);
                                        }
                                    }}
                                >
                                    <img src={post.image} alt={post.title} />

                                    <div className="updates-recent-overlay" />

                                    <div className="updates-recent-content">
                                        <span className={`updates-category-chip updates-category-${post.type}`}>
                                            {post.type}
                                        </span>
                                        <h3>{post.title}</h3>
                                        <p>{post.date}</p>
                                    </div>
                                </article>
                            ))}
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