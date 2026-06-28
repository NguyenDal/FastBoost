import { useEffect } from "react";
import NewsModalTemplates from "./NewsModalTemplates";

function NewsModal({ post, origin, closing, onClose }) {
  useEffect(() => {
    if (!post) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [post]);

  if (!post) return null;

  const modalTemplate = post.modalTemplate || "event";

  return (
    <div
      className={`news-modal-backdrop ${
        closing ? "news-modal-backdrop-closing" : ""
      }`}
      onClick={onClose}
    >
      <article
        className={`news-modal-shell news-modal-shell-${modalTemplate} ${
          closing ? "news-modal-shell-closing" : ""
        }`}
        style={{
          "--news-origin-top": `${origin?.top ?? 120}px`,
          "--news-origin-left": `${origin?.left ?? 120}px`,
          "--news-origin-width": `${origin?.width ?? 420}px`,
          "--news-origin-height": `${origin?.height ?? 420}px`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="news-modal-close"
          onClick={onClose}
          aria-label="Close news modal"
        >
          ×
        </button>

        <div className="news-modal-hero">
          <img
            src={post.image}
            alt={post.detailTitle || post.title || "FastBoost news"}
          />

          <div className="news-modal-hero-overlay" />

          <div className="news-modal-hero-content">
            <span className={`updates-category-chip updates-category-${post.type}`}>
              {post.type}
            </span>

            <h2>{post.detailTitle || post.title}</h2>

            <p>{post.subtitle || post.summary}</p>

            <div className="news-modal-meta">
              <span>{post.date}</span>
              <span>{post.readTime}</span>
            </div>
          </div>
        </div>

        <div className="news-modal-body">
          <NewsModalTemplates post={post} />
        </div>
      </article>
    </div>
  );
}

export default NewsModal;