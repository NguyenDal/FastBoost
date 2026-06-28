export const NEWS_CATEGORIES = [
  { key: "all", label: "All News" },
  { key: "event", label: "Events" },
  { key: "update", label: "Updates" },
  { key: "announcement", label: "Announcements" },
  { key: "maintenance", label: "Maintenance" },
  { key: "guide", label: "Guides" },
  { key: "promotion", label: "Promotions" },
];

export const newsPosts = [
  {
    id: "opening-day-event",
    type: "event",
    modalTemplate: "event",
    title: "Opening Day Event",
    detailTitle: "FastBoost Opening Day",
    subtitle: "FastBoost is officially live.",
    summary:
      "FastBoost's first League of Legends and Teamfight Tactics services are now available.",
    date: "May 25, 2025",
    readTime: "3 min read",
    image: "https://fastboost-assets.s3.amazonaws.com/services/opening.png",
    pinned: true,
    homePriority: 1,
    tags: ["LoL", "TFT", "Opening"],
    highlights: [
      "League of Legends services are open.",
      "Teamfight Tactics services are open.",
      "Private order chat is available after checkout.",
      "Customers can track order progress in one place.",
    ],
    sections: {
      intro:
        "FastBoost is officially opening as a gaming services platform built around a clean order flow, secure checkout, protected order chat, and role-based support.",
      timeline: ["Announcement", "Orders live", "Secure checkout", "Order tracking"],
    },
  },
  {
    id: "live-chat-coming-soon",
    type: "update",
    modalTemplate: "update",
    title: "Live Chat Will Be Available Soon",
    detailTitle: "Live Chat 2.0 Is Coming",
    subtitle: "Faster communication and better support.",
    summary:
      "We are working hard to bring live chat support for a better and faster customer experience.",
    date: "May 24, 2025",
    readTime: "2 min read",
    image: "https://fastboost-assets.s3.amazonaws.com/services/opening.png",
    pinned: true,
    homePriority: 2,
    tags: ["Support", "Chat", "Platform"],
    highlights: [
      "Real-time customer support.",
      "Better order communication.",
      "Faster response time.",
      "Cleaner support experience.",
    ],
    sections: {
      before: ["Slower response time", "Limited live support"],
      after: ["Faster replies", "Live communication", "Improved support flow"],
    },
  },
  {
    id: "improved-order-protection",
    type: "announcement",
    modalTemplate: "guide",
    title: "Improved Order Protection",
    detailTitle: "How FastBoost Protects Your Order",
    subtitle: "A safer order flow for customers.",
    summary:
      "Enhanced order security and verification systems are active to keep your orders safer.",
    date: "May 20, 2025",
    readTime: "4 min read",
    image: "https://fastboost-assets.s3.amazonaws.com/services/opening.png",
    pinned: true,
    homePriority: 3,
    tags: ["Security", "Orders", "Help"],
    highlights: [
      "Secure checkout flow.",
      "Protected order pages.",
      "Private order chat.",
      "Role-based order access.",
    ],
    steps: [
      "Choose your service and fill in your order details.",
      "Complete secure checkout.",
      "Track your order from your private MatchPage.",
      "Chat with assigned support or booster when available.",
    ],
    faq: [
      {
        question: "Can everyone see my order?",
        answer: "No. Order pages are protected and only authorized users can access them.",
      },
      {
        question: "Where do I track progress?",
        answer: "You can track progress from your protected order page.",
      },
    ],
  },
  {
    id: "scheduled-maintenance",
    type: "maintenance",
    modalTemplate: "maintenance",
    title: "Scheduled Maintenance",
    detailTitle: "Scheduled Maintenance",
    subtitle: "Temporary maintenance window.",
    summary:
      "We will be performing scheduled maintenance to improve stability and reliability.",
    date: "May 18, 2025",
    readTime: "2 min read",
    image: "https://fastboost-assets.s3.amazonaws.com/services/opening.png",
    pinned: false,
    homePriority: 4,
    tags: ["Maintenance", "Platform"],
    highlights: [
      "Order pages may refresh slower.",
      "Checkout may be temporarily unavailable.",
      "Live chat may be paused during maintenance.",
    ],
    maintenance: {
      window: "May 28, 2025, 2:00 AM - 4:00 AM UTC",
      duration: "Around 2 hours",
      affected: ["Website dashboard", "Order checkout", "Live chat"],
      progress: ["Scheduled", "In progress", "Testing", "Complete"],
    },
  },
  {
    id: "mythic-service-announcement",
    type: "announcement",
    modalTemplate: "service",
    title: "WoW Mythic+ Boosting Now Live",
    detailTitle: "WoW Mythic+ Boosting Now Live",
    subtitle: "New services, same trusted quality.",
    summary:
      "A new service category is being prepared for future FastBoost expansion.",
    date: "June 2, 2025",
    readTime: "3 min read",
    image: "https://fastboost-assets.s3.amazonaws.com/services/opening.png",
    pinned: false,
    homePriority: 5,
    tags: ["Service", "Expansion"],
    highlights: [
      "New service launch direction.",
      "More game categories in the future.",
      "Same order tracking structure.",
      "Support flow remains consistent.",
    ],
    availability: ["NA", "EU", "OCE", "ASIA"],
  },
  {
    id: "spring-boost-bash",
    type: "promotion",
    modalTemplate: "promotion",
    title: "Spring Boost Bash",
    detailTitle: "Spring Boost Bash",
    subtitle: "Limited-time promotional event.",
    summary:
      "A seasonal promotion template for future discounts, referral offers, or special campaigns.",
    date: "June 5, 2025",
    readTime: "2 min read",
    image: "https://fastboost-assets.s3.amazonaws.com/services/opening.png",
    pinned: false,
    homePriority: 6,
    tags: ["Promotion", "Offer"],
    highlights: [
      "Discount campaign template.",
      "Referral promotion ready.",
      "Seasonal campaign layout.",
      "Reusable for future offers.",
    ],
    offer: {
      value: "15% OFF",
      label: "All boosting services",
      eligibility: ["New customers", "Selected service types", "Limited-time campaign"],
    },
  },
];

export function getHomepageNewsPosts() {
  return [...newsPosts]
    .filter((post) => post.pinned)
    .sort((a, b) => (a.homePriority || 999) - (b.homePriority || 999))
    .slice(0, 3);
}

export function getRecentNewsPosts(limit = 4) {
  return [...newsPosts]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}